import { NextResponse } from "next/server";
import { badRequest, forbidden, serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient, requireShopPermission } from "@/lib/api/auth";
import { createServiceClient } from "@/lib/admin";
import { TEAM_ROLES } from "@/lib/team-roles";
import { recordAudit } from "@/lib/audit";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await requireShopPermission(supabase, user, "member.manage");
  if (!access.ok) return access.response;
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { role?: string; status?: string } | null;
  if (body?.role && !TEAM_ROLES.includes(body.role as (typeof TEAM_ROLES)[number])) return badRequest("Rol noto‘g‘ri.");
  if (body?.status && !["active", "suspended"].includes(body.status)) return badRequest("A’zo holati noto‘g‘ri.");
  const service = createServiceClient();
  if (!service) return serverError();
  const { data: current } = await service.from("shop_members").select("id, user_id, role, status").eq("id", id).eq("shop_id", access.shopId).maybeSingle();
  if (!current) return NextResponse.json({ error: "A’zo topilmadi." }, { status: 404 });
  if (current.user_id === user.id && (body?.status === "suspended" || body?.role && body.role !== "shop_owner")) return forbidden();
  if (current.role === "shop_owner" && ((body?.role && body.role !== "shop_owner") || body?.status === "suspended")) {
    const { count } = await service.from("shop_members").select("id", { count: "exact", head: true }).eq("shop_id", access.shopId).eq("role", "shop_owner").eq("status", "active");
    if ((count ?? 0) <= 1) return badRequest("Oxirgi shop owner’ni o‘zgartirib bo‘lmaydi.");
  }
  const updates = { ...(body?.role ? { role: body.role } : {}), ...(body?.status ? { status: body.status } : {}) };
  if (!Object.keys(updates).length) return badRequest("O‘zgarish kiriting.");
  const { data, error } = await service.from("shop_members").update(updates).eq("id", id).eq("shop_id", access.shopId).select("id, role, status").single();
  if (error || !data) return serverError();
  await recordAudit(service, { actorUserId: user.id, shopId: access.shopId, entityType: "membership", entityId: id, action: "membership.updated", metadata: { userId: current.user_id, before: { role: current.role, status: current.status }, after: updates } });
  return NextResponse.json({ member: data });
}
