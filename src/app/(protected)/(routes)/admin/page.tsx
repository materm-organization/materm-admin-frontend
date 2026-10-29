import { DashboardView } from "@/components/protected/dashboard/dashboard-view";

// /admin (SCR-05): the dashboard. Open to every signed-in person; the cards come from `GET /dashboard/summary`, which leaves out what the
// person may not see.
export default function AdminDashboardPage() {
  return <DashboardView />;
}
