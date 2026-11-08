import { notFound } from "next/navigation";

import { SharedSectionHost } from "@/components/protected/sections/shared-section-host";

// /admin/sections/[id] (SCR-22): the editor of one shared section. The id is the numeric id; anything else (or more than 15 digits, past what a Number holds exactly) is a 404.
export default async function SharedSectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d{0,14}$/.test(id)) notFound();
  return <SharedSectionHost id={Number(id)} />;
}
