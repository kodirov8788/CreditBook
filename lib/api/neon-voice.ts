import { createHmac } from "node:crypto";
import { inferVoice, validateVoiceRequest, type VoiceInference } from "../ai/voice-provider";
import type { VoiceCategory, VoiceDraftRequest } from "../personal-finance/voice-contract";
import { readJsonBody } from "./json-body";
import { readNeonConfig, type LocalNeonConfig } from "../auth/local-config";
import { verifyNeonSession, type VerifiedNeonSession } from "../auth/server";
import { createVoiceBudget, type VoiceBudget } from "../data/neon-voice-budget";
import { createNeonPersonalRepository } from "../data/neon-personal";
import { getPersonalRuntime, type LocalPersonalRuntime } from "../data/neon-personal-runtime";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, X-CreditBook-Owner", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const response = (body: object, status = 200) => Response.json(body, { status, headers });
const fail = (status: number, code: string) => response({ ok: false, code }, status);
type Dependencies = {
  verify(signal?: AbortSignal): Promise<VerifiedNeonSession>;
  runtime(): LocalPersonalRuntime;
  infer(input: VoiceDraftRequest, categories: readonly VoiceCategory[], signal: AbortSignal): Promise<VoiceInference>;
  budget?: (runtime: LocalPersonalRuntime, ownerId: string, signal?: AbortSignal) => VoiceBudget;
};
export function createNeonVoiceHandler(config: LocalNeonConfig, dependencies: Dependencies) {
  return async (request: Request): Promise<Response> => {
    let reservation: { budget: VoiceBudget; id: string } | undefined;
    try {
      const url = new URL(request.url), host = new URL(config.origin).host;
      if (url.origin !== config.origin || request.headers.get("host") !== host) return fail(403, "INVALID_HOST");
      if (request.headers.has("authorization")) return fail(401, "COOKIE_SESSION_REQUIRED");
      if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
      if (request.headers.get("origin") !== config.origin || ![null, "same-origin", "none"].includes(request.headers.get("sec-fetch-site"))) return fail(403, "INVALID_ORIGIN");
      if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return fail(415, "JSON_REQUIRED");
      if (url.search) return fail(400, "INVALID_INPUT");
      const verified = await dependencies.verify(request.signal);
      if (!verified.ok) return response({ ok: false, code: verified.response.status === 503 ? "AUTH_UNAVAILABLE" : "AUTH_REQUIRED" }, verified.response.status);
      if (request.headers.get("x-creditbook-owner")?.toLowerCase() !== verified.user.id) return fail(409, "OWNER_CHANGED");
      let input; try { input = validateVoiceRequest(await readJsonBody(request, 2_010_000)); } catch { return fail(400, "INVALID_INPUT"); }
      if (!input) return fail(400, "INVALID_INPUT");
      const runtime = dependencies.runtime();
      if (runtime.issuer !== config.baseUrl) return fail(503, "AI_NOT_CONFIGURED");
      const options = { ownerId: verified.user.id, issuer: config.baseUrl, execute: runtime.execute, signal: request.signal };
      const page = await createNeonPersonalRepository(options).categories("active", 0), owned = page.categories;
      const categories: VoiceCategory[] = [];
      for (const row of owned) {
        const next = { id: row.id as string, name: row.name as string };
        if (next.name.length <= 80 && Buffer.byteLength(JSON.stringify([...categories, next]), "utf8") <= 5000) categories.push(next);
      }
      const budget = dependencies.budget?.(runtime, verified.user.id, request.signal) ?? createVoiceBudget(options);
      const fingerprint = createHmac("sha256", config.cookieSecret).update(JSON.stringify([verified.user.id, config.baseUrl, input])).digest("hex");
      const allowed = await budget.reserve(input.requestId, fingerprint);
      if (!allowed.granted) return fail(allowed.reason === "budget" || allowed.reason === "rate" ? 429 : 409,
        allowed.reason === "budget" ? "AI_BUDGET_EXHAUSTED" : allowed.reason === "rate" ? "AI_BUSY" : "AI_REQUEST_REPLAY");
      // Settlement must survive a disconnected browser. Unknown billing retains the full hold.
      const cleanupSignal = AbortSignal.timeout(60000);
      reservation = { id: input.requestId, budget: dependencies.budget?.(runtime, verified.user.id, cleanupSignal)
        ?? createVoiceBudget({ ...options, signal: cleanupSignal }) };
      const result = await dependencies.infer(input, categories, request.signal);
      await reservation.budget.finish(input.requestId, result.cost);
      reservation = undefined;
      if (result.cost === null) return fail(503, result.failure && ["AI_PROVIDER_AUTH", "AI_PROVIDER_BUDGET", "AI_PROVIDER_BUSY"].includes(result.failure) ? result.failure : "AI_UNAVAILABLE");
      if (!result.draft) return fail(502, "AI_INVALID_OUTPUT");
      // Recheck the actual cookie after inference; a stale UI also discards responses by owner.
      const fresh = await dependencies.verify(request.signal);
      if (!fresh.ok) return fail(fresh.response.status, "AUTH_REQUIRED");
      if (fresh.user.id !== verified.user.id) return fail(409, "OWNER_CHANGED");
      return response({ ok: true, ownerId: verified.user.id, requestId: input.requestId, draft: result.draft,
        categoryContextLimited: page.nextOffset !== null || categories.length < owned.length,
        budget: { remainingMicros: allowed.remainingMicros } });
    } catch (error) {
      if (reservation) { try { await reservation.budget.finish(reservation.id, null); } catch { /* Durable hold stays reserved on cleanup failure. */ } }
      if (error && typeof error === "object" && "code" in error && error.code === "42501") return fail(403, "PERSONAL_ACCESS_DENIED");
      return fail(503, "AI_UNAVAILABLE");
    }
  };
}
export async function handleNeonVoice(request: Request) {
  try {
    const config = readNeonConfig(process.env), apiKey = process.env.OPENROUTER_API_KEY;
    if (!config || process.env.CREDITBOOK_AI_ENABLED !== "1" || !apiKey) return fail(503, "AI_NOT_CONFIGURED");
    return createNeonVoiceHandler(config, { verify: signal => verifyNeonSession(config, undefined, signal), runtime: getPersonalRuntime,
      infer: (input, categories, signal) => inferVoice(input, categories, apiKey, signal) })(request);
  } catch { return fail(503, "AI_NOT_CONFIGURED"); }
}
