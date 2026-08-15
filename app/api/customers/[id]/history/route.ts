import { NextResponse } from "next/server";
import { serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient } from "@/lib/api/auth";

type Context = { params: Promise<{ id: string }> };
type HistoryTransaction = { id: string; type: "credit" | "payment"; amount: number; description: string; occurredAt: string; dueDate: string | null; status: string | null; balanceAfter: number };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();

  const [{ data: credits, error: creditError }, { data: payments, error: paymentError }] = await Promise.all([
    supabase.from("debts").select("id, title, principal, due_date, status, created_at").eq("customer_id", id).order("created_at", { ascending: false }),
    supabase.from("payments").select("id, debt_id, amount, paid_at, note, created_at, voided_at, void_reason").eq("customer_id", id).order("paid_at", { ascending: false }),
  ]);
  if (creditError || paymentError) return serverError();

  const chronological: HistoryTransaction[] = [
    ...(credits ?? []).map((credit) => ({ id: credit.id, type: "credit" as const, amount: Number(credit.principal), description: credit.title?.trim() || "Qarz", occurredAt: credit.created_at, dueDate: credit.due_date, status: credit.status, balanceAfter: 0 })),
    ...(payments ?? []).map((payment) => ({ id: payment.id, type: "payment" as const, amount: Number(payment.amount), description: payment.note?.trim() || "To'lov", occurredAt: payment.paid_at ?? payment.created_at, dueDate: null, status: payment.voided_at ? "voided" : null, balanceAfter: 0 })),
  ].filter((transaction) => Number.isFinite(transaction.amount) && transaction.amount > 0).sort((left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime());

  let balance = 0;
  const transactions = chronological.map((transaction) => {
    balance = Math.max(balance + (transaction.type === "credit" ? transaction.amount : -transaction.amount), 0);
    return { ...transaction, balanceAfter: balance };
  }).reverse();

  return NextResponse.json({ credits, payments, transactions });
}
