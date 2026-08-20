import { NextResponse } from "next/server";
import { badRequest, serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient, requireShopPermission } from "@/lib/api/auth";
import { createServiceClient } from "@/lib/admin";
import { TEAM_ROLES } from "@/lib/team-roles";
import { recordAudit } from "@/lib/audit";
import { getTrustedInviteOrigin } from "@/lib/app-url";

const inviteRoles = TEAM_ROLES.filter((role) => role !== "shop_owner");

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await requireShopPermission(supabase, user, "member.read");
  if (!access.ok) return access.response;
  const service = createServiceClient();
  if (!service) return serverError();
  const { data: members, error } = await service.from("shop_members").select("id, user_id, role, status, created_at").eq("shop_id", access.shopId).order("created_at", { ascending: true });
  if (error) return serverError();
  const result = await Promise.all((members ?? []).map(async (member) => {
    const user = (await service.auth.admin.getUserById(member.user_id)).data.user;
    return {
      ...member,
      user: user ? { id: user.id, email: user.email ?? null, fullName: user.user_metadata?.full_name ?? null } : null,
    };
  }));
  return NextResponse.json({ members: result });
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await requireShopPermission(supabase, user, "member.manage");
  if (!access.ok) return access.response;
  const body = await request.json().catch(() => null) as { email?: string; role?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  const role = body?.role || "cashier";
  if (!email || !email.includes("@")) return badRequest("Email manzilini kiriting.");
  if (!inviteRoles.includes(role as (typeof inviteRoles)[number])) return badRequest("Taklif roli noto‘g‘ri.");
  const service = createServiceClient();
  if (!service) return serverError();
  const origin = getTrustedInviteOrigin(request);
  if (!origin) return serverError();
  const redirectTo = new URL("/auth/callback", origin);
  redirectTo.searchParams.set("next", "/team");
  redirectTo.searchParams.set("shop_id", access.shopId);
  const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, { redirectTo: redirectTo.toString() });
  if (inviteError || !invited.user) return NextResponse.json({ error: inviteError?.message || "Taklif yuborilmadi." }, { status: 400 });
  const { data: member, error } = await service.from("shop_members").insert({ shop_id: access.shopId, user_id: invited.user.id, role, status: "invited", invited_by: user.id }).select("id, user_id, role, status").single();
  if (error || !member) {
    if (error?.code === "23505") return NextResponse.json({ error: "Bu email uchun shop a’zoligi allaqachon bor." }, { status: 409 });
    return serverError();
  }
  await recordAudit(service, { actorUserId: user.id, shopId: access.shopId, entityType: "membership", entityId: member.id, action: "membership.invited", metadata: { userId: invited.user.id, role } });
  return NextResponse.json({ member: { ...member, user: { id: invited.user.id, email, fullName: null } } }, { status: 201 });
}
