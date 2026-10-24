import Dashboard from "@/components/dashboard";
import { getDashboardData } from "@/lib/dashboard-data";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  if (process.env.CREDITBOOK_NEON_ENABLED === "1") redirect("/personal");
  return <Dashboard {...await getDashboardData({ personalFallback: true })} initialView="dashboard" />;
}
