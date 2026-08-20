import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listShops } from "@/app/api/shops/route";
import { POST as switchShop } from "@/app/api/shop/switch/route";
import { getAuthenticatedClient } from "@/lib/api/auth";

vi.mock("@/lib/api/auth", () => ({ getAuthenticatedClient: vi.fn() }));

const authMock = vi.mocked(getAuthenticatedClient);

function request(body?: unknown) {
  return new Request("http://localhost/api/shop/switch", body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("shop switching", () => {
  beforeEach(() => authMock.mockReset());

  it("requires authentication", async () => {
    authMock.mockResolvedValue({ supabase: null, user: null });
    await expect(switchShop(request({ shopId: "11111111-1111-4111-8111-111111111111" }))).resolves.toMatchObject({ status: 401 });
    await expect(listShops(request())).resolves.toMatchObject({ status: 401 });
  });

  it("validates a shop id before calling Supabase", async () => {
    const rpc = vi.fn();
    authMock.mockResolvedValue({ supabase: { rpc } as never, user: { id: "user-1" } as never });
    await expect(switchShop(request({ shopId: "not-a-uuid" }))).resolves.toMatchObject({ status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("switches only through the membership-checked RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "11111111-1111-4111-8111-111111111111", error: null });
    authMock.mockResolvedValue({ supabase: { rpc } as never, user: { id: "user-1" } as never });
    const response = await switchShop(request({ shopId: "11111111-1111-4111-8111-111111111111" }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("switch_current_shop", { p_shop_id: "11111111-1111-4111-8111-111111111111" });
  });

  it("lists shops through the tenant-aware shop-list RPC", async () => {
    const rpc = vi.fn((name: string) => {
      if (name === "list_user_shops") return Promise.resolve({ data: [{ id: "shop-1", name: "Birinchi shop" }], error: null });
      return Promise.resolve({ data: "shop-1", error: null });
    });
    authMock.mockResolvedValue({ supabase: { rpc } as never, user: { id: "user-1" } as never });

    const response = await listShops(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ shops: [{ id: "shop-1", name: "Birinchi shop" }], currentShopId: "shop-1" });
    expect(rpc).toHaveBeenCalledWith("list_user_shops");
    expect(rpc).toHaveBeenCalledWith("get_current_shop_id");
  });

  it("maps membership rejection to forbidden", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } });
    authMock.mockResolvedValue({ supabase: { rpc } as never, user: { id: "user-1" } as never });
    await expect(switchShop(request({ shopId: "11111111-1111-4111-8111-111111111111" }))).resolves.toMatchObject({ status: 403 });
  });
});
