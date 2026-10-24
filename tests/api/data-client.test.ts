import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseDataClient, type DataClient } from "@/lib/data/client";

describe("request-scoped Supabase data adapter", () => {
  function fixture(owner: string) {
    const query = { owner };
    const result = { data: owner, error: null };
    const client = {
      owner,
      from: vi.fn(function (this: { owner: string }, table: string) {
        expect(this.owner).toBe(owner);
        expect(table).toBe("profiles");
        return query;
      }),
      rpc: vi.fn(function (this: { owner: string }) {
        expect(this.owner).toBe(owner);
        return result;
      }),
      auth: { admin: {} }, storage: {},
    };
    return { client, query, result, data: createSupabaseDataClient(client as unknown as SupabaseClient) };
  }

  it("exposes only table and RPC access, not auth/admin/storage", () => {
    const { data } = fixture("A");
    expect(Object.keys(data).sort()).toEqual(["from", "rpc"]);
    expectTypeOf<keyof DataClient>().toEqualTypeOf<"from" | "rpc">();
    expectTypeOf(data.from).toEqualTypeOf<SupabaseClient["from"]>();
    expectTypeOf(data.rpc).toEqualTypeOf<SupabaseClient["rpc"]>();
    expect(data).not.toHaveProperty("auth");
    expect(data).not.toHaveProperty("storage");
  });

  it("preserves method binding and the original query builder", () => {
    const { data, query, client } = fixture("A");
    const { from } = data;
    expect(from("profiles")).toBe(query);
    expect(client.from).toHaveBeenCalledOnce();
  });

  it("passes RPC arguments and its chainable result through unchanged", () => {
    const { data, result, client } = fixture("A");
    const args = { p_shop_id: "shop-A" };
    const options = { head: true };
    expect(data.rpc("get_current_shop_id", args, options)).toBe(result);
    expect(client.rpc).toHaveBeenCalledWith("get_current_shop_id", args, options);
  });

  it("keeps two request identities isolated without a singleton", () => {
    const a = fixture("A"), b = fixture("B");
    expect(a.data).not.toBe(b.data);
    expect(a.data.rpc("identity")).toBe(a.result);
    expect(b.data.rpc("identity")).toBe(b.result);
    expect(a.data.rpc("identity")).toBe(a.result);
    expect(a.client.rpc).toHaveBeenCalledTimes(2);
    expect(b.client.rpc).toHaveBeenCalledOnce();
  });
});
