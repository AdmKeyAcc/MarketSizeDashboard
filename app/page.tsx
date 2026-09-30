import { fetchDashboardData } from "@/lib/fetchDashboardData";
import Dashboard from "@/components/Dashboard";

// Always fetch fresh data on request — this is an internal dashboard, not a
// marketing page, and the data changes whenever someone uploads a file.
export const dynamic = "force-dynamic";

export default async function Page() {
  const initialData = await fetchDashboardData();
  return <Dashboard initialData={initialData} />;
}
