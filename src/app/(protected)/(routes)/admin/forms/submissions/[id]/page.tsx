import { notFound } from "next/navigation";

import { SubmissionDetailView } from "@/components/protected/submissions/submission-detail";

// /admin/forms/submissions/[id]?created_at=... (SCR-32): one message. `created_at` is the partition hint the list puts in the link.
export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d{0,17}$/.test(id)) notFound();
  return <SubmissionDetailView id={Number(id)} />;
}
