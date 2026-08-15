import { NextResponse } from "next/server";
import { forbidden, serverError, unauthorized } from "@/lib/api/response";
import { getPlatformAdmin } from "@/lib/admin";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const admin = await getPlatformAdmin();
  if (!admin) return unauthorized();
  const { id } = await context.params;
  if (id === admin.user.id) return forbidden();
  const body = await request.json().catch(() => null) as { status?: string; role?: string; shopId?: string } | null;
  if (body?.role && body.shopId) {
    if (!["shop_owner", "manager", "cashier", "accountant", "viewer"].includes(body.role)) return NextResponse.json({ error: "Rol noto‘g‘ri." }, { status: 400 });
    const { data: current } = await admin.client.from("shop_members").select("role").eq("shop_id", body.shopId).eq("user_id", id).maybeSingle();
    if (!current) return NextResponse.json({ error: "Membership topilmadi." }, { status: 404 });
    if (current.role === "shop_owner" && body.role !== "shop_owner") {
      const { count } = await admin.client.from("shop_members").select("id", { count: "exact", head: true }).eq("shop_id", body.shopId).eq("role", "shop_owner").eq("status", "active");
      if ((count ?? 0) <= 1) return NextResponse.json({ error: "Oxirgi shop owner rolini pasaytirib bo‘lmaydi." }, { status: 400 });
    }
    const { data, error } = await admin.client.from("shop_members").update({ role: body.role }).eq("shop_id", body.shopId).eq("user_id", id).select("id, role").single();
    if (error || !data) return serverError();
    return NextResponse.json({ membership: data });
  }
  if (body?.status !== "active" && body?.status !== "suspended") return NextResponse.json({ error: "Account holati noto‘g‘ri." }, { status: 400 });
  const { data, error } = await admin.client.auth.admin.updateUserById(id, { ban_duration: body.status === "suspended" ? "876000h" : "none" });
  if (error || !data.user) return serverError();
  return NextResponse.json({ user: { id: data.user.id, bannedUntil: data.user.banned_until ?? null } });
}
