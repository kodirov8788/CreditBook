import { afterEach, describe, expect, it, vi } from "vitest";
import { createNeonQaPasswordAuth, assertApprovedQaPasswordTargets } from "../../lib/auth/neon-qa-password-sdk.ts";
import { APPROVED_QA_AUTH_BASE_URL } from "../../lib/auth/neon-qa-sdk.ts";

const config = { baseUrl: APPROVED_QA_AUTH_BASE_URL, origin: "http://localhost:4180", cookieSecret: "synthetic-only-secret-".repeat(3), qaEmails: ["a@example.invalid", "b@example.invalid"] };
afterEach(() => { vi.useRealTimers();vi.unstubAllGlobals(); });
describe("published SDK password operations (stubbed upstream only)", () => {
  it("rejects unapproved recipient/identity pairs before any SDK request", () => {
    expect(() => assertApprovedQaPasswordTargets(["a@example.invalid", "b@example.invalid"], ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"])).toThrow("exact approved");
    expect(() => assertApprovedQaPasswordTargets([], [])).toThrow();
  });
  it("rejects another tenant, non-loopback origin and broad recipients", () => {
    expect(() => createNeonQaPasswordAuth({ ...config, baseUrl: "https://other.neonauth.aws.neon.tech/auth" })).toThrow();
    expect(() => createNeonQaPasswordAuth({ ...config, origin: "http://127.0.0.1:4180" })).toThrow();
    expect(() => createNeonQaPasswordAuth({ ...config, qaEmails: ["a@example.invalid"] })).toThrow();
  });
  it("does not send requests to unapproved emails or callback locations", async () => {
    const upstream = vi.fn();vi.stubGlobal("fetch", upstream);
    const auth = createNeonQaPasswordAuth(config);
    for (const input of [{ email: "outside@example.invalid", redirectTo: config.origin + "/qa/password-setup?state=" + "a".repeat(64) }, { email: config.qaEmails[0], redirectTo: "https://example.invalid/qa/password-setup" }, { email: config.qaEmails[0], redirectTo: config.origin + "/qa/password-setup?state=" + "a".repeat(64) + "&redirect=bad" }]) {
      expect((await auth.request(input)).error).toEqual({ code: "SETUP_DENIED" });
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it("uses the public SDK's exact body contract and never inherits Auth cookies", async () => {
    const seen: { url: string; body: Record<string, string>; cookie: string | null; origin: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      seen.push({ url: String(url), body: JSON.parse(String(options?.body)), cookie: new Headers(options?.headers).get("cookie"), origin: new Headers(options?.headers).get("origin") });
      return Response.json({ status: true });
    }));
    const auth = createNeonQaPasswordAuth(config), redirectTo = config.origin + "/qa/password-setup?state=" + "a".repeat(64);
    expect((await auth.request({ email: config.qaEmails[0], redirectTo })).error).toBeNull();
    expect((await auth.complete({ token: "synthetic-token", newPassword: "synthetic-password-only" })).error).toBeNull();
    expect(seen.map(call => new URL(call.url).pathname)).toEqual(["/neondb/auth/request-password-reset", "/neondb/auth/reset-password"]);
    expect(seen[0].body).toEqual({ email: config.qaEmails[0], redirectTo });
    expect(seen[1].body).toEqual({ token: "synthetic-token", newPassword: "synthetic-password-only" });
    expect(seen.every(call => !call.cookie && call.origin === config.origin)).toBe(true);
  });
  it("bounds response time without freeing an outstanding SDK slot", async () => {
    vi.useFakeTimers();const upstream = vi.fn(() => new Promise<Response>(() => {}));vi.stubGlobal("fetch", upstream);
    const auth = createNeonQaPasswordAuth(config);
    const first = auth.complete({ token: "synthetic-token", newPassword: "synthetic-password-only" });
    const second = auth.complete({ token: "synthetic-token-2", newPassword: "synthetic-password-only" });
    expect((await auth.complete({ token: "third-synthetic", newPassword: "synthetic-password-only" })).error).toEqual({ code: "SETUP_BUSY" });
    await vi.advanceTimersByTimeAsync(15000);
    expect((await first).error).toEqual({ code: "SETUP_TIMEOUT" });expect((await second).error).toEqual({ code: "SETUP_TIMEOUT" });
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  it("normalizes a vendor callback rejection without sending real email", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "INVALID_CALLBACK_URL", message: "Invalid callbackURL" }, { status: 403 })));
    const result = await createNeonQaPasswordAuth(config).request({ email: config.qaEmails[0], redirectTo: config.origin + "/qa/password-setup?state=" + "a".repeat(64) });
    expect(result.error).toMatchObject({ code: "feature_not_supported", status: 403, message: "Invalid callbackURL" });
  });
});
