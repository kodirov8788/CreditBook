import Dashboard from "@/components/dashboard";
import { getDashboardData } from "@/lib/dashboard-data";

export default async function RemindersPage() {
  return <Dashboard {...await getDashboardData()} initialView="reminders" />;
}
