import { notFound } from "next/navigation";

import { EntryHost } from "@/components/protected/collections/entry-host";
import { COLLECTION_KEY_RE } from "@/lib/collections/constants";

// /admin/collections/[key]/[id] (SCR-41): the entry editor.
export default async function CollectionEntryPage({ params }: { params: Promise<{ key: string; id: string }> }) {
  const { key, id } = await params;
  if (!COLLECTION_KEY_RE.test(key) || !/^[1-9]\d{0,17}$/.test(id)) notFound();
  return <EntryHost collectionKey={key} id={Number(id)} />;
}
