import Dashboard from "@/components/dashboard";
import { createClient } from "@/lib/supabase/server";
import type { DashboardCustomer, DashboardStats } from "@/lib/types";

const demoCustomers: DashboardCustomer[] = [
  { id: "demo-1", name: "Dilshod Karimov", phone: "+998 90 123 45 67", balance: 1250000, dueDate: "2026-08-18", status: "due-soon", lastPayment: "2026-08-02" },
  { id: "demo-2", name: "Malika Tursunova", phone: "+998 91 555 28 10", balance: 780000, dueDate: "2026-08-12", status: "overdue", lastPayment: "2026-07-30" },
  { id: "demo-3", name: "Jasur Abduqodirov", phone: "+998 93 204 11 09", balance: 450000, dueDate: "2026-08-27", status: "on-track", lastPayment: "2026-08-05" },
  { id: "demo-4", name: "Nodira Rasulova", phone: "+998 99 761 32 18", balance: 210000, dueDate: "2026-09-02", status: "on-track", lastPayment: "2026-08-08" },
];

const demoStats: DashboardStats = {
  totalOutstanding: 2690000,
  collectedThisMonth: 1840000,
  overdueAmount: 780000,
  activeCustomers: 24,
};

export default async function Home() {
  const supabase = await createClient();
  let customers = demoCustomers;
  let stats = demoStats;
  let email: string | null = null;
  let liveMode = false;

  if (supabase) {
    const { data: userData } = await supabase.auth.getUser();
    email = userData.user?.email ?? null;

    if (userData.user) {
      const { data } = await supabase
        .from("customers")
        .select("id, name, phone, debts(id, principal, due_date, status, payments(amount, paid_at))")
        .order("created_at", { ascending: false });

      if (data) {
        liveMode = true;
        customers = data.map((customer) => {
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
          return { id: customer.id, name: customer.name, phone: customer.phone ?? "No phone added", balance, dueDate, status, lastPayment };
        });
        stats = { ...demoStats, activeCustomers: customers.filter((customer) => customer.balance > 0).length, totalOutstanding: customers.reduce((sum, customer) => sum + customer.balance, 0), overdueAmount: customers.filter((customer) => customer.status === "overdue").reduce((sum, customer) => sum + customer.balance, 0) };
      }
    }
  }

  return <Dashboard initialCustomers={customers} initialStats={stats} userEmail={email} liveMode={liveMode} />;
}
