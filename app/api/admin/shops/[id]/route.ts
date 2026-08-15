import { NextResponse } from "next/server";
import { getPlatformAdmin } from "@/lib/admin";
import { forbidden, serverError, unauthorized } from "@/lib/api/response";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const admin = await getPlatformAdmin();
  if (!admin) return unauthorized();
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { status?: string } | null;
  if (body?.status !== "active" && body?.status !== "suspended") return NextResponse.json({ error: "Shop holati noto‘g‘ri." }, { status: 400 });
  const { data, error } = await admin.client.from("shops").update({ status: body.status }).eq("id", id).select("id, status").single();
  if (error || !data) return error?.code === "PGRST116" ? forbidden() : serverError();
  return NextResponse.json({ shop: data });
}
