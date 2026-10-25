import { randomBytes } from "node:crypto";
import { NEON_AUTH_NETWORK_ERROR_CODES } from "@neondatabase/auth/server";
import { jsonBody, qaSecurityHeaders } from "./neon-qa.ts";
import type { QaAuthResult } from "./neon-qa.ts";
import type { QaPasswordAuth } from "./neon-qa-password-sdk.ts";

const path = "/qa/password-setup";
const cookieName = "__Host-creditbook.qa-password-setup";
const lifetime = 30 * 60 * 1000;
type Entry = {
  label: string; expires: number; phase: "waiting" | "ready" | "working" | "used";
  token?: string; handle?: string; intent?: string;
};
const succeeded = (result: QaAuthResult) => !result.error && !!result.data && typeof result.data === "object"
  && "status" in result.data && result.data.status === true;

/** No email-send HTTP endpoint. Sending is a one-shot, explicitly invoked CLI action. */
export function createQaPasswordSetup(config: {
  origin: string; qaEmails: readonly string[]; auth: QaPasswordAuth; page: string;
  now?: () => number;
}) {
  const origin = new URL(config.origin), now = config.now ?? Date.now;
  if (origin.protocol !== "http:" || origin.hostname !== "localhost" || !origin.port || origin.origin !== config.origin) {
    throw new Error("A fixed loopback QA origin is required.");
  }
  const emails = [...new Set(config.qaEmails.map(email => email.trim().toLowerCase()))];
  if (emails.length !== 2 || emails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error("Exactly two approved QA emails are required.");
  }
  const entries = new Map<string, Entry>();
  let sent = false;
  const cookie = (value: string, maxAge = lifetime / 1000) => `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
  const failureCode = (result: QaAuthResult) => {
    const code = result.error && typeof result.error === "object" && "code" in result.error ? result.error.code : undefined;
    // Only static vendor/network codes or a numeric HTTP status may be reported.
    // Never log the upstream message, body, headers, callback, token or email.
    const safe = ["RESET_PASSWORD_DISABLED", "INVALID_ORIGIN", "INVALID_CALLBACK_URL", "INVALID_REDIRECT_URL",
      "MISSING_OR_NULL_ORIGIN", "FAILED_TO_CREATE_VERIFICATION", "SETUP_TIMEOUT", ...NEON_AUTH_NETWORK_ERROR_CODES];
    if (typeof code === "string" && safe.includes(code)) return code;
    const status = result.error && typeof result.error === "object" && "status" in result.error ? result.error.status : undefined;
    // SDK v0.6 normalizes vendor codes but retains these exact static messages.
    // Categorize only exact matches, never emit arbitrary upstream text.
    const message = result.error && typeof result.error === "object" && "message" in result.error ? result.error.message : undefined;
    if (status === 403 && typeof message === "string") {
      const known = new Map([
        ["Invalid origin", "INVALID_ORIGIN"],
        ["Invalid callbackURL", "INVALID_CALLBACK_URL"],
        ["Invalid redirectURL", "INVALID_REDIRECT_URL"],
      ]);
      const reason = known.get(message);
      if (reason) return reason;
    }
    if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) return `SETUP_HTTP_${status}`;
    return result.error ? "SETUP_UNCONFIRMED" : "SETUP_REPLY_UNEXPECTED";
  };
  function current(request: Request) {
    const pieces = (request.headers.get("cookie") ?? "").split(";").map(piece => piece.trim())
      .filter(piece => piece.startsWith(cookieName + "="));
    if (pieces.length !== 1) return undefined;
    const handle = pieces[0].slice(cookieName.length + 1);
    if (!/^[a-f0-9]{64}$/.test(handle)) return undefined;
    return [...entries.values()].find(entry => entry.handle === handle && entry.expires > now());
  }
  return {
    async sendApproved() {
      if (sent) throw new Error("Setup requests already attempted; no automatic resending.");
      sent = true;
      const outcomes: { label: string; accepted: boolean; code?: string }[] = [];
      for (const [index, email] of emails.entries()) {
        const state = randomBytes(32).toString("hex");
        const label = `QA ${index === 0 ? "A" : "B"}`;
        entries.set(state, { label, expires: now() + lifetime, phase: "waiting" });
        let result: QaAuthResult;
        try { result = await config.auth.request({ email, redirectTo: `${origin.origin}${path}?state=${state}` }); }
        catch { result = { data: null, error: { code: "SETUP_UNCONFIRMED" } }; }
        if (succeeded(result)) outcomes.push({ label, accepted: true });
        else {
          const code = failureCode(result);
          // A timeout may follow a successful email dispatch. Keep its callback
          // usable without sending again; discard only definitive rejections.
          if (["RESET_PASSWORD_DISABLED", "INVALID_ORIGIN", "INVALID_CALLBACK_URL", "INVALID_REDIRECT_URL", "MISSING_OR_NULL_ORIGIN"].includes(code)) entries.delete(state);
          outcomes.push({ label, accepted: false, code });
        }
      }
      return outcomes;
    },
    async handle(request: Request): Promise<Response | undefined> {
      const url = new URL(request.url);
      if (url.pathname !== path && url.pathname !== path + "/status" && url.pathname !== path + "/complete") return undefined;
      const headers = qaSecurityHeaders();
      const reply = (status: number, body: unknown) => {
        headers.set("Content-Type", "application/json; charset=utf-8");
        return new Response(JSON.stringify(body), { status, headers });
      };
      const error = (status: number, code: string) => reply(status, { code, error: "Havola yoki so‘rov yaroqsiz. Parolni qayta yubormang; kerak bo‘lsa loginni tekshiring." });
      try {
        request.signal.throwIfAborted();
        if (url.origin !== origin.origin || request.headers.get("host") !== origin.host) return error(403, "INVALID_HOST");
        if (request.headers.has("authorization")) return error(401, "UNAUTHORIZED");
        if (request.method !== "GET" && request.method !== "POST") return error(405, "METHOD_NOT_ALLOWED");
        if (request.method === "POST" && request.headers.get("origin") !== origin.origin) return error(403, "INVALID_ORIGIN");
        if (request.method === "GET" && url.pathname === path) {
          if (url.search) {
            // Callback secrets never reach page JS or a response body. Always
            // redirect to the clean URL, including malformed/expired callbacks.
            const state = url.searchParams.get("state") ?? "", token = url.searchParams.get("token") ?? "";
            const entry = entries.get(state);
            const valid = /^[a-f0-9]{64}$/.test(state) && /^[A-Za-z0-9._~-]{8,1024}$/.test(token)
              && [...url.searchParams.keys()].sort().join(",") === "state,token"
              && entry?.phase === "waiting" && entry.expires > now();
            if (valid && entry) {
              entry.phase = "ready"; entry.token = token;
              entry.handle = randomBytes(32).toString("hex"); entry.intent = randomBytes(16).toString("hex");
              headers.append("Set-Cookie", cookie(entry.handle));
            } else headers.append("Set-Cookie", cookie("", 0));
            headers.set("Location", path);
            return new Response(null, { status: 303, headers });
          }
          headers.set("Content-Type", "text/html; charset=utf-8");
          return new Response(config.page, { headers });
        }
        if (url.search) return error(400, "INVALID_INPUT");
        const entry = current(request);
        if (!entry || entry.phase !== "ready") return error(401, "SETUP_LINK_REQUIRED");
        if (request.method === "GET" && url.pathname === path + "/status") {
          return reply(200, { ready: true, label: entry.label, intent: entry.intent });
        }
        if (request.method !== "POST" || url.pathname !== path + "/complete") return error(405, "METHOD_NOT_ALLOWED");
        if (!entry.intent || request.headers.get("X-CreditBook-Setup") !== entry.intent) return error(409, "SETUP_CHANGED");
        const body = await jsonBody(request);
        try {
          if (Object.keys(body).some(key => key !== "newPassword" && key !== "confirmation")
            || typeof body.newPassword !== "string" || body.newPassword.length < 8 || body.newPassword.length > 128
            || body.newPassword !== body.confirmation || !entry.token) return error(400, "INVALID_INPUT");
          request.signal.throwIfAborted();
          // Claim synchronously before awaiting, so concurrent forms cannot both
          // dispatch a credential change. Unknown upstream outcomes are not retried.
          if (entry.phase !== "ready") return error(409, "SETUP_CHANGED");
          entry.phase = "working";
          const token = entry.token; entry.token = undefined;
          let result: QaAuthResult;
          try { result = await config.auth.complete({ token, newPassword: body.newPassword }); }
          catch { result = { data: null, error: { code: "SETUP_UNCONFIRMED" } }; }
          entry.phase = "used"; entry.intent = undefined; entry.handle = undefined;
          headers.append("Set-Cookie", cookie("", 0));
          return succeeded(result) ? reply(200, { ok: true }) : error(503, "SETUP_UNCONFIRMED");
        } finally { body.newPassword = ""; body.confirmation = ""; }
      } catch { return error(400, "SETUP_FAILED"); }
    },
    dispose() { entries.clear(); },
  };
}
