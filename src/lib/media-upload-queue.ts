// The upload queue of the media library (FR-MEDIA-01): one request per file, at most `concurrency` at a time,
// per-file progress and status, a failed file never blocks the others. Framework-free (the React side is
// `hooks/use-media-upload.ts`, which reads it with `useSyncExternalStore`).
//
//   queued -> uploading -> done                      (asset created)
//                       -> duplicate                 (same checksum: "use existing file" -> done, "upload anyway" -> queued)
//                       -> failed                    (`Retry` -> queued; 429 / 503 / network are retried automatically a few times)
import { isAutoRetryable, mapUploadError, MAX_FILES_PER_BATCH, UPLOAD_CONCURRENCY, type UploadError } from "@/lib/media-upload";
import type { MediaAsset, MediaAssetDetail, MediaUploadResult } from "@/types/media";

export type UploadStatus = "queued" | "uploading" | "done" | "failed" | "duplicate";

export type UploadItem = {
  id: string;
  file: File;
  status: UploadStatus;
  // 0..100 of the current attempt.
  progress: number;
  // Automatic retries used so far (429 / 503 / network).
  attempts: number;
  error?: UploadError;
  // `done`: the created asset, or the existing one when the user chose "use existing file".
  asset?: MediaAsset | MediaAssetDetail;
  reusedExisting?: boolean;
  // `duplicate`: the asset the server already has (`existing` may be unknown: only its id).
  duplicate?: { existingId: number; existing: MediaAsset | null };
  allowDuplicate: boolean;
};

// What the screen tells the queue and can change while files wait (the folder being browsed, the user's rights).
// `accept` = the media picker's mime filter (blank = anything).
export type UploadContext = { folderId: number | null; allowSvg: boolean; accept?: string };

export type UploadFn = (
  file: File,
  options: { allowDuplicate: boolean; signal: AbortSignal; onProgress: (percent: number | undefined) => void; context: UploadContext }
) => Promise<MediaUploadResult>;

export type QueueOptions = {
  upload: UploadFn;
  // Client-side convenience check (`checkFile`): an error here puts the file straight to `failed` (not retryable).
  precheck?: (file: File, context: UploadContext) => UploadError | null;
  concurrency?: number;
  maxFiles?: number;
  // Automatic retries of 429 / 503 / network errors per file.
  maxAutoRetries?: number;
  // ms to wait before automatic retry number `attempt` (1-based); `retryAfter` is the server's seconds.
  retryDelay?: (attempt: number, retryAfter: number | undefined) => number;
};

const defaultRetryDelay = (attempt: number, retryAfter: number | undefined) =>
  Math.min(10_000, retryAfter !== undefined ? retryAfter * 1000 : 1000 * attempt);

export class UploadQueue {
  private items: UploadItem[] = [];
  private listeners = new Set<() => void>();
  private controllers = new Map<string, AbortController>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private seq = 0;
  private context: UploadContext = { folderId: null, allowSvg: false };
  private readonly concurrency: number;
  private readonly maxFiles: number;
  private readonly maxAutoRetries: number;
  private readonly retryDelay: (attempt: number, retryAfter: number | undefined) => number;

  constructor(private readonly options: QueueOptions) {
    this.concurrency = options.concurrency ?? UPLOAD_CONCURRENCY;
    this.maxFiles = options.maxFiles ?? MAX_FILES_PER_BATCH;
    this.maxAutoRetries = options.maxAutoRetries ?? 2;
    this.retryDelay = options.retryDelay ?? defaultRetryDelay;
  }

  // Read when a file is checked / STARTS (so a change applies to the files still waiting).
  setContext(context: UploadContext) {
    this.context = context;
  }

  // useSyncExternalStore contract: `getSnapshot` returns the SAME array until something changes.
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = (): readonly UploadItem[] => this.items;

  private emit(next: UploadItem[]) {
    this.items = next;
    for (const l of this.listeners) l();
  }
  private patch(id: string, change: Partial<UploadItem>) {
    this.emit(this.items.map((i) => (i.id === id ? { ...i, ...change } : i)));
  }
  private get(id: string) {
    return this.items.find((i) => i.id === id);
  }

  // Adds files (<= `maxFiles` in the list at once; the rest is returned as `skipped`). Files that fail the
  // client check are listed as `failed` right away and never sent.
  add(files: File[]): { added: number; skipped: number } {
    const room = Math.max(0, this.maxFiles - this.items.length);
    const accepted = files.slice(0, room);
    const fresh: UploadItem[] = accepted.map((file) => {
      const error = this.options.precheck?.(file, this.context) ?? null;
      return {
        id: `u${++this.seq}`,
        file,
        status: error ? "failed" : "queued",
        progress: 0,
        attempts: 0,
        error: error ?? undefined,
        allowDuplicate: false,
      };
    });
    this.emit([...this.items, ...fresh]);
    this.pump();
    return { added: accepted.length, skipped: files.length - accepted.length };
  }

  // Starts queued files while there is a free slot.
  private pump() {
    let running = this.items.filter((i) => i.status === "uploading").length;
    for (const item of this.items) {
      if (running >= this.concurrency) break;
      if (item.status === "queued" && !this.timers.has(item.id)) {
        running += 1;
        void this.run(item.id);
      }
    }
  }

  private async run(id: string) {
    const item = this.get(id);
    if (!item) return;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.patch(id, { status: "uploading", progress: 0, error: undefined });
    try {
      const result = await this.options.upload(item.file, {
        allowDuplicate: item.allowDuplicate,
        signal: controller.signal,
        context: this.context,
        onProgress: (percent) => {
          if (percent !== undefined && this.get(id)?.status === "uploading") this.patch(id, { progress: percent });
        },
      });
      if (controller.signal.aborted || !this.get(id)) return;
      if (result.kind === "created") {
        this.patch(id, { status: "done", progress: 100, asset: result.asset });
      } else {
        this.patch(id, { status: "duplicate", progress: 100, duplicate: { existingId: result.existingId, existing: result.existing } });
      }
    } catch (error) {
      if (controller.signal.aborted || !this.get(id)) return;
      const mapped = mapUploadError(error);
      const attempts = this.get(id)?.attempts ?? 0;
      if (isAutoRetryable(mapped) && attempts < this.maxAutoRetries) {
        this.scheduleRetry(id, attempts + 1, mapped);
      } else {
        this.patch(id, { status: "failed", progress: 0, error: mapped });
      }
    } finally {
      this.controllers.delete(id);
      this.pump();
    }
  }

  // Network drops count as automatic retries too (a flaky link), but only 429 / 503 carry a server delay.
  private scheduleRetry(id: string, attempt: number, error: UploadError) {
    this.patch(id, { status: "queued", progress: 0, attempts: attempt, error });
    const timer = setTimeout(() => {
      this.timers.delete(id);
      this.pump();
    }, this.retryDelay(attempt, error.retryAfter));
    this.timers.set(id, timer);
  }

  // "Retry" on a failed file (also resets the automatic-retry budget).
  retry(id: string) {
    const item = this.get(id);
    if (!item || item.status !== "failed" || !item.error?.retryable) return;
    this.patch(id, { status: "queued", progress: 0, attempts: 0, error: undefined });
    this.pump();
  }
  retryAll() {
    for (const item of this.items) if (item.status === "failed" && item.error?.retryable) this.retry(item.id);
  }

  // Duplicate choice 1: keep the existing file, nothing is uploaded.
  reuseExisting(id: string) {
    const item = this.get(id);
    if (!item || item.status !== "duplicate" || !item.duplicate) return;
    this.patch(id, { status: "done", asset: item.duplicate.existing ?? undefined, reusedExisting: true });
  }
  // Duplicate choice 2: send it again with `allow_duplicate=true`.
  uploadAnyway(id: string) {
    const item = this.get(id);
    if (!item || item.status !== "duplicate") return;
    this.patch(id, { status: "queued", progress: 0, attempts: 0, allowDuplicate: true, duplicate: undefined });
    this.pump();
  }

  remove(id: string) {
    this.controllers.get(id)?.abort();
    this.controllers.delete(id);
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.emit(this.items.filter((i) => i.id !== id));
    this.pump();
  }
  // Takes finished rows (done) out of the list so a new batch can be dropped in.
  clearDone() {
    this.emit(this.items.filter((i) => i.status !== "done"));
  }
  // Aborts what runs, forgets everything (dialog closed / unmounted).
  reset() {
    for (const c of this.controllers.values()) c.abort();
    for (const t of this.timers.values()) clearTimeout(t);
    this.controllers.clear();
    this.timers.clear();
    this.emit([]);
  }

  get isBusy() {
    return this.items.some((i) => i.status === "queued" || i.status === "uploading");
  }
}
