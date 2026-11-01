import { etagOfRow } from "@/services/media.api";
import type { MediaAsset, MediaBulkItem, MediaBulkResult, MediaBulkSkipped } from "@/types/media";

// The backend takes at most 100 items per bulk request (422 `/items` `limit_exceeded`).
export const MEDIA_BULK_MAX = 100;

// The per-row ETag comes from the loaded list (its own `etag`, else `"<updated_at>"` in UTC).
export function toBulkItems(rows: Pick<MediaAsset, "id" | "updated_at">[]): MediaBulkItem[] {
  return rows.map((row) => ({ id: row.id, etag: etagOfRow(row as MediaAsset) }));
}

// Runs the call on chunks of <= 100 items one after the other and merges the answers. A request-level failure (403 / 422 /
// network) stops the run: the items of that chunk and of the chunks not sent yet come back as skipped `request_failed`
// and the error is returned next to the merged result, so what the earlier chunks changed is never lost.
export async function runBulkChunks<U>(
  items: MediaBulkItem[],
  call: (chunk: MediaBulkItem[]) => Promise<MediaBulkResult<U>>
): Promise<{ result: MediaBulkResult<U>; error: unknown }> {
  const updated: U[] = [];
  const skipped: MediaBulkSkipped[] = [];
  let error: unknown = null;
  for (let at = 0; at < items.length; at += MEDIA_BULK_MAX) {
    const chunk = items.slice(at, at + MEDIA_BULK_MAX);
    if (error !== null) {
      skipped.push(...chunk.map((i) => ({ id: i.id, reason: "request_failed" as const })));
      continue;
    }
    try {
      const part = await call(chunk);
      updated.push(...part.updated);
      skipped.push(...part.skipped);
    } catch (e) {
      error = e ?? new Error("bulk request failed");
      skipped.push(...chunk.map((i) => ({ id: i.id, reason: "request_failed" as const })));
    }
  }
  return { result: { updated, skipped, counts: { updated: updated.length, skipped: skipped.length } }, error };
}
