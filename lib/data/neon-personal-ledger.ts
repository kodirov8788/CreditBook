import type { NeonAtomicExecutor, NeonRows, NeonStatement } from "./neon-owner";

type Row = Readonly<Record<string, unknown>>;
export type LedgerCursor = Readonly<{ effectiveDate: string; recordedAt: string; id: string }>;
export type LedgerEntry = Readonly<{ id: string; kind: "income" | "expense"; amountMinor: string; categoryId: string; categoryName: string; effectiveDate: string; note: string; recordedAt: string }>;
export type PersonalLedger = Readonly<{ balanceMinor: string; incomeMinor: string; expenseMinor: string; month: string; entries: LedgerEntry[]; nextCursor: string | null }>;
export type PersonalCategory = Readonly<{id: string; name: string; status: "active" | "archived"; version: number}>;
export type PersonalSnapshot = Readonly<{book: Row; ledger: PersonalLedger; categories: {categories: PersonalCategory[]; nextOffset: number | null}}>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const date = /^(\d{4})-(\d{2})-(\d{2})$/;
const month = /^(\d{4})-(\d{2})$/;
const timestamp = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z$/;
const amount = /^-?(?:0|[1-9]\d*)$/;
const sql = (text: string, values: NeonStatement["values"] = []): NeonStatement => ({ text, values });

function row(value: unknown): Row { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid ledger SQL result."); return value as Row; }
function single(rows: NeonRows | undefined): Row { if (rows?.length !== 1) throw new Error("Invalid ledger SQL result."); return row(rows[0]); }
export function isLedgerMonth(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = month.exec(value);
  return !!match && match[1] !== "0000" && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}
export function isLedgerDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = date.exec(value); if (!match || match[1] === "0000") return false;
  const year = Number(match[1]), monthNumber = Number(match[2]), day = Number(match[3]);
  if (monthNumber < 1 || monthNumber > 12 || day < 1) return false;
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[monthNumber - 1];
}
const dateValue = isLedgerDate;
function cursorValue(value: unknown): value is LedgerCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cursor = value as Record<string, unknown>;
  return Object.keys(cursor).length === 3 && dateValue(cursor.effectiveDate) && typeof cursor.recordedAt === "string" && timestamp.test(cursor.recordedAt) && dateValue(cursor.recordedAt.slice(0, 10)) && typeof cursor.id === "string" && uuid.test(cursor.id);
}

export function decodeLedgerCursor(raw: string): LedgerCursor {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(raw)) throw new Error("Invalid ledger cursor.");
  const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  if (!cursorValue(value)) throw new Error("Invalid ledger cursor.");
  return value;
}
export function encodeLedgerCursor(value: LedgerCursor): string {
  if (!cursorValue(value)) throw new Error("Invalid ledger cursor.");
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function parseEntry(value: unknown): LedgerEntry {
  const item = row(value);
  if (typeof item.id !== "string" || !uuid.test(item.id) || (item.kind !== "income" && item.kind !== "expense")
    || typeof item.amount_minor !== "string" || !/^[1-9]\d*$/.test(item.amount_minor)
    || typeof item.category_id !== "string" || !uuid.test(item.category_id) || typeof item.category_name !== "string"
    || !dateValue(item.effective_date) || typeof item.note !== "string" || typeof item.recorded_at !== "string" || !timestamp.test(item.recorded_at)) {
    throw new Error("Invalid ledger entry result.");
  }
  return { id: item.id, kind: item.kind, amountMinor: item.amount_minor, categoryId: item.category_id,
    categoryName: item.category_name, effectiveDate: item.effective_date, note: item.note, recordedAt: item.recorded_at };
}

// One SELECT owns the MVCC snapshot for both totals and rows. Transaction-local
// owner/issuer guards remain separate; write transaction isolation is unchanged.
function readStatement(selectedMonth: string, cursor: LedgerCursor | undefined, snapshot: boolean): NeonStatement {
  return sql(`with book as (select b.workspace_id,b.account_id from creditbook_personal_data.personal_books b join creditbook_personal_data.personal_accounts a on a.workspace_id=b.workspace_id and a.id=b.account_id where a.status='active' and a.currency_code='JPY' and a.scale=0),
    monthly as materialized (select r.* from creditbook_personal_data.personal_entry_revisions r join book b on b.workspace_id=r.workspace_id and b.account_id=r.account_id
      where r.effective_date >= $1::date and r.effective_date < ($1::date + interval '1 month')::date),
    history as (select r.entry_id as id,r.kind,r.amount_minor::text as amount_minor,r.category_id,r.category_name,to_char(r.effective_date,'YYYY-MM-DD') as effective_date,r.note,to_char(r.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as recorded_at
      from monthly r where ($2::date is null or (r.effective_date,r.recorded_at,r.entry_id)<($2::date,$3::timestamptz,$4::uuid))
      order by r.effective_date desc,r.recorded_at desc,r.entry_id desc limit 51)
    select jsonb_build_object('summary',jsonb_build_object(
      'balance_minor',coalesce((select sum(p.amount_minor)::text from creditbook_personal_data.personal_postings p join book b on b.workspace_id=p.workspace_id and b.account_id=p.account_id),'0'),
      'income_minor',coalesce((select sum(amount_minor) filter(where kind='income')::text from monthly),'0'),
      'expense_minor',coalesce((select sum(amount_minor) filter(where kind='expense')::text from monthly),'0')),
      'entries',coalesce((select jsonb_agg(h) from history h),'[]'::jsonb)
      ${snapshot ? ", 'book',creditbook_personal_data.get_personal_book(), 'categories',coalesce((select jsonb_agg(c) from (select id,name,status,version from creditbook_personal_data.personal_categories order by created_at,id limit 101) c),'[]'::jsonb)" : ""}) as result`,
    [`${selectedMonth}-01`, cursor?.effectiveDate ?? null, cursor?.recordedAt ?? null, cursor?.id ?? null]);
}

function parseLedger(result: Row, selectedMonth: string): PersonalLedger {
  const summary = row(result.summary), entries = result.entries;
  if (typeof summary.balance_minor !== "string" || !amount.test(summary.balance_minor) || typeof summary.income_minor !== "string" || !/^(?:0|[1-9]\d*)$/.test(summary.income_minor) || typeof summary.expense_minor !== "string" || !/^(?:0|[1-9]\d*)$/.test(summary.expense_minor) || !Array.isArray(entries) || entries.length > 51) throw new Error("Invalid ledger summary result.");
  const rows = entries.map(parseEntry), page = rows.slice(0, 50), last = page.at(-1);
  return {balanceMinor: summary.balance_minor, incomeMinor: summary.income_minor, expenseMinor: summary.expense_minor, month: selectedMonth, entries: page,
    nextCursor: rows.length > 50 && last ? encodeLedgerCursor({effectiveDate:last.effectiveDate,recordedAt:last.recordedAt,id:last.id}) : null};
}

/** Requests run in the caller's one connection: role, verified owner, issuer,
 * live access guard, and all ledger reads/writes. Amounts never pass JS number.
 */
export function createNeonPersonalLedger(options: { ownerId: string; issuer: string; execute: NeonAtomicExecutor; signal?: AbortSignal }) {
  const { ownerId, issuer, execute, signal } = options;
  if (!uuid.test(ownerId) || !issuer.startsWith("https://")) throw new Error("Verified personal owner required.");
  async function run(statements: readonly NeonStatement[]): Promise<readonly NeonRows[]> {
    signal?.throwIfAborted();
    const captured = statements.map(statement => ({ text: statement.text, values: [...statement.values] }));
    const rows = await execute([
      sql("set local role creditbook_personal_app"),
      sql("select set_config('creditbook.personal_owner',$1,true)", [ownerId.toLowerCase()]),
      sql("select set_config('creditbook.personal_issuer',$1,true)", [issuer]),
      sql("select creditbook_personal_private.require_personal_access($1::uuid)", [ownerId.toLowerCase()]),
      ...captured,
    ], signal);
    if (rows.length !== captured.length + 4) throw new Error("Invalid ledger SQL batch result.");
    return rows.slice(4);
  }
  return {
    async createEntries(command: Record<string, unknown>, clientKey: string) {
      const [rows] = await run([sql("select creditbook_personal_data.create_personal_entries($1::jsonb,$2::uuid) as result", [JSON.stringify(command), clientKey])]);
      const result = row(single(rows).result);
      if (typeof result.replayed !== "boolean" || typeof result.commandId !== "string" || !uuid.test(result.commandId)) throw new Error("Invalid entry command receipt.");
      return result;
    },
    async ledger(month: string, cursor?: LedgerCursor): Promise<PersonalLedger> {
      if (!isLedgerMonth(month)) throw new Error("Invalid ledger month.");
      const [rows] = await run([readStatement(month, cursor, false)]);
      return parseLedger(row(single(rows).result), month);
    },
    async snapshot(month: string): Promise<PersonalSnapshot> {
      if (!isLedgerMonth(month)) throw new Error("Invalid ledger month.");
      const [rows] = await run([readStatement(month, undefined, true)]);
      const result = row(single(rows).result), book = row(result.book);
      if (!["empty", "ready", "legacy_setup_required"].includes(String(book.state)) || !Array.isArray(result.categories) || result.categories.length > 101) throw new Error("Invalid snapshot result.");
      const categories = result.categories.map((value): PersonalCategory => {
        const item = row(value);
        if (typeof item.id !== "string" || !uuid.test(item.id) || typeof item.name !== "string" || (item.status !== "active" && item.status !== "archived") || typeof item.version !== "number" || !Number.isSafeInteger(item.version) || item.version < 1) throw new Error("Invalid category result.");
        return {id:item.id,name:item.name,status:item.status,version:item.version};
      });
      return {book, ledger:parseLedger(result,month), categories:{categories:categories.slice(0,100),nextOffset:categories.length > 100 ? 100 : null}};
    },
  };
}
