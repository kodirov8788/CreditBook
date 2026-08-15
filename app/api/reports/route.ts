import { NextResponse } from "next/server";
import { serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient } from "@/lib/api/auth";

function within(value: string | null, from: string | null, to: string | null) {
  const day = value?.slice(0, 10);
  return Boolean(day && (!from || day >= from) && (!to || day <= to));
}

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const [{ data: debts, error: debtsError }, { data: payments, error: paymentsError }] = await Promise.all([
    supabase.from("debts").select("id, customer_id, principal, due_date, status, created_at"),
    supabase.from("payments").select("debt_id, amount, paid_at, voided_at"),
  ]);
  if (debtsError || paymentsError) return serverError();

  const activePayments = (payments ?? []).filter((payment) => !payment.voided_at);
  const paidByDebt = new Map<string, number>();
  for (const payment of activePayments) paidByDebt.set(payment.debt_id, (paidByDebt.get(payment.debt_id) ?? 0) + Number(payment.amount));
  const activeDebts = (debts ?? []).filter((debt) => debt.status !== "cancelled");
  const today = new Date().toISOString().slice(0, 10);
  const outstanding = activeDebts.reduce((sum, debt) => sum + Math.max(Number(debt.principal) - (paidByDebt.get(debt.id) ?? 0), 0), 0);
  const overdue = activeDebts.filter((debt) => debt.due_date && debt.due_date < today && (paidByDebt.get(debt.id) ?? 0) < Number(debt.principal));
  const newCredits = activeDebts.filter((debt) => within(debt.created_at, from, to)).reduce((sum, debt) => sum + Number(debt.principal), 0);
  const collected = activePayments.filter((payment) => within(payment.paid_at, from, to)).reduce((sum, payment) => sum + Number(payment.amount), 0);
  const activeCustomerIds = new Set(activeDebts.filter((debt) => Math.max(Number(debt.principal) - (paidByDebt.get(debt.id) ?? 0), 0) > 0).map((debt) => debt.customer_id));

  return NextResponse.json({ report: { from, to, newCredits, collected, outstanding, overdueAmount: overdue.reduce((sum, debt) => sum + Math.max(Number(debt.principal) - (paidByDebt.get(debt.id) ?? 0), 0), 0), overdueCount: overdue.length, activeCustomers: activeCustomerIds.size } });
}
