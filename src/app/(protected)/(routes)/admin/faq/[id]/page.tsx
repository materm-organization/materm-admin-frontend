import { notFound } from "next/navigation";

import { FaqHost } from "@/components/protected/faq/faq-host";

// /admin/faq/[id] (SCR-30): the FAQ group editor. A group is created from the dialog of the list (T1.5.6), so there is no `new` route.
export default async function FaqGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d{0,17}$/.test(id)) notFound();
  return <FaqHost id={Number(id)} />;
}
