import { NextResponse } from "next/server";
import { badRequest, serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient } from "@/lib/api/auth";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const { data, error } = await supabase.from("payments").select("id, debt_id, amount, paid_at, note, created_at, voided_at, void_reason").eq("customer_id", id).order("paid_at", { ascending: false });
  if (error) return serverError();
  return NextResponse.json({ payments: data });
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const body = await request.json().catch(() => null) as { amount?: number; note?: string } | null;
  const amount = body?.amount ?? 0;
  if (!Number.isFinite(amount) || amount <= 0) return badRequest("To'lov summasini kiriting.");

  const { data, error } = await supabase.rpc("record_payment_atomic", {
    p_customer_id: id,
    p_amount: amount,
    p_note: body?.note?.trim() || null,
  });

  if (error) {
    if (error.code === "22023") return badRequest(error.message);
    return serverError();
  }

  return NextResponse.json(data, { status: 201 });
}
