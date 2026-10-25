import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedClient } from "@/lib/api/auth";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
const create = vi.mocked(createClient);

describe("existing Auth and separated API data access", () => {
  beforeEach(() => vi.resetAllMocks());

  function fixture(id = "A") {
    const user = { id };
    const getUser = vi.fn().mockResolvedValue({ data: { user }, error: null });
    const from = vi.fn(), rpc = vi.fn();
    const client = { auth: { getUser }, from, rpc };
    create.mockResolvedValue(client as unknown as SupabaseClient);
    return { user, client, getUser, from, rpc };
  }

  it("keeps cookie authentication and the verified user unchanged", async () => {
    const f = fixture();
    const request = new Request("http://localhost/api/customers");
    const result = await getAuthenticatedClient(request);
    expect(create).toHaveBeenCalledWith(request);
    expect(f.getUser).toHaveBeenCalledWith();
    expect(result.user).toBe(f.user);
    expect(result.supabase).not.toBe(f.client);
    expect(result.supabase).not.toHaveProperty("auth");
    result.supabase?.from("customers");
    expect(f.from).toHaveBeenCalledWith("customers");
  });

  it("passes the existing bearer token to Auth verification", async () => {
    const f = fixture();
    await getAuthenticatedClient(new Request("http://localhost/api/customers", {
      headers: { authorization: "Bearer synthetic-test-token" },
    }));
    expect(f.getUser).toHaveBeenCalledWith("synthetic-test-token");
  });

  it("does not expose data access without a configured Auth client", async () => {
    create.mockResolvedValue(null);
    expect(await getAuthenticatedClient()).toEqual({ supabase: null, user: null });
  });

  it("rejects a missing user before any database request", async () => {
    const f = fixture();
    f.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await getAuthenticatedClient()).toEqual({ supabase: null, user: null });
    expect(f.from).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when Auth returns an error even with a user payload", async () => {
    const f = fixture();
    f.getUser.mockResolvedValue({ data: { user: f.user }, error: { message: "synthetic rejection" } });
    expect(await getAuthenticatedClient()).toEqual({ supabase: null, user: null });
    expect(f.from).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("propagates transport errors instead of silently returning a cached identity", async () => {
    const f = fixture();
    f.getUser.mockRejectedValue(new Error("synthetic transport failure"));
    await expect(getAuthenticatedClient()).rejects.toThrow("synthetic transport failure");
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("preserves A and B request bindings after another account authenticates", async () => {
    const a = fixture("A");
    const first = await getAuthenticatedClient();
    const b = fixture("B");
    const second = await getAuthenticatedClient();
    first.supabase?.rpc("get_current_shop_id");
    second.supabase?.rpc("get_current_shop_id");
    expect(first.user?.id).toBe("A");
    expect(second.user?.id).toBe("B");
    expect(a.rpc).toHaveBeenCalledOnce();
    expect(b.rpc).toHaveBeenCalledOnce();
  });
});
