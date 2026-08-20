import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfiguredAppOrigin, getTrustedInviteOrigin } from "@/lib/app-url";

describe("trusted app URL handling", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the configured HTTPS origin and removes any path", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://creditbook.example/team");
    expect(getConfiguredAppOrigin()).toBe("https://creditbook.example");
  });

  it("allows the request origin only for local development", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(getTrustedInviteOrigin(new Request("http://localhost:3000/api/team"))).toBe("http://localhost:3000");
  });

  it("fails closed for production invites without a configured HTTPS origin", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(getTrustedInviteOrigin(new Request("https://attacker.example/api/team"))).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://creditbook.example");
    expect(getConfiguredAppOrigin()).toBeNull();
  });
});
