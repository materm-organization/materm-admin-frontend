import { notFound } from "next/navigation";

import { FormHost } from "@/components/protected/forms/form-host";

// /admin/forms/[id] (SCR-31): the form editor. `/admin/forms/submissions` is a static segment next to this one and wins over it.
export default async function FormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d{0,17}$/.test(id)) notFound();
  return <FormHost id={Number(id)} />;
}
