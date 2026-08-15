import Dashboard from "@/components/dashboard";
import { getDashboardData } from "@/lib/dashboard-data";

export default async function DashboardPage() {
  return <Dashboard {...await getDashboardData()} initialView="dashboard" />;
}
