import Dashboard from "@/components/dashboard";
import { createClient } from "@/lib/supabase/server";
import type { DashboardCustomer, DashboardStats } from "@/lib/types";
import { redirect } from "next/navigation";

const emptyStats: DashboardStats = { totalOutstanding: 0, collectedThisMonth: 0, overdueAmount: 0, activeCustomers: 0 };

export default async function Home() {
  const supabase = await createClient();
  if (!supabase) {
    return <Dashboard initialCustomers={[]} initialStats={emptyStats} userEmail={null} liveMode={false} initialError="Supabase ulanishi sozlanmagan." />;
  }

  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) redirect("/login");

  const { data, error } = await supabase
    .from("customers")
    .select("id, name, phone, debts(id, principal, due_date, status, payments(amount, paid_at))")
    .order("created_at", { ascending: false });

  if (error) {
    return <Dashboard initialCustomers={[]} initialStats={emptyStats} userEmail={userData.user.email ?? null} liveMode initialError="Ma'lumotlar olinmadi. Supabase jadval va RLS sozlamalarini tekshiring." />;
  }

  const customers: DashboardCustomer[] = (data ?? []).map((customer) => {
    const debts = (customer.debts ?? []) as Array<{
      principal: number;
      due_date: string | null;
      status: string;
      payments: Array<{ amount: number; paid_at: string }>;
    }>;
    const balance = debts.reduce((sum, debt) => {
      const paid = debt.payments.reduce((paymentSum, payment) => paymentSum + Number(payment.amount), 0);
      return sum + Math.max(Number(debt.principal) - paid, 0);
    }, 0);
    const dueDate = debts.map((debt) => debt.due_date).filter(Boolean).sort()[0] ?? null;
    const lastPayment = debts.flatMap((debt) => debt.payments.map((payment) => payment.paid_at)).sort().at(-1) ?? null;
    const status = balance === 0 ? "paid" : dueDate && new Date(dueDate) < new Date() ? "overdue" : "on-track";
    return { id: customer.id, name: customer.name, phone: customer.phone ?? "Telefon yo'q", balance, dueDate, status, lastPayment };
  });
  const stats: DashboardStats = {
    totalOutstanding: customers.reduce((sum, customer) => sum + customer.balance, 0),
    collectedThisMonth: 0,
    overdueAmount: customers.filter((customer) => customer.status === "overdue").reduce((sum, customer) => sum + customer.balance, 0),
    activeCustomers: customers.filter((customer) => customer.balance > 0).length,
  };

  return <Dashboard initialCustomers={customers} initialStats={stats} userEmail={userData.user.email ?? null} liveMode initialError="" />;
}
