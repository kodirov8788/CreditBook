import type { DataClient } from "@/lib/data/client";

type RecordValue = Record<string, unknown>;
export type ShopCustomerSummary = {
  id: string; name: string; phone: string | null; balance: number;
  due_date: string | null; last_payment: string | null; created_at: string;
};
export type ShopDashboardTotals = {
  customers: number; active: number; outstanding: number; overdue: number; collectedThisMonth: number;
};
export type ShopExpense = {
  id: string; category: string; amount: number; spent_at: string; vendor: string | null;
  note: string | null; payment_method: string; voided_at: string | null;
  void_reason: string | null; created_at: string;
};
export type ShopReport = {
  from: string | null; to: string | null; newCredits: number; collected: number; expensesTotal: number;
  netCashflow: number; outstanding: number; overdueAmount: number; overdueCount: number; activeCustomers: number;
  monthly: {month: string; credits: number; collected: number; expenses: number; netCashflow: number}[];
  expenses: ShopExpense[];
};
// Larger bounded pages avoid recomputing global SQL aggregates for every 100
// rows. Requires the additive shop_read_page_capacity migration first.
const PAGE_SIZE = 1000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = () => new Error("Hisob ma’lumotlari to‘liq olinmadi. Qayta yangilang.");
function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as RecordValue;
}
function number(value: unknown, nonnegative = true): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER || (nonnegative && value < 0)) throw invalid();
  return value;
}
function count(value: unknown): number {
  const result = number(value);
  if (!Number.isSafeInteger(result)) throw invalid();
  return result;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw invalid();
  return value;
}
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function rows(value: unknown): unknown[] { if (!Array.isArray(value)) throw invalid(); return value; }
function totals(value: unknown): ShopDashboardTotals {
  const row = record(value);
  return {customers: count(row.customers), active: count(row.active), outstanding: number(row.outstanding), overdue: number(row.overdue), collectedThisMonth: number(row.collectedThisMonth)};
}
function customer(value: unknown): ShopCustomerSummary {
  const row = record(value);
  return {id: text(row.id), name: text(row.name), phone: nullableText(row.phone), balance: number(row.balance), due_date: nullableText(row.due_date), last_payment: nullableText(row.last_payment), created_at: text(row.created_at)};
}
function expense(value: unknown): ShopExpense {
  const row = record(value);
  return {id: text(row.id), category: text(row.category), amount: number(row.amount), spent_at: text(row.spent_at), vendor: nullableText(row.vendor), note: nullableText(row.note), payment_method: text(row.payment_method), voided_at: nullableText(row.voided_at), void_reason: nullableText(row.void_reason), created_at: text(row.created_at)};
}
function report(value: unknown): ShopReport {
  const row = record(value);
  return {
    from: nullableText(row.from), to: nullableText(row.to), newCredits: number(row.newCredits), collected: number(row.collected), expensesTotal: number(row.expensesTotal),
    netCashflow: number(row.netCashflow, false), outstanding: number(row.outstanding), overdueAmount: number(row.overdueAmount), overdueCount: count(row.overdueCount), activeCustomers: count(row.activeCustomers),
    monthly: rows(row.monthly).map(value => {const month = record(value); return {month: text(month.month), credits: number(month.credits), collected: number(month.collected), expenses: number(month.expenses), netCashflow: number(month.netCashflow, false)};}),
    expenses: rows(row.expenses).map(expense),
  };
}

/** Stable keyset pagination. Never return a partial list as a successful full read.
 * A shared deadline bounds the whole read, not twenty seconds per page.
 * Global totals come from SQL, never from a page or nested PostgREST relations.
 */
async function collect<T extends {id: string}>(
  supabase: DataClient, shopId: string, rpc: string, args: RecordValue,
  decode: (value: RecordValue) => {items: T[]; total: number; metadata: unknown},
) {
  const signal = AbortSignal.timeout(20_000);
  const items: T[] = [];
  let after: string | null = null;
  let signature: string | undefined;
  let metadata: unknown;
  for (;;) {
    signal.throwIfAborted();
    const {data, error} = await supabase.rpc(rpc, {...args, p_after: after, p_limit: PAGE_SIZE}).abortSignal(signal);
    if (error) throw invalid();
    const page = record(data);
    if (page.shopId !== shopId) throw invalid();
    const decoded = decode(page);
    const currentSignature = JSON.stringify([decoded.total, decoded.metadata]);
    if (signature !== undefined && currentSignature !== signature) throw invalid();
    signature = currentSignature;
    metadata = decoded.metadata;
    if (decoded.items.length > PAGE_SIZE) throw invalid();
    let last: string | null = after;
    for (const item of decoded.items) {
      if (!uuid.test(item.id) || (last !== null && item.id <= last)) throw invalid();
      last = item.id;
      items.push(item);
    }
    if (items.length > decoded.total) throw invalid();
    if (page.nextCursor === null) {
      if (items.length !== decoded.total) throw invalid();
      return {items, metadata};
    }
    if (!decoded.items.length || page.nextCursor !== last || items.length >= decoded.total) throw invalid();
    after = last;
  }
}

export async function readShopDashboard(supabase: DataClient, shopId: string) {
  let resultTotals: ShopDashboardTotals | undefined;
  const result = await collect(supabase, shopId, "shop_dashboard_page", {}, page => {
    resultTotals = totals(page.totals);
    return {items: rows(page.summary).map(customer), total: resultTotals.customers, metadata: resultTotals};
  });
  if (!resultTotals) throw invalid();
  // Preserve the existing newest-customer-first UI, with deterministic ties.
  return {summary: result.items.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)), totals: resultTotals};
}

export function validReportDate(value: string | null) {
  return value === null || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
}

export async function readShopReport(supabase: DataClient, shopId: string, from: string | null, to: string | null) {
  let resultReport: ShopReport | undefined;
  const result = await collect(supabase, shopId, "shop_report_page", {p_from: from, p_to: to}, page => {
    resultReport = report(page.report);
    if (resultReport.from !== from || resultReport.to !== to) throw invalid();
    const {expenses, ...metadata} = resultReport;
    return {items: expenses, total: count(page.expenseCount), metadata};
  });
  if (!resultReport) throw invalid();
  return {...resultReport, expenses: result.items.sort((a, b) => b.spent_at.localeCompare(a.spent_at) || b.id.localeCompare(a.id))};
}
