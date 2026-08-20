import { NextResponse } from "next/server";
import { badRequest, serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient, requireShopPermission } from "@/lib/api/auth";

const expenseSelect = "id, category, amount, spent_at, vendor, note, payment_method, voided_at, void_reason, created_at";

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await requireShopPermission(supabase, user, "expense.read");
  if (!access.ok) return access.response;
  const params = new URL(request.url).searchParams;
  let query = supabase.from("expenses").select(expenseSelect).eq("shop_id", access.shopId).order("spent_at", { ascending: false });
  if (params.get("from")) query = query.gte("spent_at", params.get("from")!);
  if (params.get("to")) query = query.lte("spent_at", params.get("to")!);
  const { data, error } = await query;
  if (error) return serverError();
  return NextResponse.json({ expenses: data });
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await requireShopPermission(supabase, user, "expense.create");
  if (!access.ok) return access.response;
  const body = await request.json().catch(() => null) as { category?: string; amount?: number; spentAt?: string; vendor?: string; note?: string; paymentMethod?: string } | null;
  const category = body?.category?.trim();
  const amount = body?.amount ?? 0;
  if (!category || category.length < 2) return badRequest("Xarajat turini kiriting.");
  if (!Number.isFinite(amount) || amount <= 0) return badRequest("Xarajat summasini tekshiring.");
  const spentAt = body?.spentAt || new Date().toISOString().slice(0, 10);
  if (Number.isNaN(new Date(`${spentAt}T00:00:00`).getTime())) return badRequest("Xarajat sanasi noto'g'ri.");
  const paymentMethod = body?.paymentMethod || "cash";
  if (!["cash", "card", "bank", "other"].includes(paymentMethod)) return badRequest("To'lov turi noto'g'ri.");

  const { data, error } = await supabase.from("expenses").insert({ category, amount, spent_at: spentAt, vendor: body?.vendor?.trim() || null, note: body?.note?.trim() || null, payment_method: paymentMethod }).select(expenseSelect).single();
  if (error || !data) return serverError();
  return NextResponse.json({ expense: data }, { status: 201 });
}
