import { notFound } from "next/navigation";

import { RoleDetailView } from "@/components/protected/roles/role-detail";

// /admin/roles/[id] (SCR-10): role header + permission matrix. `params` is a Promise in Next 16. Ids are
// integers (doc/05 section 1.2): anything else is a plain "not found" without a request.
export default async function RoleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,15}$/.test(id)) notFound();
  return <RoleDetailView id={id} />;
}
