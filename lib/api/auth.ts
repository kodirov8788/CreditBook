import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";
import { createSupabaseDataClient, type DataClient } from "@/lib/data/client";
import { forbidden, unauthorized } from "@/lib/api/response";
import { createSupabaseShopPermissions } from "@/lib/data/shop-permissions";

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

  try {
    const shopId = await createSupabaseShopPermissions(supabase).currentAccess(permission);
    return shopId ? { ok: true as const, shopId } : { ok: false as const, response: forbidden() };
  } catch { return { ok: false as const, response: forbidden() }; }
}
