import Dashboard from "@/components/dashboard";
import { getDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ExpensesPage() {
  return <Dashboard {...await getDashboardData()} initialView="reports" />;
}
