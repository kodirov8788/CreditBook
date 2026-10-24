import { readJsonBody } from "./json-body";
import { readNeonConfig, type LocalNeonConfig } from "@/lib/auth/local-config";
import { verifyNeonSession, type VerifiedNeonSession } from "@/lib/auth/server";
import { createNeonPersonalRepository } from "@/lib/data/neon-personal";
import { getPersonalRuntime, type LocalPersonalRuntime } from "@/lib/data/neon-personal-runtime";
import { decodeHistoryCursor } from "@/lib/personal-finance/history-cursor";

type Resource = "workspace" | "book" | "accounts" | "account" | "history" | "categories";
type RecordValue = Record<string, unknown>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie, X-CreditBook-Owner",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
function reply(body: object, status = 200) { return Response.json(body, { status, headers: privateHeaders }); }
function fail(status: number, code: string) { return reply({ ok: false, code }, status); }
function record(value: unknown): value is RecordValue { return !!value && typeof value === "object" && !Array.isArray(value); }

/** Even misconfigured opt-in must enter the fail-closed Neon branch, never
 * fall back to a Supabase identity or a second data store.
 */
export function usesLocalNeonPersonal(): boolean {
  return process.env.CREDITBOOK_NEON_ENABLED === "1" || process.env.CREDITBOOK_NEON_AUTH_LOCAL === "1" || process.env.CREDITBOOK_NEON_PERSONAL_LOCAL === "1";
}

function query(request: Request, allowed: readonly string[]) {
  const params = new URL(request.url).searchParams, seen = new Set<string>();
  for (const [name] of params) {
    if (!allowed.includes(name) || seen.has(name)) throw new Error("Invalid query");
    seen.add(name);
  }
  return params;
}
function offset(params: URLSearchParams): number {
  const raw = params.get("offset") ?? "0";
  if (!/^\d{1,6}$/.test(raw) || Number(raw) > 100000) throw new Error("Invalid offset");
  return Number(raw);
}
async function envelope(request: Request): Promise<{ command: RecordValue; clientKey: string } | null> {
  try {
    const body = await readJsonBody(request);
    if (!record(body) || Object.keys(body).some(key => key !== "command" && key !== "clientKey")
      || typeof body.clientKey !== "string" || !keyPattern.test(body.clientKey) || !record(body.command)) return null;
    return { command: body.command, clientKey: body.clientKey.toLowerCase() };
  } catch { return null; }
}
async function emptyWorkspaceBody(request: Request): Promise<boolean> {
  if (!request.body) return true;
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0, text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 1024) { await reader.cancel(); return false; }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    if (length === 0) return true;
    const body: unknown = JSON.parse(text);
    return record(body) && Object.keys(body).length === 0;
  } catch { return false; } finally { reader.releaseLock(); }
}

function sqlError(error: unknown): Response {
  const code = record(error) && typeof error.code === "string" ? error.code : "UNKNOWN";
  if (code === "42501") return fail(403, "PERSONAL_ACCESS_DENIED");
  if (code === "22023" || code === "22P02") return fail(400, "INVALID_INPUT");
  if (code === "23505") return fail(409, "CONFLICT");
  if (code === "PT409") {
    const reason = record(error) ? error.reason : null;
    return fail(409, reason === "BOOK_EXISTS" || reason === "LEGACY_SETUP_REQUIRED" ? reason : "CONFLICT");
  }
  // A timeout/cancelled response cannot prove a transaction did not commit.
  // Caller keeps the SAME clientKey when reconciling; no automatic retry here.
  return fail(503, "PERSONAL_DATA_UNAVAILABLE");
}

export function createLocalNeonPersonalHandler(config: LocalNeonConfig, dependencies: {
  verify: (signal?: AbortSignal) => Promise<VerifiedNeonSession>;
  runtime: () => LocalPersonalRuntime;
}) {
  return async (request: Request, resource: Resource, accountId?: string): Promise<Response> => {
    try {
      request.signal.throwIfAborted();
      const url = new URL(request.url), expected = new URL(config.origin);
      if (url.origin !== expected.origin || request.headers.get("host") !== expected.host) return fail(403, "INVALID_HOST");
      if (request.headers.has("authorization")) return fail(401, "COOKIE_SESSION_REQUIRED");
      const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
      if ((origin !== null && origin !== config.origin) || (site && site !== "same-origin" && site !== "none")) return fail(403, "INVALID_ORIGIN");
      const permitted = resource === "account" ? ["PATCH"] : resource === "history" ? ["GET"] : ["GET", "POST"];
      if (!permitted.includes(request.method)) return fail(405, "METHOD_NOT_ALLOWED");
      if (request.method !== "GET") {
        if (origin !== config.origin) return fail(403, "INVALID_ORIGIN");
        if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return fail(415, "JSON_REQUIRED");
      }
      // Capture owner intent BEFORE asynchronous SDK verification. No mutable
      // global user or a caller-supplied ID is accepted as authority.
      const intent = request.headers.get("X-CreditBook-Owner")?.toLowerCase();
      const verified = await dependencies.verify(request.signal);
      if (!verified.ok) return verified.response;
      if (!intent || !uuid.test(intent) || intent !== verified.user.id) return fail(409, "OWNER_CHANGED");
      request.signal.throwIfAborted();
      const runtime = dependencies.runtime();
      if (runtime.issuer !== config.baseUrl) return fail(503, "PERSONAL_DATA_UNAVAILABLE");
      const repository = createNeonPersonalRepository({ ownerId: verified.user.id,
        issuer: config.baseUrl, execute: runtime.execute, signal: request.signal });

      if (request.method === "GET") {
        let params: URLSearchParams;
        let pageOffset = 0;
        let categoryStatus: "active" | "archived" | "all" = "active";
        try {
          params = query(request, resource === "categories" ? ["status", "offset"] : resource === "accounts" ? ["offset"] : resource === "history" ? ["cursor"] : []);
          if (resource === "accounts" || resource === "categories") pageOffset = offset(params);
          if (resource === "categories") {
            const status = params.get("status") ?? "active";
            if (status !== "active" && status !== "archived" && status !== "all") return fail(400, "INVALID_INPUT");
            categoryStatus = status;
          }
        } catch { return fail(400, "INVALID_INPUT"); }
        if (resource === "accounts") return reply(await repository.accounts(pageOffset));
        if (resource === "categories") return reply(await repository.categories(categoryStatus, pageOffset));
        if (resource === "book") return reply(await repository.book());
        if (resource === "workspace") {
          const workspace = await repository.workspace();
          return workspace ? reply({ workspace }) : fail(404, "NOT_FOUND");
        }
        if (!accountId || !uuid.test(accountId)) return fail(400, "INVALID_INPUT");
        let cursor;
        try { cursor = params.has("cursor") ? decodeHistoryCursor(params.get("cursor")!, accountId) : undefined; }
        catch { return fail(400, "INVALID_INPUT"); }
        const history = await repository.history(accountId, cursor);
        return history ? reply(history) : fail(404, "NOT_FOUND");
      }
      if (url.search) return fail(400, "INVALID_INPUT");
      if (resource === "workspace") {
        if (!await emptyWorkspaceBody(request)) return fail(400, "INVALID_INPUT");
        const workspace = await repository.workspace(true);
        return workspace ? reply({ workspace }) : fail(503, "PERSONAL_DATA_UNAVAILABLE");
      }
      const input = await envelope(request);
      if (!input) return fail(400, "INVALID_INPUT");
      if (resource === "book") {
        const result = await repository.initializeBook(input.command, input.clientKey);
        return reply(result, result.replayed ? 200 : 201);
      }
      if (resource === "categories") {
        const result = await repository.manageCategory(input.command, input.clientKey);
        return reply({ ...result, clientKey: input.clientKey }, result.replayed || input.command.operation !== "create" ? 200 : 201);
      }
      if (resource === "account") {
        if (!accountId || !uuid.test(accountId) || "accountId" in input.command) return fail(400, "INVALID_INPUT");
        return reply(await repository.manageAccount({ ...input.command, accountId }, input.clientKey));
      }
      // Compatibility entry point, NOT another generic account-creation grant.
      // Reject rather than silently discard non-default appearance/settings.
      const allowed = ["name", "currencyCode", "openingAmountMinor", "openingDate", "timeZone", "icon", "color", "includeInTotal"];
      const command = input.command;
      if (Object.keys(command).some(key => !allowed.includes(key))
        || command.name !== "Shaxsiy hisob" || command.currencyCode !== "JPY" || command.timeZone !== "Asia/Tokyo"
        || (command.icon !== undefined && command.icon !== "cash")
        || (command.color !== undefined && command.color !== "#18794E")
        || (command.includeInTotal !== undefined && command.includeInTotal !== true)) return fail(400, "INVALID_INPUT");
      const result = await repository.initializeBook({ openingAmountMinor: command.openingAmountMinor,
        openingDate: command.openingDate }, input.clientKey);
      return reply(result, result.replayed ? 200 : 201);
    } catch (error) { return sqlError(error); }
  };
}

export async function handleLocalNeonPersonal(request: Request, resource: Resource, accountId?: string): Promise<Response> {
  try {
    const config = readNeonConfig(process.env);
    if (!config || (process.env.CREDITBOOK_NEON_PERSONAL_LOCAL !== "1" && process.env.CREDITBOOK_NEON_ENABLED !== "1")) return fail(503, "PERSONAL_NOT_CONFIGURED");
    return createLocalNeonPersonalHandler(config, {
      verify: signal => verifyNeonSession(config, undefined, signal), runtime: getPersonalRuntime,
    })(request, resource, accountId);
  } catch { return fail(503, "PERSONAL_NOT_CONFIGURED"); }
}
