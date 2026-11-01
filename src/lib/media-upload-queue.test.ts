import { describe, expect, it, vi } from "vitest";

import { checkFile } from "@/lib/media-upload";
import { UploadQueue, type UploadFn, type UploadItem } from "@/lib/media-upload-queue";
import { apiError, networkError } from "@/test/api-error";
import type { MediaAssetDetail, MediaUploadResult } from "@/types/media";

const asset = (id: number): MediaAssetDetail => ({ id, original_filename: `f${id}.png` }) as MediaAssetDetail;
const created = (id: number): MediaUploadResult => ({ kind: "created", asset: asset(id), etag: `"${id}"` });
const png = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

// An upload function whose calls are settled by the test, in any order.
function controllable() {
  const calls: Array<{
    file: File;
    allowDuplicate: boolean;
    signal: AbortSignal;
    progress: (p: number | undefined) => void;
    resolve: (r: MediaUploadResult) => void;
    reject: (e: unknown) => void;
  }> = [];
  const upload: UploadFn = (file, o) =>
    new Promise((resolve, reject) => {
      calls.push({ file, allowDuplicate: o.allowDuplicate, signal: o.signal, progress: o.onProgress, resolve, reject });
    });
  return { upload, calls };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const byName = (q: UploadQueue, name: string): UploadItem => q.getSnapshot().find((i) => i.file.name === name)!;

describe("UploadQueue", () => {
  it("runs at most 3 uploads at once and starts the next as one finishes", async () => {
    const { upload, calls } = controllable();
    const q = new UploadQueue({ upload });
    q.add(["a", "b", "c", "d", "e"].map(png));
    expect(calls).toHaveLength(3);
    expect(q.getSnapshot().map((i) => i.status)).toEqual(["uploading", "uploading", "uploading", "queued", "queued"]);
    calls[1].resolve(created(2));
    await flush();
    expect(calls).toHaveLength(4);
    expect(byName(q, "b").status).toBe("done");
    expect(q.getSnapshot().filter((i) => i.status === "uploading")).toHaveLength(3);
    expect(q.isBusy).toBe(true);
  });

  it("reports per-file progress and keeps files independent", async () => {
    const { upload, calls } = controllable();
    const q = new UploadQueue({ upload });
    q.add([png("a"), png("b")]);
    calls[0].progress(40);
    calls[1].progress(90);
    expect(byName(q, "a").progress).toBe(40);
    expect(byName(q, "b").progress).toBe(90);
    calls[0].progress(undefined);
    expect(byName(q, "a").progress).toBe(40);
  });

  it("a failed file never blocks the others", async () => {
    const { upload, calls } = controllable();
    const q = new UploadQueue({ upload, concurrency: 1 });
    q.add([png("a"), png("b")]);
    calls[0].reject(apiError(413, { code: "PAYLOAD_TOO_LARGE" }));
    await flush();
    expect(byName(q, "a")).toMatchObject({ status: "failed", error: { kind: "tooLarge", retryable: false } });
    expect(calls).toHaveLength(2);
    calls[1].resolve(created(2));
    await flush();
    expect(byName(q, "b").status).toBe("done");
    expect(q.isBusy).toBe(false);
  });

  it("retries a retryable failure by hand; a non-retryable one has no retry", async () => {
    const { upload, calls } = controllable();
    const q = new UploadQueue({ upload });
    q.add([png("a"), png("b")]);
    calls[0].reject(apiError(500, { code: "INTERNAL_ERROR" }));
    calls[1].reject(apiError(415, { code: "UNSUPPORTED_MEDIA_TYPE" }));
    await flush();
    const a = byName(q, "a");
    q.retry(byName(q, "b").id);
    expect(byName(q, "b").status).toBe("failed");
    q.retry(a.id);
    expect(byName(q, "a").status).toBe("uploading");
    expect(calls).toHaveLength(3);
    calls[2].resolve(created(1));
    await flush();
    expect(byName(q, "a").status).toBe("done");
  });

  it("retryAll restarts every retryable failure", async () => {
    const { upload, calls } = controllable();
    const q = new UploadQueue({ upload, maxAutoRetries: 0 });
    q.add([png("c"), png("d"), png("e")]);
    calls[0].reject(networkError());
    calls[1].reject(apiError(500));
    calls[2].reject(apiError(415));
    await flush();
    expect(q.getSnapshot().map((i) => i.status)).toEqual(["failed", "failed", "failed"]);
    q.retryAll();
    expect(q.getSnapshot().map((i) => i.status)).toEqual(["uploading", "uploading", "failed"]);
  });

  it("429 / 503 are retried automatically (server delay honoured), then give up", async () => {
    vi.useFakeTimers();
    try {
      const { upload, calls } = controllable();
      const delays: Array<[number, number | undefined]> = [];
      const q = new UploadQueue({
        upload,
        maxAutoRetries: 2,
        retryDelay: (attempt, retryAfter) => {
          delays.push([attempt, retryAfter]);
          return 1000;
        },
      });
      q.add([png("a")]);
      calls[0].reject(apiError(429, { code: "RATE_LIMITED" }, { "retry-after": "3" }));
      await vi.advanceTimersByTimeAsync(0);
      expect(byName(q, "a")).toMatchObject({ status: "queued", attempts: 1 });
      expect(calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls).toHaveLength(2);
      calls[1].reject(apiError(503));
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls).toHaveLength(3);
      calls[2].reject(apiError(503));
      await vi.advanceTimersByTimeAsync(5000);
      expect(calls).toHaveLength(3);
      expect(byName(q, "a")).toMatchObject({ status: "failed", error: { kind: "unavailable", retryable: true } });
      expect(delays).toEqual([[1, 3], [2, undefined]]);
      // the manual retry has a fresh budget
      q.retry(byName(q, "a").id);
      expect(calls).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a duplicate pauses the file: 'use existing' finishes it, 'upload anyway' resends with allow_duplicate", async () => {
    const { upload, calls } = controllable();
    const fetchExisting = vi.fn(async (id: number) => ({ id, original_filename: "old.png", full: true }) as never);
    const q = new UploadQueue({ upload, fetchExisting });
    q.add([png("a"), png("b")]);
    const existing = { id: 7, original_filename: "old.png" };
    calls[0].resolve({ kind: "duplicate", existingId: 7, existing });
    calls[1].resolve({ kind: "duplicate", existingId: 8, existing: null });
    await flush();
    expect(byName(q, "a")).toMatchObject({ status: "duplicate", duplicate: { existingId: 7 } });

    await q.reuseExisting(byName(q, "a").id);
    // the summary is not the asset: the FULL one is fetched first
    expect(fetchExisting).toHaveBeenCalledWith(7);
    expect(byName(q, "a")).toMatchObject({ status: "done", reusedExisting: true, asset: { id: 7, full: true } });
    expect(calls).toHaveLength(2);

    q.uploadAnyway(byName(q, "b").id);
    expect(calls).toHaveLength(3);
    expect(calls[2].allowDuplicate).toBe(true);
    expect(calls[0].allowDuplicate).toBe(false);
    calls[2].resolve(created(9));
    await flush();
    expect(byName(q, "b")).toMatchObject({ status: "done", asset: { id: 9 } });
  });

  it("caps the list at 50 files and reports what was skipped", () => {
    const { upload } = controllable();
    const q = new UploadQueue({ upload });
    const first = q.add(Array.from({ length: 48 }, (_, i) => png(`a${i}`)));
    expect(first).toEqual({ added: 48, skipped: 0 });
    const second = q.add(Array.from({ length: 5 }, (_, i) => png(`b${i}`)));
    expect(second).toEqual({ added: 2, skipped: 3 });
    expect(q.getSnapshot()).toHaveLength(50);
  });

  it("files that fail the client check are listed as failed and never sent", () => {
    const { upload, calls } = controllable();
    const q = new UploadQueue({ upload, precheck: (f) => checkFile(f, { allowSvg: false }) });
    q.add([new File(["x"], "a.zip", { type: "application/zip" }), new File(["<svg/>"], "b.svg", { type: "image/svg+xml" }), png("c")]);
    expect(q.getSnapshot().map((i) => [i.status, i.error?.kind])).toEqual([
      ["failed", "unsupported"],
      ["failed", "svgNotAllowed"],
      ["uploading", undefined],
    ]);
    expect(calls).toHaveLength(1);
  });

  it("remove aborts a running upload and frees the slot; reset aborts everything", async () => {
    const { upload, calls } = controllable();
    const q = new UploadQueue({ upload, concurrency: 1 });
    q.add([png("a"), png("b")]);
    q.remove(byName(q, "a").id);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls).toHaveLength(2);
    // the aborted call settling late must not touch the list
    calls[0].reject(new Error("canceled"));
    await flush();
    expect(q.getSnapshot().map((i) => i.file.name)).toEqual(["b"]);
    q.reset();
    expect(calls[1].signal.aborted).toBe(true);
    expect(q.getSnapshot()).toHaveLength(0);
  });

  it("clearDone drops finished files only, and notifies subscribers with a new snapshot", async () => {
    const { upload, calls } = controllable();
    const q = new UploadQueue({ upload });
    const listener = vi.fn();
    q.subscribe(listener);
    q.add([png("a"), png("b")]);
    const before = q.getSnapshot();
    calls[0].resolve(created(1));
    await flush();
    expect(q.getSnapshot()).not.toBe(before);
    expect(q.getSnapshot()).toBe(q.getSnapshot());
    q.clearDone();
    expect(q.getSnapshot().map((i) => i.file.name)).toEqual(["b"]);
    expect(listener).toHaveBeenCalled();
  });
});

describe("reuseExisting when the full asset can not be fetched", () => {
  it("the file fails (retryable) instead of selecting a partial asset", async () => {
    const { upload, calls } = controllable();
    const q = new UploadQueue({ upload, fetchExisting: async () => Promise.reject(new Error("boom")) });
    q.add([png("a")]);
    calls[0].resolve({ kind: "duplicate", existingId: 7, existing: { id: 7, original_filename: "old.png" } });
    await flush();
    await q.reuseExisting(byName(q, "a").id);
    expect(byName(q, "a")).toMatchObject({ status: "failed" });
    expect(byName(q, "a").asset).toBeUndefined();
  });
});
