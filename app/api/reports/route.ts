import { NextResponse } from "next/server";
import { serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient, requireShopPermission } from "@/lib/api/auth";

function within(value: string | null, from: string | null, to: string | null) {
  const day = value?.slice(0, 10);
  return Boolean(day && (!from || day >= from) && (!to || day <= to));
}

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await requireShopPermission(supabase, user, "report.read");
  if (!access.ok) return access.response;
  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const [{ data: debts, error: debtsError }, { data: payments, error: paymentsError }, { data: expenses, error: expensesError }] = await Promise.all([
    supabase.from("debts").select("id, customer_id, principal, due_date, status, created_at").eq("shop_id", access.shopId),
    supabase.from("payments").select("debt_id, amount, paid_at, voided_at").eq("shop_id", access.shopId),
    supabase.from("expenses").select("id, category, amount, spent_at, vendor, note, payment_method, voided_at, void_reason, created_at").eq("shop_id", access.shopId).order("spent_at", { ascending: false }),
  ]);
  if (debtsError || paymentsError || expensesError) return serverError();

  const activePayments = (payments ?? []).filter((payment) => !payment.voided_at);
  const paidByDebt = new Map<string, number>();
  for (const payment of activePayments) paidByDebt.set(payment.debt_id, (paidByDebt.get(payment.debt_id) ?? 0) + Number(payment.amount));
  const activeDebts = (debts ?? []).filter((debt) => debt.status !== "cancelled");
  const today = new Date().toISOString().slice(0, 10);
  const outstanding = activeDebts.reduce((sum, debt) => sum + Math.max(Number(debt.principal) - (paidByDebt.get(debt.id) ?? 0), 0), 0);
  const overdue = activeDebts.filter((debt) => debt.due_date && debt.due_date < today && (paidByDebt.get(debt.id) ?? 0) < Number(debt.principal));
  const newCredits = activeDebts.filter((debt) => within(debt.created_at, from, to)).reduce((sum, debt) => sum + Number(debt.principal), 0);
  const collected = activePayments.filter((payment) => within(payment.paid_at, from, to)).reduce((sum, payment) => sum + Number(payment.amount), 0);
  const activeExpenses = (expenses ?? []).filter((expense) => !expense.voided_at);
  const filteredExpenses = activeExpenses.filter((expense) => within(expense.spent_at, from, to));
  const expensesTotal = filteredExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
  const activeCustomerIds = new Set(activeDebts.filter((debt) => Math.max(Number(debt.principal) - (paidByDebt.get(debt.id) ?? 0), 0) > 0).map((debt) => debt.customer_id));
  const monthKeys = new Set<string>();
  for (const debt of activeDebts) if (within(debt.created_at, from, to)) monthKeys.add(debt.created_at.slice(0, 7));
  for (const payment of activePayments) if (within(payment.paid_at, from, to)) monthKeys.add(payment.paid_at.slice(0, 7));
  for (const expense of filteredExpenses) monthKeys.add(expense.spent_at.slice(0, 7));
  const monthly = [...monthKeys].sort().map((month) => {
    const credits = activeDebts.filter((debt) => debt.created_at.startsWith(month)).reduce((sum, debt) => sum + Number(debt.principal), 0);
    const monthCollected = activePayments.filter((payment) => payment.paid_at?.startsWith(month)).reduce((sum, payment) => sum + Number(payment.amount), 0);
    const monthExpenses = activeExpenses.filter((expense) => expense.spent_at.startsWith(month)).reduce((sum, expense) => sum + Number(expense.amount), 0);
    return { month, credits, collected: monthCollected, expenses: monthExpenses, netCashflow: monthCollected - monthExpenses };
  });

  return NextResponse.json({ report: { from, to, newCredits, collected, expensesTotal, netCashflow: collected - expensesTotal, outstanding, overdueAmount: overdue.reduce((sum, debt) => sum + Math.max(Number(debt.principal) - (paidByDebt.get(debt.id) ?? 0), 0), 0), overdueCount: overdue.length, activeCustomers: activeCustomerIds.size, monthly, expenses: filteredExpenses } });
}
