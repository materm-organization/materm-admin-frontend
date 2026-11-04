// The publish engine and the revisions tab address an entity by ONE id. A collection entry lives at `/collections/{key}/entries/{id}`, so
// its id for those shared pieces is the composite `"<key>:<id>"` (a collection key never contains `:`; `lib/publishable-resources.ts` and
// `lib/revision-resources.ts` split it again). Everything else uses the key and the numeric id separately.
export const entryRef = (collectionKey: string, id: number | string) => `${collectionKey}:${id}`;

export function splitEntryRef(ref: number | string): { key: string; id: string } {
  const text = String(ref);
  const at = text.lastIndexOf(":");
  if (at < 1) throw new Error(`Not a collection entry reference: ${text}`);
  return { key: text.slice(0, at), id: text.slice(at + 1) };
}
