import type { DataClient } from "./client";
import type { OwnerBoundShopQuery } from "./shops";
import { NeonOwnerAuthorizationError, type NeonStatement } from "./neon-owner.ts";

export type CustomerDetails = { name: string; phone: string | null; address: string | null; notes: string | null };
export type CustomerCreateCommand = CustomerDetails & { amount: number; dueDate: string | null };
// Preserve provider response fields; only the shared identifier is assumed by
// this transitional write seam. Metadata is not a substitute for debt history.
export type CustomerResult = Readonly<Record<string, unknown>> & { id: string };
export interface CustomerMetadataRepository {
  create(command: CustomerCreateCommand): Promise<CustomerResult>;
  update(id: string, details: CustomerDetails): Promise<CustomerResult>;
  getMetadata(id: string): Promise<CustomerResult | null>;
  listMetadata(offset?: number): Promise<{ customers: CustomerResult[]; hasMore: boolean }>;
}
export class CustomerRepositoryError extends Error {
  readonly code?: string;
  constructor(code?: string) {
    super("Customer data operation failed."); this.name = "CustomerRepositoryError"; this.code = code;
  }
}
const columns = "id, name, phone, address, notes, created_at, updated_at";
const patchColumns = "id, name, phone, address, notes, updated_at";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function customer(value: unknown): CustomerResult {
  if (!record(value) || typeof value.id !== "string") throw new CustomerRepositoryError();
  return { ...value, id: value.id };
}
export function parseCustomerDetails(value: unknown): CustomerDetails | null {
  if (!record(value) || typeof value.name !== "string" || value.name.trim().length < 2) return null;
  for (const key of ["phone", "address", "notes"] as const) {
    if (value[key] != null && typeof value[key] !== "string") return null;
  }
  return { name: value.name.trim(),
    phone: typeof value.phone === "string" ? value.phone.trim() || null : null,
    address: typeof value.address === "string" ? value.address.trim() || null : null,
    notes: typeof value.notes === "string" ? value.notes.trim() || null : null };
}
function offsetValue(offset: number): number {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new CustomerRepositoryError("22023");
  return offset;
}
function validDetails(details: CustomerDetails): CustomerDetails {
  const parsed = parseCustomerDetails(details);
  if (!parsed) throw new CustomerRepositoryError("22023");
  return parsed;
}

export function createSupabaseCustomerRepository(client: DataClient, shopId: string): CustomerMetadataRepository {
  return {
    async create(command) {
      const details = validDetails(command);
      if (!Number.isFinite(command.amount) || command.amount < 0) throw new CustomerRepositoryError("22023");
      // Preserve the existing atomic customer + optional opening-debt RPC. It
      // resolves current shop in the database; never split this into two writes.
      const result = await client.rpc("create_customer_with_opening_debt", {
        p_name: details.name, p_phone: details.phone, p_address: details.address,
        p_notes: details.notes, p_amount: command.amount, p_due_date: command.dueDate,
      });
      if (result.error) throw new CustomerRepositoryError(result.error.code);
      return customer(Array.isArray(result.data) ? result.data[0] : result.data);
    },
    async update(id, details) {
      const result = await client.from("customers").update(validDetails(details))
        .eq("id", id).eq("shop_id", shopId).select(patchColumns).single();
      if (result.error || !result.data) throw new CustomerRepositoryError(result.error?.code ?? "P0002");
      return customer(result.data);
    },
    async getMetadata(id) {
      const result = await client.from("customers").select(columns).eq("shop_id", shopId).eq("id", id).maybeSingle();
      if (result.error) throw new CustomerRepositoryError(result.error.code);
      return result.data === null ? null : customer(result.data);
    },
    async listMetadata(offset = 0) {
      offsetValue(offset);
      const result = await client.from("customers").select(columns).eq("shop_id", shopId)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 100);
      if (result.error) throw new CustomerRepositoryError(result.error.code);
      if (!Array.isArray(result.data)) throw new CustomerRepositoryError();
      return { customers: result.data.slice(0, 100).map(customer), hasMore: result.data.length > 100 };
    },
  };
}

// Unmounted candidate. Captured shopId binds the intended tenant across awaits;
// SQL rechecks its permissions/current selection in the write transaction.
export function createNeonCustomerRepository(run: OwnerBoundShopQuery, shopId: string): CustomerMetadataRepository {
  if (!uuid.test(shopId)) throw new CustomerRepositoryError("22023");
  async function query(statement: NeonStatement): Promise<unknown> {
    try {
      const result = await run([statement]);
      if (result.length !== 1 || result[0].length !== 1) throw new CustomerRepositoryError();
      return result[0][0].result;
    } catch (error) {
      if (error instanceof NeonOwnerAuthorizationError) throw error;
      throw new CustomerRepositoryError(record(error) && typeof error.code === "string" ? error.code : undefined);
    }
  }
  return {
    async create(command) {
      const details = validDetails(command);
      if (!Number.isFinite(command.amount) || command.amount < 0) throw new CustomerRepositoryError("22023");
      // Never silently discard an opening debt or save half an operation.
      if (command.amount !== 0) throw new CustomerRepositoryError("0A000");
      return customer(await query({
        text: "select creditbook_neon_private.create_customer_metadata($1::uuid,$2::jsonb,$3::numeric,$4::date) as result",
        values: [shopId, JSON.stringify(details), command.amount, command.dueDate],
      }));
    },
    async update(id, details) {
      if (!uuid.test(id)) throw new CustomerRepositoryError("22023");
      return customer(await query({
        text: "select creditbook_neon_private.update_customer_metadata($1::uuid,$2::uuid,$3::jsonb) as result",
        values: [shopId, id, JSON.stringify(validDetails(details))],
      }));
    },
    async getMetadata(id) {
      if (!uuid.test(id)) throw new CustomerRepositoryError("22023");
      const result = await query({
        text: "select creditbook_neon_private.get_customer_metadata($1::uuid,$2::uuid) as result", values: [shopId, id],
      });
      return result === null ? null : customer(result);
    },
    async listMetadata(offset = 0) {
      const result = await query({
        text: "select creditbook_neon_private.list_customer_metadata($1::uuid,$2::integer) as result",
        values: [shopId, offsetValue(offset)],
      });
      if (!record(result) || !Array.isArray(result.customers) || typeof result.hasMore !== "boolean") {
        throw new CustomerRepositoryError();
      }
      return { customers: result.customers.map(customer), hasMore: result.hasMore };
    },
  };
}

export type CustomerOpeningCommand = CustomerDetails & { amountDecimal: string; dueDate: string | null };
export type CustomerPaymentRead = {
  id: string; amount: string; paid_at: string; note: string | null;
  voided_at: string | null; void_reason: string | null;
};
export type CustomerDebtRead = {
  id: string; title: string; principal: string; due_date: string | null;
  status: "open" | "paid" | "cancelled"; notes: string | null;
  created_at: string; updated_at: string; payments: CustomerPaymentRead[];
};
export type CustomerFinanceRead = CustomerDetails & {
  id: string; created_at: string; updated_at: string;
  debts: CustomerDebtRead[]; outstandingDecimal: string;
};
export interface CustomerFinanceRepository {
  create(command: CustomerOpeningCommand): Promise<CustomerResult>;
  get(id: string): Promise<CustomerFinanceRead | null>;
}

// Source shop precision is numeric(14,2), not the personal JPY minor-unit model.
// Never accept a JS number and hope an already-rounded value is recoverable.
export function normalizeShopAmount(value: string): string {
  if (typeof value !== "string" || !/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) {
    throw new CustomerRepositoryError("22023");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole).toString() + "." + fraction.padEnd(2, "0");
}
function exactMoney(value: unknown): string {
  // Aggregate totals may exceed the precision of any individual debt.
  if (typeof value !== "string" || !/^(0|[1-9]\d*)\.\d{2}$/.test(value)) throw new CustomerRepositoryError();
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new CustomerRepositoryError();
  return value;
}
function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}
function financialCustomer(value: unknown): CustomerFinanceRead {
  if (!record(value) || !Array.isArray(value.debts)) throw new CustomerRepositoryError();
  return {
    id: text(value.id), name: text(value.name), phone: nullableText(value.phone),
    address: nullableText(value.address), notes: nullableText(value.notes),
    created_at: text(value.created_at), updated_at: text(value.updated_at),
    outstandingDecimal: exactMoney(value.outstandingDecimal),
    debts: value.debts.map((debt: unknown): CustomerDebtRead => {
      if (!record(debt) || !Array.isArray(debt.payments)
        || typeof debt.status !== "string" || !["open", "paid", "cancelled"].includes(debt.status)) throw new CustomerRepositoryError();
      return {
        id: text(debt.id), title: text(debt.title), principal: exactMoney(debt.principal),
        due_date: nullableText(debt.due_date), status: debt.status as CustomerDebtRead["status"],
        notes: nullableText(debt.notes), created_at: text(debt.created_at), updated_at: text(debt.updated_at),
        payments: debt.payments.map((payment: unknown): CustomerPaymentRead => {
          if (!record(payment)) throw new CustomerRepositoryError();
          return { id: text(payment.id), amount: exactMoney(payment.amount), paid_at: text(payment.paid_at),
            note: nullableText(payment.note), voided_at: nullableText(payment.voided_at), void_reason: nullableText(payment.void_reason) };
        }),
      };
    }),
  };
}

// A separate, unmounted financial contract. The M6 metadata-only writer still
// refuses positive amounts; no live route selects mixed Supabase/Neon backends.
export function createNeonCustomerFinanceRepository(run: OwnerBoundShopQuery, shopId: string): CustomerFinanceRepository {
  if (!uuid.test(shopId)) throw new CustomerRepositoryError("22023");
  async function query(statement: NeonStatement): Promise<unknown> {
    try {
      const rows = await run([statement]);
      if (rows.length !== 1 || rows[0].length !== 1) throw new CustomerRepositoryError();
      return rows[0][0].result;
    } catch (error) {
      if (error instanceof NeonOwnerAuthorizationError) throw error;
      throw new CustomerRepositoryError(record(error) && typeof error.code === "string" ? error.code : undefined);
    }
  }
  return {
    async create(command) {
      const details = validDetails(command), amount = normalizeShopAmount(command.amountDecimal);
      if (command.dueDate !== null && (typeof command.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(command.dueDate))) {
        throw new CustomerRepositoryError("22023");
      }
      return customer(await query({
        text: "select creditbook_neon_private.create_customer_opening($1::uuid,$2::jsonb,$3::text,$4::date) as result",
        values: [shopId, JSON.stringify(details), amount, command.dueDate],
      }));
    },
    async get(id) {
      if (!uuid.test(id)) throw new CustomerRepositoryError("22023");
      const result = await query({
        text: "select creditbook_neon_private.read_customer_finances($1::uuid,$2::uuid) as result", values: [shopId, id],
      });
      return result === null ? null : financialCustomer(result);
    },
  };
}
