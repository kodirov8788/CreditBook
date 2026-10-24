import { afterEach, describe, expect, it, vi } from "vitest";
import { createNeonQaAuthFactory } from "../../lib/auth/neon-qa-sdk.ts";
import { NEON_AUTH_SESSION_COOKIE_NAME } from "@neondatabase/auth/server";

const a = "10000000-0000-4000-8000-000000000001", b = "10000000-0000-4000-8000-000000000002";
const config = { baseUrl: "https://ep-qa.neonauth.us-east-2.aws.neon.tech/neondb/auth", cookieSecret: "synthetic-secret-".repeat(3), origin: "http://localhost:4180", qaEmails: ["a@example.invalid", "b@example.invalid"] };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("published Neon SDK QA adapter (stubbed upstream)", () => {
  it("rejects non-Neon/TLS/credential URLs, short secrets and broad email scope", () => {
    for (const baseUrl of ["https://example.invalid", "http://ep-qa.neonauth.aws.neon.tech/auth", "https://x:y@ep-qa.neonauth.aws.neon.tech/auth", config.baseUrl + "?target=bad"]) {
      expect(() => createNeonQaAuthFactory({ ...config, baseUrl })).toThrow();
    }
    expect(() => createNeonQaAuthFactory({ ...config, cookieSecret: "short" })).toThrow();
    expect(() => createNeonQaAuthFactory({ ...config, qaEmails: ["a@example.invalid"] })).toThrow();
    for (const origin of ["http://127.0.0.1:4180", "http://localhost", "https://localhost:4180", "http://localhost:4180/", "http://localhost.evil.invalid:4180"]) {
      expect(() => createNeonQaAuthFactory({ ...config, origin })).toThrow();
    }
  });
  it("forces the exact uncached query on every session read and captures A/B cookies", async () => {
    const seen: { url: string; cookie: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const cookie = new Headers(init?.headers).get("cookie") ?? "";
      seen.push({ url: String(url), cookie });
      return Response.json({ user: { id: cookie.includes("synthetic-a") ? a : b }, session: { id: "synthetic-session", token: "not-returned-by-qa-api" } });
    }));
    const factory = createNeonQaAuthFactory(config);
    const authA = factory(new Request(config.origin, { headers: { cookie: `${NEON_AUTH_SESSION_COOKIE_NAME}=synthetic-a` } }), () => {});
    const authB = factory(new Request(config.origin, { headers: { cookie: `${NEON_AUTH_SESSION_COOKIE_NAME}=synthetic-b` } }), () => {});
    const results = await Promise.all([authA.session(), authB.session(), authA.session()]);
    expect(results.map(result => (result.data as { user: { id: string } }).user.id)).toEqual([a, b, a]);
    expect(seen).toHaveLength(3);
    for (const call of seen) {
      const url = new URL(call.url);
      expect(url.origin).toBe(new URL(config.baseUrl).origin);
      expect(url.pathname).toBe("/neondb/auth/get-session");
      expect(url.searchParams.get("disableCookieCache")).toBe("true");
    }
    expect(seen[0].cookie).not.toBe(seen[1].cookie);
  });
  it("does not send another email's credentials to Neon", async () => {
    const upstream = vi.fn();vi.stubGlobal("fetch", upstream);
    const auth = createNeonQaAuthFactory(config)(new Request(config.origin), () => {});
    const result = await auth.login({ email: "outside@example.invalid", password: "synthetic-password" });
    expect(result.error).toEqual({ code: "QA_LOGIN_DENIED" });expect(upstream).not.toHaveBeenCalled();
  });
  it("bounds stalled upstream work without releasing its concurrency slot early", async () => {
    vi.useFakeTimers();
    const upstream = vi.fn(() => new Promise<Response>(() => {}));vi.stubGlobal("fetch", upstream);
    const auth = createNeonQaAuthFactory(config)(new Request(config.origin), () => {});
    const pending = [auth.session(), auth.session(), auth.session(), auth.session()];
    expect((await auth.session()).error).toEqual({ code: "NETWORK_QA_BUSY" });
    await vi.advanceTimersByTimeAsync(15000);
    expect((await Promise.all(pending)).every(result => (result.error as { code: string }).code === "NETWORK_QA_TIMEOUT")).toBe(true);
    expect((await auth.session()).error).toEqual({ code: "NETWORK_QA_BUSY" });
    expect(upstream).toHaveBeenCalledTimes(4);
  });
  it("preserves separate Set-Cookie headers and in-request refreshed cookies", async () => {
    let step = 0;
    const appended: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("sign-in/email")) {
        const headers = new Headers();
        headers.append("Set-Cookie", `${NEON_AUTH_SESSION_COOKIE_NAME}=synthetic-new; Path=/; HttpOnly; SameSite=Lax`);
        return Response.json({ user: { id: a }, token: "synthetic-new" }, { headers });
      }
      step++;
      expect(new Headers(init?.headers).get("cookie")).toContain("synthetic-new");
      return Response.json({ user: { id: a }, session: { id: "qa" } });
    }));
    const auth = createNeonQaAuthFactory(config)(new Request(config.origin), cookie => appended.push(cookie));
    expect((await auth.login({ email: "a@example.invalid", password: "synthetic-only" })).error).toBeNull();
    expect((await auth.session()).error).toBeNull();
    expect(step).toBeGreaterThan(0);
    expect(appended.some(cookie => cookie.startsWith(NEON_AUTH_SESSION_COOKIE_NAME + "="))).toBe(true);
    expect(appended.every(cookie => cookie.includes("HttpOnly"))).toBe(true);
  });
});
