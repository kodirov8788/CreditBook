import {
  createAuthServer, extractNeonAuthCookies, serializeSetCookie, resolveNeonAuthLogging,
} from "@neondatabase/auth/server";
import type { QaAuthFactory, QaAuthResult } from "./neon-qa.ts";

export const APPROVED_QA_AUTH_BASE_URL = "https://ep-long-cherry-b4u07ix0.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth";

/** Only an explicitly configured Neon QA endpoint; never ambient Supabase env. */
export function createNeonQaAuthFactory(config: { baseUrl: string; cookieSecret: string; origin: string; qaEmails: readonly string[] }): QaAuthFactory {
  const local = new URL(config.origin);
  if (local.protocol !== "http:" || local.hostname !== "localhost" || !local.port || local.origin !== config.origin) {
    throw new Error("Only the exact localhost QA origin is permitted.");
  }
  const url = new URL(config.baseUrl);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".neon.tech") || !url.hostname.includes(".neonauth.")
    || url.username || url.password || url.search || url.hash || url.port) throw new Error("Explicit HTTPS Neon Auth URL required.");
  if (config.cookieSecret.length < 32) throw new Error("A separate local QA cookie secret is required.");
  const qaEmails = new Set(config.qaEmails.map(email => email.trim().toLowerCase()));
  if (qaEmails.size !== 2 || [...qaEmails].some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error("Exactly two existing QA emails are required; email is not authorization.");
  }
  const { baseUrl, cookieSecret, origin } = config;
  let inFlight = 0;
  let loginWindow = Date.now(), loginAttempts = 0;
  async function bounded(work: () => Promise<QaAuthResult>): Promise<QaAuthResult> {
    if (inFlight >= 4) return { data: null, error: { code: "NETWORK_QA_BUSY" } };
    inFlight++;
    // SDK v0.6 does not forward AbortSignal. Bound the response and retain the
    // concurrency slot until the actual upstream call settles, even on timeout.
    const task = Promise.resolve().then(work).finally(() => { inFlight--; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([task, new Promise<QaAuthResult>(resolve => {
      timer = setTimeout(() => resolve({ data: null, error: { code: "NETWORK_QA_TIMEOUT" } }), 15000);
    })]); } finally { clearTimeout(timer); }
  }
  return (request, appendCookie) => {
    // This jar belongs to ONE HTTP request. In-request login/refresh updates it;
    // another request/account can never overwrite its captured incoming cookies.
    const jar = new Map(extractNeonAuthCookies(request.headers.get("cookie") ?? "")
      .split(";").map(piece => piece.trim()).filter(Boolean).map(piece => {
        const index = piece.indexOf("=");
        return [piece.slice(0, index), piece.slice(index + 1)] as const;
      }));
    const auth = createAuthServer({
      baseUrl, cookieSecret, sessionDataTtl: 300, sameSite: "lax",
      log: resolveNeonAuthLogging({ logLevel: "silent" }),
      context: () => ({
        getCookies: () => [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
        setCookie(name, value, options) {
          appendCookie(serializeSetCookie({ name, value, ...options }));
          if (options.maxAge === 0 || (options.expires && options.expires.getTime() <= Date.now())) jar.delete(name);
          else jar.set(name, value);
        },
        // A configured loopback origin, never forwarded headers supplied by a caller.
        getOrigin: () => origin,
        getHeader: name => name.toLowerCase() === "origin" ? origin : null,
        getFramework: () => "creditbook-local-qa",
      }),
    });
    return {
      // Restrict hosted login attempts to the two approved QA accounts. Actual
      // authorization still requires the verified UUID allowlist, not this email.
      login(input) {
        if (!qaEmails.has(input.email.toLowerCase())) return Promise.resolve({ data: null, error: { code: "QA_LOGIN_DENIED" } });
        if (Date.now() - loginWindow >= 60000) { loginWindow = Date.now(); loginAttempts = 0; }
        if (++loginAttempts > 8) return Promise.resolve({ data: null, error: { code: "NETWORK_QA_RATE_LIMIT" } });
        return bounded(() => auth.signIn.email(input));
      },
      // The published SDK tests the STRING 'true'. Boolean true keeps the cache.
      session: () => bounded(() => auth.getSession({ query: { disableCookieCache: "true" } })),
      logout: () => bounded(() => auth.signOut()),
    };
  };
}
