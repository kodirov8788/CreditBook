import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";
import { createSupabaseDataClient, type DataClient } from "@/lib/data/client";
import { forbidden, unauthorized } from "@/lib/api/response";

export async function getAuthenticatedClient(request?: Request) {
  const authClient = await createClient(request);
  if (!authClient) return { supabase: null, user: null };

  const authorization = request?.headers.get("authorization");
  const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const { data: { user }, error } = bearerToken
    ? await authClient.auth.getUser(bearerToken)
    : await authClient.auth.getUser();
  if (error || !user) return { supabase: null, user: null };

  // Retain the legacy field name while separating identity from data access.
  return { supabase: createSupabaseDataClient(authClient), user };
}

export async function requireShopPermission(
  supabase: DataClient | null,
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
