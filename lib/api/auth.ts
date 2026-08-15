import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { forbidden, unauthorized } from "@/lib/api/response";

export async function getAuthenticatedClient(request?: Request) {
  const supabase = await createClient(request);
  if (!supabase) return { supabase: null, user: null };

  const authorization = request?.headers.get("authorization");
  const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const { data: { user } } = bearerToken
    ? await supabase.auth.getUser(bearerToken)
    : await supabase.auth.getUser();
  return { supabase, user };
}

export async function requireShopPermission(
  supabase: SupabaseClient | null,
  user: User | null,
  permission: string,
) {
  if (!supabase || !user) return { ok: false as const, response: unauthorized() };

  const { data: shopId, error: shopError } = await supabase.rpc("get_current_shop_id");
  if (shopError || !shopId) return { ok: false as const, response: forbidden() };

  const { data: allowed, error: permissionError } = await supabase.rpc("has_shop_permission", {
    p_shop_id: shopId,
    p_permission: permission,
  });
  if (permissionError || !allowed) return { ok: false as const, response: forbidden() };

  return { ok: true as const, shopId: shopId as string };
}
