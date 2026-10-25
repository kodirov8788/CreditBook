import type { DataClient } from "./client";
import type { OwnerBoundShopQuery } from "./shops";

export interface ShopPermissionRepository {
  currentAccess(permission: string): Promise<string | null>;
}

// Existing request client: no new Auth, service role or ambient provider switch.
export function createSupabaseShopPermissions(client: DataClient): ShopPermissionRepository {
  return {
    async currentAccess(permission) {
      const current = await client.rpc("get_current_shop_id");
      if (current.error || typeof current.data !== "string" || !current.data) return null;
      const allowed = await client.rpc("has_shop_permission", {
        p_shop_id: current.data, p_permission: permission,
      });
      return !allowed.error && allowed.data === true ? current.data : null;
    },
  };
}

// Unmounted, trusted server composition only. run must be owner-bound, never a
// raw driver or an arbitrary browser-supplied SQL callback.
export function createNeonShopPermissions(run: OwnerBoundShopQuery): ShopPermissionRepository {
  return {
    async currentAccess(permission) {
      if (typeof permission !== "string" || !permission) return null;
      const rows = await run([{
        text: "select creditbook_neon_private.shop_access($1::text) as result", values: [permission],
      }]);
      if (rows.length !== 1 || rows[0].length !== 1) throw new Error("Invalid shop access result.");
      const id = rows[0][0].result;
      if (id !== null && (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
        throw new Error("Invalid shop access result.");
      }
      return id;
    },
  };
}
