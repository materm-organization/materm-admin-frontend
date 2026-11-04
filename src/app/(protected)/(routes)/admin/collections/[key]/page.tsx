import { notFound } from "next/navigation";

import { EntriesList } from "@/components/protected/collections/entries-list";
import { COLLECTION_KEY_RE } from "@/lib/collections/constants";

// /admin/collections/[key] (SCR-41): the entries of one collection. An entry is created from the list's dialog (there is no `new` route).
export default async function CollectionEntriesPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!COLLECTION_KEY_RE.test(key)) notFound();
  return <EntriesList collectionKey={key} />;
}
