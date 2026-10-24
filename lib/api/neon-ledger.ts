import { readJsonBody } from "./json-body";
import { readNeonConfig, type LocalNeonConfig } from "@/lib/auth/local-config";
import { verifyNeonSession, type VerifiedNeonSession } from "@/lib/auth/server";
import { createNeonPersonalLedger, decodeLedgerCursor, isLedgerDate, isLedgerMonth } from "@/lib/data/neon-personal-ledger";
import { getPersonalRuntime, type LocalPersonalRuntime } from "@/lib/data/neon-personal-runtime";

type RecordValue = Record<string, unknown>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const key = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, X-CreditBook-Owner", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const response = (body: object, status = 200) => Response.json(body, { status, headers });
const fail = (status: number, code: string) => response({ ok: false, code }, status);
const object = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);

function sqlError(error: unknown): Response {
  const code = object(error) && typeof error.code === "string" ? error.code : "UNKNOWN";
  if (code === "42501") return fail(403, "PERSONAL_ACCESS_DENIED");
  if (code === "22023" || code === "22P02") return fail(400, "INVALID_INPUT");
  if (code === "23505") return fail(409, "CONFLICT");
  return fail(503, "PERSONAL_DATA_UNAVAILABLE");
}
function transport(request: Request, config: LocalNeonConfig): Response | null {
  const url = new URL(request.url), expected = new URL(config.origin);
  if (url.origin !== expected.origin || request.headers.get("host") !== expected.host) return fail(403, "INVALID_HOST");
  if (request.headers.has("authorization")) return fail(401, "COOKIE_SESSION_REQUIRED");
  const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
  if ((origin !== null && origin !== config.origin) || (site && site !== "same-origin" && site !== "none")) return fail(403, "INVALID_ORIGIN");
  return null;
}
async function command(request: Request): Promise<{ clientKey: string; command: RecordValue } | null> {
  try {
    // Ledger SQL admits commands up to 64 KiB; retain that boundary here
    // instead of changing the stricter default used by unrelated APIs.
    const value = await readJsonBody(request, 65_536);
    if (!object(value) || Object.keys(value).some(name => name !== "clientKey" && name !== "command") || typeof value.clientKey !== "string" || !key.test(value.clientKey) || !object(value.command)) return null;
    return { clientKey: value.clientKey.toLowerCase(), command: value.command };
  } catch { return null; }
}
function hasStrictEntryDates(value: RecordValue): boolean {
  return Array.isArray(value.entries) && value.entries.length > 0
    && value.entries.every(entry => object(entry) && isLedgerDate(entry.effectiveDate));
}

export function createNeonLedgerHandler(config: LocalNeonConfig, dependencies: { verify: (signal?: AbortSignal) => Promise<VerifiedNeonSession>; runtime: () => LocalPersonalRuntime }, resource: "ledger" | "snapshot" = "ledger") {
  return async (request: Request): Promise<Response> => {
    try {
      request.signal.throwIfAborted();
      const invalidTransport = transport(request, config); if (invalidTransport) return invalidTransport;
      if (request.method !== "GET" && (request.method !== "POST" || resource === "snapshot")) return fail(405, "METHOD_NOT_ALLOWED");
      if (request.method === "POST" && (request.headers.get("origin") !== config.origin || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")) return fail(request.headers.get("origin") !== config.origin ? 403 : 415, request.headers.get("origin") !== config.origin ? "INVALID_ORIGIN" : "JSON_REQUIRED");
      const intent = request.headers.get("X-CreditBook-Owner")?.toLowerCase();
      const verified = await dependencies.verify(request.signal);
      if (!verified.ok) return verified.response;
      if (!intent || !uuid.test(intent) || intent !== verified.user.id) return fail(409, "OWNER_CHANGED");
      const runtime = dependencies.runtime();
      if (runtime.issuer !== config.baseUrl) return fail(503, "PERSONAL_DATA_UNAVAILABLE");
      const ledger = createNeonPersonalLedger({ ownerId: verified.user.id, issuer: config.baseUrl, execute: runtime.execute, signal: request.signal });
      if (request.method === "POST") {
        if (new URL(request.url).search) return fail(400, "INVALID_INPUT");
        const input = await command(request); if (!input || !hasStrictEntryDates(input.command)) return fail(400, "INVALID_INPUT");
        const result = await ledger.createEntries(input.command, input.clientKey);
        return response({ ...result, clientKey: input.clientKey }, result.replayed ? 200 : 201);
      }
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some((name, index, all) => (name !== "month" && (name !== "cursor" || resource === "snapshot")) || all.indexOf(name) !== index)) return fail(400, "INVALID_INPUT");
      const month = params.get("month"); if (!isLedgerMonth(month)) return fail(400, "INVALID_INPUT");
      if (resource === "snapshot") return response(await ledger.snapshot(month));
      let cursor; try { cursor = params.has("cursor") ? decodeLedgerCursor(params.get("cursor")!) : undefined; } catch { return fail(400, "INVALID_INPUT"); }
      return response(await ledger.ledger(month, cursor));
    } catch (error) { return sqlError(error); }
  };
}
export function createNeonSnapshotHandler(config: LocalNeonConfig, dependencies: Parameters<typeof createNeonLedgerHandler>[1]) {
  return createNeonLedgerHandler(config, dependencies, "snapshot");
}
export async function handleNeonLedger(request: Request, resource: "ledger" | "snapshot" = "ledger"): Promise<Response> {
  try {
    const config = readNeonConfig(process.env);
    if (!config || (process.env.CREDITBOOK_NEON_ENABLED !== "1" && process.env.CREDITBOOK_NEON_PERSONAL_LOCAL !== "1")) return fail(503, "PERSONAL_NOT_CONFIGURED");
    return createNeonLedgerHandler(config, { verify: signal => verifyNeonSession(config, undefined, signal), runtime: getPersonalRuntime }, resource)(request);
  } catch { return fail(503, "PERSONAL_NOT_CONFIGURED"); }
}
