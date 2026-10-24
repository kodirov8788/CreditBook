import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCustomerStatus } from "@/lib/customer-status";
import type { DashboardCustomer, DashboardStats } from "@/lib/types";
import { readShopDashboard } from "@/lib/shop-read-model";

const emptyStats: DashboardStats = { totalOutstanding: 0, collectedThisMonth: 0, overdueAmount: 0, activeCustomers: 0 };

export async function getDashboardData({ personalFallback = false } = {}) {
  const supabase = await createClient();
  if (!supabase) return { initialCustomers: [], initialStats: emptyStats, initialActivities: [], userEmail: null, shopName: "Mahalla do'koni", liveMode: false, canManageMembers: false, initialError: "Supabase ulanishi sozlanmagan." };

  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) redirect("/login");
  const { data: shopId, error: shopError } = await supabase.rpc("get_current_shop_id");
  if (!shopError && !shopId && personalFallback) redirect("/personal");
  if (shopError || !shopId) {
    return { initialCustomers: [], initialStats: emptyStats, initialActivities: [], userEmail: userData.user.email ?? null, shopName: "Mahalla do'koni", liveMode: true, canManageMembers: false, initialError: "Faol do'kon topilmadi. Qayta kirib ko'ring." };
  }
  const [
    { data: profile },
    projection,
    { data: activityData },
    { data: shop },
    { data: canManageMembers, error: permissionError }
  ] = await Promise.all([
    supabase.from("profiles").select("shop_name").eq("id", userData.user.id).maybeSingle(),
    readShopDashboard(supabase, shopId).catch(() => null),
    supabase.from("activity_logs").select("id, customer_id, event_type, description, created_at").eq("shop_id", shopId).order("created_at", { ascending: false }).limit(10),
    supabase.from("shops").select("name").eq("id", shopId).maybeSingle(),
    supabase.rpc("has_shop_permission", { p_shop_id: shopId, p_permission: "member.manage" }),
  ]);
  const hasMemberManagement = !permissionError && Boolean(canManageMembers);
  const shopName = shop?.name?.trim() || profile?.shop_name?.trim() || "Mahalla do'koni";
  if (!projection) return { initialCustomers: [], initialStats: emptyStats, initialActivities: [], userEmail: userData.user.email ?? null, shopName, liveMode: true, canManageMembers: hasMemberManagement, initialError: "Ma'lumotlar to'liq olinmadi. Qayta yangilang." };
  const customers: DashboardCustomer[] = projection.summary.map((customer) => {
    const {balance, due_date: dueDate, last_payment: lastPayment} = customer;
    return { id: customer.id, name: customer.name, phone: customer.phone ?? "Telefon yo'q", balance, dueDate, status: getCustomerStatus(balance, dueDate), lastPayment };
  });
  const initialStats: DashboardStats = { totalOutstanding: projection.totals.outstanding, collectedThisMonth: projection.totals.collectedThisMonth, overdueAmount: projection.totals.overdue, activeCustomers: projection.totals.active };
  return { initialCustomers: customers, initialStats, initialActivities: (activityData ?? []) as Array<{ id: string; customer_id: string | null; event_type: string; description: string; created_at: string }>, userEmail: userData.user.email ?? null, shopName, liveMode: true, canManageMembers: hasMemberManagement, initialError: "" };
}
