import { createNeonAuth } from "@neondatabase/auth/next/server";
import { readJsonBody } from "@/lib/api/json-body";
import { isAuthIdentity, type AuthIdentity } from "./identity";
import { readNeonConfig, type LocalNeonConfig } from "./local-config";

type AuthResult = Readonly<{ data: unknown; error: unknown }>;
export type MainAuth = {
  login(input: { email: string; password: string }): Promise<AuthResult>;
  session(): Promise<AuthResult>;
  logout(): Promise<AuthResult>;
};
type Operation = "session" | "login" | "logout";
const privateHeaders = {
  "Cache-Control": "private, no-store", "Vary": "Cookie, X-CreditBook-Owner",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
};

function reply(status: number, body: unknown) { return Response.json(body, { status, headers: privateHeaders }); }
function failure(status: number, code: string) { return reply(status, { ok: false, code }); }

// Process-local pressure limits, NOT a user/session cache. SDK 0.6 does not
// forward AbortSignal: keep the slot until the actual call settles on timeout.
let activeCalls = 0;
const loginWindows = new Map<string, { start: number; attempts: number }>();
async function bounded(work: () => Promise<AuthResult>): Promise<AuthResult> {
  if (activeCalls >= 4) throw new Error("Auth busy");
  activeCalls++;
  const task = Promise.resolve().then(work).finally(() => { activeCalls--; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([task, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Auth timeout")), 15000);
  })]); } finally { clearTimeout(timer); }
}

function hasLiveSession(result: AuthResult): boolean {
  const data = result.data as { user?: { id?: unknown }; session?: { userId?: unknown; expiresAt?: unknown } } | null;
  if (!data?.session || !data.user || data.session.userId !== data.user.id) return false;
  const expires = data.session.expiresAt;
  return (typeof expires === "string" || expires instanceof Date)
    && Number.isFinite(new Date(expires).getTime()) && new Date(expires).getTime() > Date.now();
}

function identity(result: AuthResult, config: LocalNeonConfig): AuthIdentity | null {
  const data = result.data as { user?: unknown } | null;
  if (!data || !isAuthIdentity(data.user)) return null;
  const user = data.user;
  return config.identities.some(allowed => allowed.id === user.id.toLowerCase()
    && allowed.email === user.email.toLowerCase()) ? { id: user.id.toLowerCase(), email: user.email } : null;
}

function authFailure(result: AuthResult, login = false): Response | null {
  if (!result.error) return null;
  const error = result.error as { status?: unknown; code?: unknown };
  if (error.status === 401 || error.code === "UNAUTHORIZED" || error.code === "SESSION_EXPIRED") {
    return failure(401, login ? "INVALID_CREDENTIALS" : "UNAUTHORIZED");
  }
  if (login && (error.status === 400 || error.status === 403)) return failure(401, "INVALID_CREDENTIALS");
  return failure(503, "AUTH_UNAVAILABLE");
}

/** One SDK instance per request; Next's adapter reads that request's cookies.
 * Never use the standalone Node QA jar or a global cached user in the app.
 */
function nextAuth(config: LocalNeonConfig): MainAuth {
  const auth = createNeonAuth({ baseUrl: config.baseUrl, logLevel: "silent",
    cookies: { secret: config.cookieSecret, sessionDataTtl: 300, sameSite: "lax" } });
  return {
    login: input => auth.signIn.email(input),
    // SDK 0.6 checks the STRING 'true', not the boolean. Never trust its local cache.
    session: () => auth.getSession({ query: { disableCookieCache: "true" } }),
    logout: () => auth.signOut(),
  };
}

export type VerifiedNeonSession = { ok: true; user: AuthIdentity }
  | { ok: false; response: Response };

/** Shared request-scoped verification, never a self-fetch of /api/session or a
 * decoded/client-supplied user. nextAuth reads the current Next request cookies.
 */
export async function verifyNeonSession(config: LocalNeonConfig,
  factory: () => MainAuth = () => nextAuth(config), signal?: AbortSignal): Promise<VerifiedNeonSession> {
  try {
    signal?.throwIfAborted();
    const result = await bounded(() => factory().session());
    signal?.throwIfAborted();
    const failed = authFailure(result);
    if (failed) return { ok: false, response: failed };
    if (!hasLiveSession(result)) return { ok: false, response: failure(401, "UNAUTHORIZED") };
    const user = identity(result, config);
    return user ? { ok: true, user } : { ok: false, response: failure(403, "QA_ACCESS_DENIED") };
  } catch { return { ok: false, response: failure(503, "AUTH_UNAVAILABLE") }; }
}

/** Narrow transport: no signup, password reset, email send, admin or SQL proxy. */
export function createMainAuthHandler(config: LocalNeonConfig, factory: () => MainAuth) {
  return async (request: Request, operation: Operation): Promise<Response> => {
    try {
      request.signal.throwIfAborted();
      const url = new URL(request.url), expected = new URL(config.origin);
      if (url.origin !== expected.origin || request.headers.get("host") !== expected.host) return failure(403, "INVALID_HOST");
      if (request.headers.has("authorization")) return failure(401, "COOKIE_SESSION_REQUIRED");
      const origin = request.headers.get("origin");
      const site = request.headers.get("sec-fetch-site");
      if ((origin !== null && origin !== config.origin) || (site && site !== "same-origin" && site !== "none")) return failure(403, "INVALID_ORIGIN");
      if (operation === "session") {
        if (request.method !== "GET") return failure(405, "METHOD_NOT_ALLOWED");
        if (url.search) return failure(400, "INVALID_INPUT");
      } else {
        if (request.method !== "POST") return failure(405, "METHOD_NOT_ALLOWED");
        if (origin !== config.origin) return failure(403, "INVALID_ORIGIN");
        if (url.search) return failure(400, "INVALID_INPUT");
        if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return failure(415, "JSON_REQUIRED");
      }
      let body: Record<string, unknown> = {};
      if (operation !== "session") {
        let input: unknown;
        try { input = await readJsonBody(request); }
        catch { return failure(400, "INVALID_INPUT"); }
        if (!input || typeof input !== "object" || Array.isArray(input)) return failure(400, "INVALID_INPUT");
        body = input as Record<string, unknown>;
      }
      if (operation === "login") {
        if (Object.keys(body).some(key => key !== "email" && key !== "password")
          || typeof body.email !== "string" || typeof body.password !== "string"
          || body.password.length < 1 || body.password.length > 1024) return failure(400, "INVALID_INPUT");
        const email = body.email.trim().toLowerCase();
        if (!config.identities.some(user => user.email === email)) return failure(401, "INVALID_CREDENTIALS");
        let window = loginWindows.get(email);
        if (!window || Date.now() - window.start >= 60000) {
          window = { start: Date.now(), attempts: 0 }; loginWindows.set(email, window);
        }
        if (++window.attempts > 8) return failure(429, "TRY_LATER");
        const credentials = { email, password: body.password };
        const auth = factory();
        const result = await bounded(() => auth.login(credentials));
        const failed = authFailure(result, true);
        if (failed) return failed;
        const user = identity(result, config);
        if (!user || user.email.toLowerCase() !== email) return failure(403, "QA_ACCESS_DENIED");
        // Do not forward provider data: it includes the session token.
        // A separate browser request verifies the newly committed cookie. The
        // stock Next adapter reads incoming headers, not login's pending cookie.
        return reply(200, { ok: true, user });
      }
      if (Object.keys(body).length) return failure(400, "INVALID_INPUT");
      const auth = factory();
      const result = await bounded(() => auth.session());
      const failed = authFailure(result);
      if (failed) return failed;
      if (!hasLiveSession(result)) return failure(401, "UNAUTHORIZED");
      const user = identity(result, config);
      if (!user) return failure(403, "QA_ACCESS_DENIED");
      const intent = request.headers.get("X-CreditBook-Owner");
      if ((operation === "logout" && !intent) || (intent !== null && intent !== user.id)) return failure(409, "OWNER_CHANGED");
      if (operation === "logout") {
        const result = await bounded(() => auth.logout());
        const failed = authFailure(result);
        return failed ?? reply(200, { ok: true });
      }
      return reply(200, { ok: true, user });
    } catch {
      // Never return/log provider errors, input passwords, cookies or session payloads.
      return failure(503, "AUTH_UNAVAILABLE");
    }
  };
}

export async function handleMainAuth(request: Request, operation: Operation): Promise<Response> {
  let config;
  try { config = readNeonConfig(process.env); }
  catch { return failure(503, "AUTH_NOT_CONFIGURED"); }
  if (!config) return failure(404, "NOT_FOUND");
  return createMainAuthHandler(config, () => nextAuth(config))(request, operation);
}
