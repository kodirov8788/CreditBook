import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/admin";

export type TeamMember = {
  id: string;
  user_id: string;
  role: string;
  status: string;
  created_at: string;
  user: { id: string; email: string | null; fullName: string | null } | null;
};

export async function requireTeamManager() {
  const authClient = await createClient();
  if (!authClient) redirect("/dashboard");
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) redirect("/login");
  const { data: shopId, error: shopError } = await authClient.rpc("get_current_shop_id");
  const { data: allowed, error: permissionError } = shopId ? await authClient.rpc("has_shop_permission", { p_shop_id: shopId, p_permission: "member.manage" }) : { data: false, error: null };
  const { data: canEditShopName, error: shopUpdatePermissionError } = shopId ? await authClient.rpc("has_shop_permission", { p_shop_id: shopId, p_permission: "shop.update" }) : { data: false, error: null };
  if (shopError || permissionError || !shopId || !allowed) redirect("/dashboard");
  const service = createServiceClient();
  if (!service) redirect("/dashboard");
  const [{ data: shop }, { data: members }] = await Promise.all([
    service.from("shops").select("name").eq("id", shopId).single(),
    service.from("shop_members").select("id, user_id, role, status, created_at").eq("shop_id", shopId).order("created_at", { ascending: true }),
  ]);
  const enriched: TeamMember[] = await Promise.all((members ?? []).map(async (member) => {
    const authUser = (await service.auth.admin.getUserById(member.user_id)).data.user;
    return {
      ...member,
      user: authUser ? { id: authUser.id, email: authUser.email ?? null, fullName: authUser.user_metadata?.full_name ?? null } : null,
    };
  }));
  return { userId: user.id, shopName: shop?.name ?? "Do‘kon", members: enriched, canEditShopName: !shopUpdatePermissionError && Boolean(canEditShopName) };
}
