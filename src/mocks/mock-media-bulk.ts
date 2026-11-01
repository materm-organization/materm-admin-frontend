// Mock of the FR-MEDIA-11 bulk endpoints (admin backend b3f8435), strict like the backend:
//   POST /media/assets/bulk-move    body { items: [{id, etag}], folder_id: <id> | null }   (folder_id REQUIRED, null = root)
//   POST /media/assets/bulk-delete  body { items: [{id, etag}] }
// 1..100 items, unique ids, NO If-Match header: each item's ETag is its own precondition. 200 { updated[], skipped[], counts }.
// move skip reasons: not_found, stale (+ current etag), trashed, unchanged; delete: not_found, stale, already_deleted, in_use.
// Request-level problems are 422 (`/items` too_short | limit_exceeded, `/items/<i>/id` out_of_range | duplicate,
// `/items/<i>/etag` required | invalid_format, `/folder_id` required | invalid_type | unknown_reference). The permission
// (media.library:update / :delete) is checked by the screen (`useCan`); `setBulkDenied` makes the mock answer 403 for a test.
import { MOCK_USER, etagOf, fail, tick, validationFailed, type MockDb } from "@/mocks/mock-core";
import { recomputeFolders } from "@/mocks/mock-db";
import { MEDIA_BULK_MAX } from "@/lib/media-bulk";
import type { ApiFieldError } from "@/types/api";
import type { MediaBulkDeleteUpdated, MediaBulkMoveUpdated, MediaBulkResult, MediaBulkSkipped } from "@/types/media";

let denied = false;
export const setBulkDenied = (value: boolean) => {
  denied = value;
};
export const bulkCalls: Array<{ kind: "move" | "delete"; count: number }> = [];

type Item = { id: number; etag: string };

function parseItems(body: unknown, allowed: readonly string[]): { items: Item[]; input: Record<string, unknown> } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw validationFailed([{ in: "body", path: "", code: "invalid_type", params: { expected: "object" } }]);
  }
  const input = body as Record<string, unknown>;
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(input)) if (!allowed.includes(k)) errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  const items = input.items;
  if (!Array.isArray(items) || items.length < 1) errors.push({ in: "body", path: "/items", code: "too_short", params: { min: 1 } });
  else if (items.length > MEDIA_BULK_MAX) errors.push({ in: "body", path: "/items", code: "limit_exceeded", params: { max: MEDIA_BULK_MAX } });
  else {
    const seen = new Set<unknown>();
    items.forEach((it, i) => {
      const o = typeof it === "object" && it !== null && !Array.isArray(it) ? (it as Record<string, unknown>) : null;
      if (!o) {
        errors.push({ in: "body", path: `/items/${i}`, code: "invalid_type", params: { expected: "object" } });
        return;
      }
      for (const k of Object.keys(o)) if (k !== "id" && k !== "etag") errors.push({ in: "body", path: `/items/${i}/${k}`, code: "unknown_field" });
      if (typeof o.id !== "number" || !Number.isInteger(o.id)) errors.push({ in: "body", path: `/items/${i}/id`, code: "invalid_type", params: { expected: "integer" } });
      else if (o.id < 1) errors.push({ in: "body", path: `/items/${i}/id`, code: "out_of_range", params: { min: 1 } });
      else if (seen.has(o.id)) errors.push({ in: "body", path: `/items/${i}/id`, code: "duplicate" });
      seen.add(o.id);
      const tag = typeof o.etag === "string" ? o.etag.trim() : "";
      if (tag === "") errors.push({ in: "body", path: `/items/${i}/etag`, code: "required" });
      else if (tag === "*" || !/^(W\/)?".*"$/.test(tag)) errors.push({ in: "body", path: `/items/${i}/etag`, code: "invalid_format" });
    });
  }
  return { items: errors.length ? [] : (items as Item[]), input: Object.assign({}, input, { __errors: errors }) };
}

function need(kind: "update" | "delete") {
  if (denied) throw fail(403, "FORBIDDEN", "You do not have permission.", { details: { required: `media.library:${kind}` } });
}

export function bulkMoveAssets(db: MockDb, body: unknown): MediaBulkResult<MediaBulkMoveUpdated> {
  need("update");
  const { items, input } = parseItems(body, ["items", "folder_id"]);
  const errors = input.__errors as ApiFieldError[];
  const folder = input.folder_id;
  if (folder === undefined) errors.push({ in: "body", path: "/folder_id", code: "required" });
  else if (folder !== null && (typeof folder !== "number" || !Number.isInteger(folder))) errors.push({ in: "body", path: "/folder_id", code: "invalid_type" });
  else if (folder !== null && !db.folders.some((f) => f.id === folder)) errors.push({ in: "body", path: "/folder_id", code: "unknown_reference" });
  if (errors.length) throw validationFailed(errors);
  bulkCalls.push({ kind: "move", count: items.length });

  const target = folder as number | null;
  const updated: MediaBulkMoveUpdated[] = [];
  const skipped: MediaBulkSkipped[] = [];
  for (const item of items) {
    const asset = db.assets.find((a) => a.id === item.id);
    if (!asset) skipped.push({ id: item.id, reason: "not_found" });
    else if (item.etag.trim() !== etagOf(asset.updated_at)) skipped.push({ id: item.id, reason: "stale", etag: etagOf(asset.updated_at) });
    else if (asset.deleted_at) skipped.push({ id: item.id, reason: "trashed" });
    else if (asset.folder_id === target) skipped.push({ id: item.id, reason: "unchanged" });
    else {
      asset.folder_id = target;
      asset.updated_at = tick(db);
      asset.updated_by = MOCK_USER;
      updated.push({ id: asset.id, ...(target === null ? {} : { folder_id: target }), etag: etagOf(asset.updated_at) });
    }
  }
  recomputeFolders(db);
  return { updated, skipped, counts: { updated: updated.length, skipped: skipped.length } };
}

export function bulkDeleteAssets(db: MockDb, body: unknown): MediaBulkResult<MediaBulkDeleteUpdated> {
  need("delete");
  const { items, input } = parseItems(body, ["items"]);
  const errors = input.__errors as ApiFieldError[];
  if (errors.length) throw validationFailed(errors);
  bulkCalls.push({ kind: "delete", count: items.length });

  const updated: MediaBulkDeleteUpdated[] = [];
  const skipped: MediaBulkSkipped[] = [];
  for (const item of items) {
    const asset = db.assets.find((a) => a.id === item.id);
    if (!asset) skipped.push({ id: item.id, reason: "not_found" });
    else if (item.etag.trim() !== etagOf(asset.updated_at)) skipped.push({ id: item.id, reason: "stale", etag: etagOf(asset.updated_at) });
    else if (asset.deleted_at) skipped.push({ id: item.id, reason: "already_deleted" });
    else if ((db.usages[asset.id] ?? []).length > 0) skipped.push({ id: item.id, reason: "in_use" });
    else {
      const now = tick(db);
      asset.deleted_at = now;
      asset.purge_at = new Date(Date.parse(now) + 30 * 86_400_000).toISOString();
      asset.updated_at = now;
      asset.updated_by = MOCK_USER;
      updated.push({ id: asset.id, purge_at: asset.purge_at, etag: etagOf(asset.updated_at) });
    }
  }
  recomputeFolders(db);
  return { updated, skipped, counts: { updated: updated.length, skipped: skipped.length } };
}
