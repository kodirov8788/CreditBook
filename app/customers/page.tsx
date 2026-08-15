import Dashboard from "@/components/dashboard";
import { getDashboardData } from "@/lib/dashboard-data";

export default async function CustomersPage() {
  return <Dashboard {...await getDashboardData()} initialView="customers" />;
}
