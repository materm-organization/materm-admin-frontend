import { notFound } from "next/navigation";

import { UserDetailView } from "@/components/protected/users/user-detail";

// /admin/users/[id] (SCR-08): user detail. `params` is a Promise in Next 16. Ids are integers (doc/05 section 1.2).
export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,15}$/.test(id)) notFound();
  return <UserDetailView id={id} />;
}
