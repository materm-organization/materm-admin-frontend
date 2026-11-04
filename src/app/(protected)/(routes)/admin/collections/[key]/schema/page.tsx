import { notFound } from "next/navigation";

import { DefinitionHost } from "@/components/protected/collections/definition-host";
import { COLLECTION_KEY_RE } from "@/lib/collections/constants";

// /admin/collections/[key]/schema (SCR-40): the definition and its field builder. `schema` is a fixed segment, so it never clashes with an entry id.
export default async function CollectionSchemaPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!COLLECTION_KEY_RE.test(key)) notFound();
  return <DefinitionHost collectionKey={key} />;
}
