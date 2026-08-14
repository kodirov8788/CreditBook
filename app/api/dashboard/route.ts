import { NextResponse } from "next/server";
import { serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient } from "@/lib/api/auth";

export async function GET() {
  const { supabase, user } = await getAuthenticatedClient();
  if (!supabase || !user) return unauthorized();
  const { data, error } = await supabase.from("customers").select("id, name, phone, debts(principal, due_date, status, payments(amount, paid_at))").order("created_at", { ascending: false });
  if (error) return serverError();

  const customers = data ?? [];
  const summary = customers.map((customer) => {
    const debts = (customer.debts ?? []) as Array<{ principal: number; due_date: string | null; status: string; payments: Array<{ amount: number; paid_at: string }> }>;
    const balance = debts.reduce((sum, debt) => sum + Math.max(Number(debt.principal) - debt.payments.reduce((paid, payment) => paid + Number(payment.amount), 0), 0), 0);
    return { id: customer.id, name: customer.name, phone: customer.phone, balance, due_date: debts.map((debt) => debt.due_date).filter(Boolean).sort()[0] ?? null };
  });
  return NextResponse.json({ summary, totals: { customers: summary.length, active: summary.filter((customer) => customer.balance > 0).length, outstanding: summary.reduce((sum, customer) => sum + customer.balance, 0) } });
}
