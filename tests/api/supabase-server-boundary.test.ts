import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

describe("unchanged Supabase Auth server transport", () => {
  const store = { getAll: vi.fn(), set: vi.fn() };
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.example.invalid");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-public-key");
    vi.mocked(cookies).mockResolvedValue(store as unknown as Awaited<ReturnType<typeof cookies>>);
  });

  it("keeps the existing Auth URL/key rather than substituting a data URL", async () => {
    await createClient();
    expect(createServerClient).toHaveBeenCalledWith(
      "https://auth.example.invalid", "synthetic-public-key", expect.any(Object),
    );
  });

  it("keeps cookie reads and refresh writes on the request's store", async () => {
    const values = [{ name: "synthetic-session", value: "fixture-only" }];
    store.getAll.mockReturnValue(values);
    await createClient();
    const options = vi.mocked(createServerClient).mock.calls[0][2];
    expect(options.cookies.getAll?.()).toBe(values);
    options.cookies.setAll?.([{ name: "synthetic-session", value: "refreshed-fixture", options: { httpOnly: true } }], {});
    expect(store.set).toHaveBeenCalledWith("synthetic-session", "refreshed-fixture", { httpOnly: true });
  });

  it("retains bearer authorization for the same client used by data access", async () => {
    await createClient(new Request("http://localhost/api/test", {
      headers: { authorization: "Bearer synthetic-test-token" },
    }));
    const options = vi.mocked(createServerClient).mock.calls[0][2];
    expect(options.global?.headers).toEqual({ Authorization: "Bearer synthetic-test-token" });
  });

  it("does not construct a client when Auth configuration is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(await createClient()).toBeNull();
    expect(createServerClient).not.toHaveBeenCalled();
    expect(cookies).not.toHaveBeenCalled();
  });
});
