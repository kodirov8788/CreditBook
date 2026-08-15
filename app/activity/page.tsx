import Dashboard from "@/components/dashboard";
import { getDashboardData } from "@/lib/dashboard-data";

export default async function ActivityPage() {
  return <Dashboard {...await getDashboardData()} initialView="activity" />;
}
