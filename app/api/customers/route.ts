import { NextResponse } from "next/server";
import { badRequest, serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient, requireShopPermission } from "@/lib/api/auth";

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await requireShopPermission(supabase, user, "customer.read");
  if (!access.ok) return access.response;

  const { data, error } = await supabase
    .from("customers")
    .select("id, name, phone, address, notes, created_at, updated_at, debts(id, title, principal, due_date, status, created_at, payments(id, amount, paid_at, note, voided_at, void_reason))")
    .eq("shop_id", access.shopId)
    .order("created_at", { ascending: false });

  if (error) return serverError();
  return NextResponse.json({ customers: data });
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await requireShopPermission(supabase, user, "customer.create");
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null) as { name?: string; phone?: string; address?: string; notes?: string; amount?: number; dueDate?: string } | null;
  const name = body?.name?.trim();
  if (!name || name.length < 2) return badRequest("Mijoz ismini kiriting.");
  const amount = body?.amount ?? 0;
  if (!Number.isFinite(amount) || amount < 0) return badRequest("Qarz summasini tekshiring.");

  const { data, error } = await supabase.rpc("create_customer_with_opening_debt", {
    p_name: name,
    p_phone: body?.phone?.trim() || null,
    p_address: body?.address?.trim() || null,
    p_notes: body?.notes?.trim() || null,
    p_amount: amount,
    p_due_date: body?.dueDate || null,
  });
  const customer = Array.isArray(data) ? data[0] : data;

  if (error || !customer) return serverError();

  return NextResponse.json({ customer }, { status: 201 });
}
