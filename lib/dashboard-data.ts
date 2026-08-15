import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCustomerStatus } from "@/lib/customer-status";
import type { DashboardCustomer, DashboardStats } from "@/lib/types";

const emptyStats: DashboardStats = { totalOutstanding: 0, collectedThisMonth: 0, overdueAmount: 0, activeCustomers: 0 };

export async function getDashboardData() {
  const supabase = await createClient();
  if (!supabase) return { initialCustomers: [], initialStats: emptyStats, initialActivities: [], userEmail: null, shopName: "Mahalla do'koni", liveMode: false, canManageMembers: false, initialError: "Supabase ulanishi sozlanmagan." };

  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) redirect("/login");
  const [{ data: profile }, { data, error }, { data: activityData }, { data: shopId, error: shopError }] = await Promise.all([
    supabase.from("profiles").select("shop_name").eq("id", userData.user.id).maybeSingle(),
    supabase.from("customers").select("id, name, phone, debts(id, principal, due_date, status, payments(amount, paid_at, voided_at))").order("created_at", { ascending: false }),
    supabase.from("activity_logs").select("id, customer_id, event_type, description, created_at").order("created_at", { ascending: false }).limit(10),
    supabase.rpc("get_current_shop_id"),
  ]);
  const { data: shop } = shopId ? await supabase.from("shops").select("name").eq("id", shopId).maybeSingle() : { data: null };
  const { data: canManageMembers, error: permissionError } = shopId ? await supabase.rpc("has_shop_permission", { p_shop_id: shopId, p_permission: "member.manage" }) : { data: false, error: null };
  const hasMemberManagement = !shopError && !permissionError && Boolean(canManageMembers);
  const shopName = shop?.name?.trim() || profile?.shop_name?.trim() || "Mahalla do'koni";
  if (error) return { initialCustomers: [], initialStats: emptyStats, initialActivities: [], userEmail: userData.user.email ?? null, shopName, liveMode: true, canManageMembers: hasMemberManagement, initialError: "Ma'lumotlar olinmadi. Supabase jadval va RLS sozlamalarini tekshiring." };
  const customers: DashboardCustomer[] = (data ?? []).map((customer) => {
    const debts = (customer.debts ?? []) as Array<{ principal: number; due_date: string | null; status: string; payments: Array<{ amount: number; paid_at: string; voided_at: string | null }> }>;
    const activeDebts = debts.filter((debt) => debt.status !== "cancelled");
    const balance = activeDebts.reduce((sum, debt) => sum + Math.max(Number(debt.principal) - debt.payments.filter((payment) => !payment.voided_at).reduce((paid, payment) => paid + Number(payment.amount), 0), 0), 0);
    const dueDate = activeDebts.map((debt) => debt.due_date).filter(Boolean).sort()[0] ?? null;
    const lastPayment = activeDebts.flatMap((debt) => debt.payments.filter((payment) => !payment.voided_at).map((payment) => payment.paid_at)).sort().at(-1) ?? null;
    return { id: customer.id, name: customer.name, phone: customer.phone ?? "Telefon yo'q", balance, dueDate, status: getCustomerStatus(balance, dueDate), lastPayment };
  });
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const collectedThisMonth = (data ?? []).reduce((sum, customer) => {
    const debts = (customer.debts ?? []) as Array<{ status: string; payments: Array<{ amount: number; paid_at: string | null; voided_at: string | null }> }>;
    return sum + debts.filter((debt) => debt.status !== "cancelled").flatMap((debt) => debt.payments).filter((payment) => !payment.voided_at && payment.paid_at?.slice(0, 7) === monthPrefix).reduce((paid, payment) => paid + Number(payment.amount), 0);
  }, 0);
  const initialStats: DashboardStats = { totalOutstanding: customers.reduce((sum, customer) => sum + customer.balance, 0), collectedThisMonth, overdueAmount: customers.filter((customer) => customer.status === "overdue").reduce((sum, customer) => sum + customer.balance, 0), activeCustomers: customers.filter((customer) => customer.balance > 0).length };
  return { initialCustomers: customers, initialStats, initialActivities: (activityData ?? []) as Array<{ id: string; customer_id: string | null; event_type: string; description: string; created_at: string }>, userEmail: userData.user.email ?? null, shopName, liveMode: true, canManageMembers: hasMemberManagement, initialError: "" };
}
