import Dashboard from "@/components/dashboard";
import { getDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CustomerDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Dashboard {...await getDashboardData()} initialView="customers" initialCustomerId={id} />;
}
