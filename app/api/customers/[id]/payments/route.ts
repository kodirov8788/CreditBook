import { NextResponse } from "next/server";
import { badRequest, serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient } from "@/lib/api/auth";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const { data, error } = await supabase.from("payments").select("id, debt_id, amount, paid_at, note, created_at").eq("customer_id", id).order("paid_at", { ascending: false });
  if (error) return serverError();
  return NextResponse.json({ payments: data });
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const body = await request.json().catch(() => null) as { amount?: number; note?: string } | null;
  if (!body?.amount || body.amount <= 0) return badRequest("To'lov summasini kiriting.");

  const { data: debts, error: debtError } = await supabase.from("debts").select("id, principal, payments(amount)").eq("customer_id", id).eq("status", "open").order("created_at", { ascending: true });
  if (debtError) return serverError();

  let left = body.amount;
  const payments: Array<{ debt_id: string; amount: number }> = [];
  for (const debt of (debts ?? []) as Array<{ id: string; principal: number; payments: Array<{ amount: number }> }>) {
    if (left <= 0) break;
    const paid = debt.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const open = Math.max(Number(debt.principal) - paid, 0);
    const amount = Math.min(left, open);
    if (amount > 0) { payments.push({ debt_id: debt.id, amount }); left -= amount; }
  }
  if (left > 0 || payments.length === 0) return badRequest("To'lov qoldiqdan oshmasin.");

  for (const payment of payments) {
    const { error } = await supabase.from("payments").insert({ customer_id: id, debt_id: payment.debt_id, amount: payment.amount, note: body.note?.trim() || null });
    if (error) return serverError();
    const debt = (debts ?? []).find((item) => item.id === payment.debt_id) as { principal: number; payments: Array<{ amount: number }> } | undefined;
    const oldPaid = debt?.payments.reduce((sum, item) => sum + Number(item.amount), 0) ?? 0;
    if (debt && oldPaid + payment.amount >= Number(debt.principal)) await supabase.from("debts").update({ status: "paid" }).eq("id", payment.debt_id);
  }

  return NextResponse.json({ paid: body.amount, payments }, { status: 201 });
}
