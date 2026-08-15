import { NextResponse } from "next/server";
import { badRequest, serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient, requireShopPermission } from "@/lib/api/auth";

type Context = { params: Promise<{ id: string; paymentId: string }> };

export async function POST(request: Request, context: Context) {
  const { id, paymentId } = await context.params;
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await requireShopPermission(supabase, user, "payment.void");
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null) as { reason?: string } | null;
  const { data, error } = await supabase.rpc("void_payment_atomic", { p_customer_id: id, p_payment_id: paymentId, p_reason: body?.reason?.trim() || null });
  if (error) {
    if (error.code === "22023" || error.code === "P0002") return badRequest(error.message);
    return serverError();
  }
  return NextResponse.json({ payment: data });
}
