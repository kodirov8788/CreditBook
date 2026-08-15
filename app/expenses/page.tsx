import Dashboard from "@/components/dashboard";
import { getDashboardData } from "@/lib/dashboard-data";

export default async function ExpensesPage() {
  return <Dashboard {...await getDashboardData()} initialView="reports" />;
}
