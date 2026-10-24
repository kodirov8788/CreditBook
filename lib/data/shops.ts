import type { DataClient } from "./client";
import type { NeonRows, NeonStatement } from "./neon-owner";
import { NeonOwnerAuthorizationError } from "./neon-owner.ts";

export type ShopSummary = { id: string; name: string };
export type ShopSelection = { shops: ShopSummary[]; currentShopId: string | null };
export interface ShopRepository {
  list(): Promise<ShopSelection>;
  switchTo(shopId: string): Promise<string>;
}

export class ShopRepositoryError extends Error {
  readonly code?: string;
  constructor(code?: string) {
    super("Shop data operation failed.");
    this.name = "ShopRepositoryError";
    this.code = code;
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isShopId(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function selection(value: unknown): ShopSelection {
  if (!record(value) || !Array.isArray(value.shops) ||
    !(value.currentShopId === null || typeof value.currentShopId === "string")) {
    throw new ShopRepositoryError();
  }
  const shops = value.shops.map((shop: unknown): ShopSummary => {
    if (!record(shop) || typeof shop.id !== "string" || typeof shop.name !== "string") {
      throw new ShopRepositoryError();
    }
    return { id: shop.id, name: shop.name };
  });
  return { shops, currentShopId: value.currentShopId };
}

// The application continues to use its request-scoped Supabase client and RLS.
export function createSupabaseShopRepository(client: DataClient): ShopRepository {
  return {
    async list() {
      const [shops, current] = await Promise.all([
        client.rpc("list_user_shops"), client.rpc("get_current_shop_id"),
      ]);
      if (shops.error || current.error) throw new ShopRepositoryError();
      return selection({ shops: shops.data ?? [], currentShopId: current.data ?? null });
    },
    async switchTo(shopId) {
      if (!isShopId(shopId)) throw new ShopRepositoryError("22023");
      const result = await client.rpc("switch_current_shop", { p_shop_id: shopId });
      if (result.error) throw new ShopRepositoryError(result.error.code);
      if (typeof result.data !== "string") throw new ShopRepositoryError();
      return result.data;
    },
  };
}

// Trusted server composition ONLY: run must close over runNeonOwnerBatch with
// the captured Supabase token and expected UUID. It is not a raw SQL executor.
// Deliberately unmounted: no environment switch or browser SQL/owner input.
export type OwnerBoundShopQuery = (statements: readonly NeonStatement[]) => Promise<readonly NeonRows[]>;
export function createNeonShopRepository(run: OwnerBoundShopQuery): ShopRepository {
  async function query(statement: NeonStatement): Promise<unknown> {
    try {
      const result = await run([statement]);
      if (result.length !== 1 || result[0].length !== 1) throw new ShopRepositoryError();
      return result[0][0].result;
    } catch (error) {
      if (error instanceof NeonOwnerAuthorizationError) throw error;
      const code = record(error) && typeof error.code === "string" ? error.code : undefined;
      throw new ShopRepositoryError(code);
    }
  }
  return {
    async list() {
      return selection(await query({
        text: "select creditbook_neon_private.shop_selection() as result", values: [],
      }));
    },
    async switchTo(shopId) {
      if (!isShopId(shopId)) throw new ShopRepositoryError("22023");
      const result = await query({
        text: "select creditbook_neon_private.switch_shop($1::uuid) as result", values: [shopId],
      });
      if (typeof result !== "string" || result !== shopId) throw new ShopRepositoryError();
      return result;
    },
  };
}
