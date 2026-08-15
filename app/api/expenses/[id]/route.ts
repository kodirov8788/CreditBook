import { NextResponse } from "next/server";
import { badRequest, serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient, requireShopPermission } from "@/lib/api/auth";

type Context = { params: Promise<{ id: string }> };
const expenseSelect = "id, category, amount, spent_at, vendor, note, payment_method, voided_at, void_reason, created_at";

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const body = await request.json().catch(() => null) as { category?: string; amount?: number; spentAt?: string; vendor?: string; note?: string; paymentMethod?: string; void?: boolean; reason?: string } | null;
  const access = await requireShopPermission(supabase, user, body?.void ? "expense.void" : "expense.update");
  if (!access.ok) return access.response;
  if (body?.void) {
    const { data, error } = await supabase.from("expenses").update({ voided_at: new Date().toISOString(), void_reason: body.reason?.trim() || "Foydalanuvchi tuzatishi" }).eq("id", id).is("voided_at", null).select(expenseSelect).single();
    if (error || !data) return serverError();
    return NextResponse.json({ expense: data });
  }
  const updates: Record<string, string | number | null> = {};
  if (body?.category !== undefined) {
    const category = body.category.trim();
    if (category.length < 2) return badRequest("Xarajat turini kiriting.");
    updates.category = category;
  }
  if (body?.amount !== undefined) {
    if (!Number.isFinite(body.amount) || body.amount <= 0) return badRequest("Xarajat summasini tekshiring.");
    updates.amount = body.amount;
  }
  if (body?.spentAt !== undefined) updates.spent_at = body.spentAt;
  if (body?.vendor !== undefined) updates.vendor = body.vendor?.trim() || null;
  if (body?.note !== undefined) updates.note = body.note?.trim() || null;
  if (body?.paymentMethod !== undefined) updates.payment_method = body.paymentMethod;
  if (!Object.keys(updates).length) return badRequest("O'zgartirish kiriting.");
  const { data, error } = await supabase.from("expenses").update(updates).eq("id", id).is("voided_at", null).select(expenseSelect).single();
  if (error || !data) return serverError();
  return NextResponse.json({ expense: data });
}
