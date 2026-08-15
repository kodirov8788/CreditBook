import Dashboard from "@/components/dashboard";
import { getDashboardData } from "@/lib/dashboard-data";

export default async function ReportsPage() {
  return <Dashboard {...await getDashboardData()} initialView="reports" />;
}
