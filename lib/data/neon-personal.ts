import type { NeonAtomicExecutor, NeonRows, NeonStatement } from "./neon-owner";
import { encodeHistoryCursor, type HistoryCursor } from "@/lib/personal-finance/history-cursor";

type JsonObject = Record<string, unknown>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid personal SQL result.");
  return value as JsonObject;
}
function scalar(rows: NeonRows | undefined): JsonObject {
  if (rows?.length !== 1) throw new Error("Invalid personal SQL result.");
  return object(rows[0].result);
}
const sql = (text: string, values: NeonStatement["values"] = []): NeonStatement => ({ text, values });
const workspaceProjection = `id,name,status,
  to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
  to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at`;

/** The caller supplies ONLY an SDK-verified principal. Every method uses one
 * atomic batch/connection for role + issuer + owner + live pilot guard + SQL.
 * No Supabase facade, ambient identity, raw client SQL, or automatic retry.
 */
export function createNeonPersonalRepository(options: {
  ownerId: string; issuer: string; execute: NeonAtomicExecutor; signal?: AbortSignal;
}) {
  const { ownerId, issuer, execute, signal } = options;
  if (!uuid.test(ownerId) || !issuer.startsWith("https://")) throw new Error("Verified personal owner required.");
  async function run(statements: readonly NeonStatement[]): Promise<readonly NeonRows[]> {
    signal?.throwIfAborted();
    const captured = statements.map(statement => ({ text: statement.text, values: [...statement.values] }));
    const rows = await execute([
      sql("set local role creditbook_personal_app"),
      sql("select set_config('creditbook.personal_owner',$1,true)", [ownerId]),
      sql("select set_config('creditbook.personal_issuer',$1,true)", [issuer]),
      sql("select creditbook_personal_private.require_personal_access($1::uuid)", [ownerId]),
      ...captured,
    ], signal);
    if (rows.length !== captured.length + 4) throw new Error("Invalid personal SQL batch result.");
    return rows.slice(4);
  }
  async function command(name: "initialize_personal_book" | "manage_personal_account" | "manage_personal_category",
    value: JsonObject, clientKey: string): Promise<JsonObject> {
    const [rows] = await run([sql(`select creditbook_personal_data.${name}($1::jsonb,$2::uuid) as result`,
      [JSON.stringify(value), clientKey])]);
    const result = scalar(rows);
    if (typeof result.replayed !== "boolean") throw new Error("Invalid personal command receipt.");
    return result;
  }
  return {
    async book() { return scalar((await run([sql("select creditbook_personal_data.get_personal_book() as result")]))[0]); },
    initializeBook: (value: JsonObject, clientKey: string) => command("initialize_personal_book", value, clientKey),
    manageAccount: (value: JsonObject, clientKey: string) => command("manage_personal_account", value, clientKey),
    manageCategory: (value: JsonObject, clientKey: string) => command("manage_personal_category", value, clientKey),
    async accounts(offset: number) {
      return scalar((await run([sql("select creditbook_personal_data.get_personal_accounts($1::integer) as result", [offset])]))[0]);
    },
    async workspace(ensure = false) {
      const statements: NeonStatement[] = [];
      if (ensure) statements.push(sql("select creditbook_personal_data.ensure_my_personal_workspace() as id"));
      // Separate statement AFTER ensure, in the same transaction, so a newly
      // inserted row is visible under a fresh statement snapshot.
      statements.push(sql(`select ${workspaceProjection} from creditbook_personal_data.personal_workspaces
        where owner_user_id=$1::uuid and status='active'`, [ownerId]));
      const results = await run(statements);
      const rows = results.at(-1);
      if (!rows || rows.length > 1) throw new Error("Invalid workspace result.");
      return rows[0] ?? null;
    },
    async categories(status: "active" | "archived" | "all", offset: number) {
      const [rows] = await run([sql(`select id,name,status,version from creditbook_personal_data.personal_categories
        where ($1::text='all' or status=$1::text) order by created_at,id limit 101 offset $2::integer`, [status, offset])]);
      if (!rows || rows.length > 101 || rows.some(row => typeof row.id !== "string" || !uuid.test(row.id)
        || typeof row.name !== "string" || !["active", "archived"].includes(String(row.status))
        || typeof row.version !== "number" || !Number.isSafeInteger(row.version) || row.version < 1)) {
        throw new Error("Invalid category result.");
      }
      const limited = rows.length > 100 && offset + 100 > 100000;
      return { categories: rows.slice(0, 100), nextOffset: rows.length > 100 && !limited ? offset + 100 : null,
        ...(limited ? { paginationLimitReached: true } : {}) };
    },
    async history(accountId: string, cursor?: HistoryCursor) {
      const [accounts, postings] = await run([
        sql("select id,currency_code,scale from creditbook_personal_data.personal_accounts where id=$1::uuid", [accountId]),
        sql(`select id,kind,amount_minor::text as amount_minor,to_char(effective_date,'YYYY-MM-DD') as effective_date,
          to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as recorded_at
          from creditbook_personal_data.personal_postings p where p.account_id=$1::uuid
          and ($2::timestamptz is null or (p.recorded_at,p.id)<($2::timestamptz,$3::uuid))
          order by p.recorded_at desc,p.id desc limit 51`, [accountId, cursor?.recordedAt ?? null, cursor?.id ?? null]),
      ]);
      if (!accounts || accounts.length > 1 || !postings || postings.length > 51) throw new Error("Invalid history result.");
      if (!accounts.length) return null;
      const account = accounts[0];
      if (!["JPY", "USD", "UZS"].includes(String(account.currency_code))
        || account.scale !== (account.currency_code === "JPY" ? 0 : 2)) throw new Error("Invalid account currency.");
      if (postings.some(row => typeof row.id !== "string" || !uuid.test(row.id)
        || typeof row.recorded_at !== "string" || typeof row.effective_date !== "string"
        || typeof row.amount_minor !== "string" || !/^-?(0|[1-9]\d*)$/.test(row.amount_minor)
        || !["opening", "income", "expense"].includes(String(row.kind)))) throw new Error("Invalid exact posting result.");
      const page = postings.slice(0, 50);
      const last = page.at(-1);
      const nextCursor = postings.length > 50 && last ? encodeHistoryCursor({ accountId,
        id: String(last.id), recordedAt: String(last.recorded_at) }) : null;
      return { currencyCode: account.currency_code, scale: account.scale, postings: page, nextCursor };
    },
  };
}
export type NeonPersonalRepository = ReturnType<typeof createNeonPersonalRepository>;
