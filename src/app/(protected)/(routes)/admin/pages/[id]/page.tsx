import { notFound } from "next/navigation";

import { PageHost } from "@/components/protected/pages/page-host";

// /admin/pages/[id] (SCR-20): the page. T1.4.7 puts the publishing parts here (PublishBar, History); the editor (sections,
// details, SEO) is T1.4.8 and replaces the body of `PageHost`.
export default async function PagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d{0,17}$/.test(id)) notFound();
  return <PageHost id={Number(id)} />;
}
