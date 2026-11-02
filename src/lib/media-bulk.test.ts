import { describe, expect, it, vi } from "vitest";

import { MEDIA_BULK_MAX, runBulkChunks, toBulkItems } from "@/lib/media-bulk";
import { bulkDeleteAssets, bulkMoveAssets } from "@/mocks/mock-media-bulk";
import { createMockDb } from "@/mocks/mock-db";
import { MediaAPI } from "@/services/media.api";
import { useMockApi } from "@/mocks/test-setup";
import type { MediaBulkItem } from "@/types/media";
import { etagOf } from "@/mocks/mock-core";

const items = (n: number): MediaBulkItem[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, etag: '"x"' }));
const ok = (chunk: MediaBulkItem[]) => ({ updated: chunk.map((i) => ({ id: i.id })), skipped: [], counts: { updated: chunk.length, skipped: 0 } });

describe("runBulkChunks", () => {
  it("splits more than 100 items into requests of at most 100 and merges the answers", async () => {
    const call = vi.fn(async (chunk: MediaBulkItem[]) => ok(chunk));
    const { result, error } = await runBulkChunks(items(250), call);
    expect(call.mock.calls.map(([c]) => c.length)).toEqual([MEDIA_BULK_MAX, MEDIA_BULK_MAX, 50]);
    expect(error).toBeNull();
    expect(result.counts).toEqual({ updated: 250, skipped: 0 });
  });

  it("a failed request keeps what the earlier chunks did and marks the rest as not sent", async () => {
    const call = vi.fn(async (chunk: MediaBulkItem[]) => {
      if (chunk[0].id === 101) throw new Error("403");
      return ok(chunk);
    });
    const { result, error } = await runBulkChunks(items(250), call);
    expect(call).toHaveBeenCalledTimes(2);
    expect(error).toBeInstanceOf(Error);
    expect(result.counts).toEqual({ updated: 100, skipped: 150 });
    expect(result.skipped.every((s) => s.reason === "request_failed")).toBe(true);
  });

  it("builds the items from the list rows' etags", () => {
    expect(toBulkItems([{ id: 3, updated_at: "2026-10-29T13:43:36.5+07:00" }])).toEqual([{ id: 3, etag: '"2026-10-29T06:43:36.5Z"' }]);
  });
});

describe("the strict bulk mock (backend contract)", () => {
  useMockApi();
  const fieldErrors = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as { body: { errors: Array<{ path: string; code: string }> } }).body.errors.map((x) => `${x.path}:${x.code}`);
    }
    return [];
  };

  it("validates the request", () => {
    const db = createMockDb();
    expect(fieldErrors(() => bulkMoveAssets(db, { items: [], folder_id: null }))).toEqual(["/items:too_short"]);
    expect(fieldErrors(() => bulkMoveAssets(db, { items: items(101), folder_id: null }))).toEqual(["/items:limit_exceeded"]);
    expect(fieldErrors(() => bulkMoveAssets(db, { items: [{ id: 1, etag: '"a"' }] }))).toEqual(["/folder_id:required"]);
    expect(fieldErrors(() => bulkMoveAssets(db, { items: [{ id: 1, etag: '"a"' }], folder_id: 999 }))).toEqual(["/folder_id:unknown_reference"]);
    expect(fieldErrors(() => bulkMoveAssets(db, { items: [{ id: 1, etag: '"a"' }], folder_id: "3" }))).toEqual(["/folder_id:invalid_type"]);
    expect(
      fieldErrors(() => bulkDeleteAssets(db, { items: [{ id: 0, etag: '"a"' }, { id: 2, etag: "" }, { id: 2, etag: "*" }] }))
    ).toEqual(["/items/0/id:out_of_range", "/items/1/etag:required", "/items/2/id:duplicate", "/items/2/etag:invalid_format"]);
  });

  it("answers per item through the API", async () => {
    const db = (await import("@/mocks/mock-db")).getMockDb();
    const etag = (id: number) => etagOf(db.assets.find((a) => a.id === id)!.updated_at);
    const r = await MediaAPI.BulkDelete([
      { id: 5, etag: etag(5) },
      { id: 1, etag: etag(1) },
      { id: 9999, etag: '"z"' },
      { id: 6, etag: '"stale"' },
    ]);
    expect(r.updated.map((u) => u.id)).toEqual([5]);
    expect(r.updated[0].purge_at).toBeTruthy();
    expect(r.skipped).toEqual([
      { id: 1, reason: "in_use" },
      { id: 9999, reason: "not_found" },
      { id: 6, reason: "stale", etag: etag(6) },
    ]);
    const again = await MediaAPI.BulkDelete([{ id: 5, etag: etag(5) }]);
    expect(again.skipped).toEqual([{ id: 5, reason: "already_deleted" }]);
  });
});
