import { describe, expect, it } from "vitest";

import { UPLOAD_CONCURRENCY, errorTextParams, mapUploadError, replaceAcceptAttribute, type UploadError } from "@/lib/media-upload";
import { UploadQueue, type UploadFn } from "@/lib/media-upload-queue";
import { apiError } from "@/test/api-error";
import type { MediaAssetDetail, MediaUploadResult } from "@/types/media";
import en from "../../i18n/en.json";
import la from "../../i18n/la.json";
import { IntlMessageFormat } from "intl-messageformat";

const fileErr = (code: string, params?: Record<string, unknown>) =>
  apiError(422, { code: "VALIDATION_FAILED", errors: [{ in: "body", path: "/file", code, message: "english", params }] });

describe("mapUploadError: video answers of the backend (b307bed)", () => {
  it.each([
    ["faststart_required", undefined, { kind: "faststartRequired" }],
    ["duration_too_long", { duration_ms: 34200, max_ms: 35000 }, { kind: "durationTooLong", params: { seconds: "34.2", max: 35 } }],
    ["duration_too_long", { max_ms: 35000 }, { kind: "durationLimit", params: { max: 35 } }],
    ["dimensions_too_large", { width: 3840, height: 2160, max_width: 1920, max_height: 1080 }, { kind: "dimensionsTooLarge", params: { width: 3840, height: 2160, maxWidth: 1920, maxHeight: 1080 } }],
    ["codec_unsupported", { codec: "hvc1" }, { kind: "codecUnsupported", params: { codec: "hvc1" } }],
    ["bitrate_too_high", { max_bits_per_second: 40_000_000 }, { kind: "bitrateTooHigh", params: { maxMbit: 40 } }],
    ["damaged", undefined, { kind: "damaged" }],
    ["kind_mismatch", { expected_kind: "video" }, { kind: "kindMismatch" }],
  ])("422 %s", (code, params, expected) => {
    expect(mapUploadError(fileErr(code, params))).toMatchObject({ ...expected, retryable: false });
  });

  it("413 max_video_bytes is the video message; a 413 without a reason stays generic", () => {
    expect(mapUploadError(apiError(413, { code: "PAYLOAD_TOO_LARGE", details: { reason: "max_video_bytes", max_video_bytes: 52428800 } }))).toMatchObject({ kind: "videoTooLarge", retryable: false });
    expect(mapUploadError(apiError(413, { code: "PAYLOAD_TOO_LARGE" }))).toMatchObject({ kind: "tooLarge" });
  });

  it("415 carries the server's allowed list; unknown 422 field codes stay `invalid`", () => {
    expect(mapUploadError(apiError(415, { code: "UNSUPPORTED_MEDIA_TYPE", details: { allowed: ["image/png", "video/mp4"] } }))).toMatchObject({ kind: "unsupported", params: { allowed: "image/png, video/mp4" } });
    expect(mapUploadError(fileErr("something_new"))).toMatchObject({ kind: "invalid" });
  });

  it("503 upload_slots_busy is `busy` and retried after Retry-After (3 s when the header is hidden)", () => {
    expect(mapUploadError(apiError(503, { code: "SERVICE_UNAVAILABLE", details: { reason: "upload_slots_busy" } }, { "retry-after": "3" }))).toMatchObject({ kind: "busy", retryable: true, retryAfter: 3 });
    expect(mapUploadError(apiError(503, { code: "SERVICE_UNAVAILABLE", details: { reason: "upload_slots_busy" } }))).toMatchObject({ kind: "busy", retryAfter: 3 });
    expect(mapUploadError(apiError(503, { details: { dependency: "file_store" } }))).toMatchObject({ kind: "unavailable" });
  });
});

describe("error texts: every kind has a text in both languages and its arguments are complete", () => {
  const kinds = ["faststartRequired", "durationTooLong", "durationLimit", "dimensionsTooLarge", "codecUnsupported", "bitrateTooHigh", "damaged", "videoTooLarge", "kindMismatch"] as const;
  const render = (messages: Record<string, string>, locale: string, error: UploadError) =>
    new IntlMessageFormat(messages[error.kind], locale).format(errorTextParams(error)) as string;

  it("English wording uses the numbers of the server (34.2 s, at most 35 s)", () => {
    const e = en.media.upload.errors as Record<string, string>;
    expect(render(e, "en", mapUploadError(fileErr("duration_too_long", { duration_ms: 34200, max_ms: 35000 })))).toBe("The video is 34.2 s long; at most 35 s is accepted.");
    expect(render(e, "en", mapUploadError(fileErr("dimensions_too_large", { width: 3840, height: 2160, max_width: 1920, max_height: 1080 })))).toContain("3840x2160");
    expect(render(e, "en", mapUploadError(fileErr("codec_unsupported", { codec: "hvc1" })))).toContain("hvc1");
    expect(render(e, "en", { kind: "videoTooLarge", retryable: false })).toBe("The video is too large: at most 50 MB.");
    expect(render(e, "en", { kind: "faststartRequired", retryable: false })).toContain("-movflags +faststart");
  });

  it.each([["en", en], ["la", la]])("%s has all video error kinds and formats without a missing argument", (locale, messages) => {
    const errors = messages.media.upload.errors as Record<string, string>;
    for (const kind of kinds) {
      expect(errors[kind], `${locale} ${kind}`).toBeTruthy();
      expect(() => render(errors, locale, { kind, retryable: false })).not.toThrow();
    }
  });
});

describe("replaceAcceptAttribute", () => {
  it("a video row takes only MP4; other rows keep the image / PDF list without video", () => {
    expect(replaceAcceptAttribute("video", true)).toBe("video/mp4");
    expect(replaceAcceptAttribute("image", true)).not.toContain("video/mp4");
    expect(replaceAcceptAttribute("image", true)).toContain("image/svg+xml");
    expect(replaceAcceptAttribute("image", false)).not.toContain("svg");
  });
});

describe("UploadQueue: videos go one at a time", () => {
  const asset = (id: number): MediaAssetDetail => ({ id, original_filename: `f${id}` }) as MediaAssetDetail;
  const done = (id: number): MediaUploadResult => ({ kind: "created", asset: asset(id), etag: `"${id}"` });
  const mp4 = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "video/mp4" });
  const png = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
  function controllable() {
    const calls: Array<{ file: File; resolve: (r: MediaUploadResult) => void }> = [];
    const upload: UploadFn = (file) => new Promise((resolve) => calls.push({ file, resolve }));
    return { upload, calls };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("two videos run one after the other while images are not held back", async () => {
    const { upload, calls } = controllable();
    const q = new UploadQueue({ upload });
    q.add([mp4("v1.mp4"), mp4("v2.mp4"), png("a.png"), png("b.png"), png("c.png")]);
    await flush();
    expect(calls.map((c) => c.file.name)).toEqual(["v1.mp4", "a.png", "b.png"]); // v2 waits, the images pass it, 3 in all
    expect(UPLOAD_CONCURRENCY).toBe(3);
    calls[0].resolve(done(1));
    await flush();
    expect(calls.map((c) => c.file.name)).toContain("v2.mp4");
    expect(q.getSnapshot().filter((i) => i.status === "uploading" && i.file.name.endsWith(".mp4"))).toHaveLength(1);
  });

  it("the pre-check stops a video before any byte is sent (not retryable); an image is not probed", async () => {
    const { upload, calls } = controllable();
    const probed: string[] = [];
    const q = new UploadQueue({
      upload,
      probe: async (f) => {
        probed.push(f.name);
        return { kind: "faststartRequired", retryable: false };
      },
    });
    q.add([mp4("bad.mp4")]);
    await flush();
    expect(calls).toHaveLength(0);
    const item = q.getSnapshot()[0];
    expect(item.status).toBe("failed");
    expect(item.error).toMatchObject({ kind: "faststartRequired", retryable: false });
    expect(probed).toEqual(["bad.mp4"]);
  });

  it("503 upload_slots_busy is retried automatically after the delay, then the video goes through", async () => {
    let n = 0;
    const upload: UploadFn = async () => {
      n += 1;
      if (n === 1) throw apiError(503, { details: { reason: "upload_slots_busy" } }, { "retry-after": "3" });
      return done(1);
    };
    const delays: Array<number | undefined> = [];
    const q = new UploadQueue({ upload, retryDelay: (_a, retryAfter) => (delays.push(retryAfter), 5) });
    q.add([mp4("v.mp4")]);
    await new Promise((r) => setTimeout(r, 40));
    expect(delays).toEqual([3]);
    expect(q.getSnapshot()[0].status).toBe("done");
  });

  it("cancel (remove) aborts the running video request", async () => {
    let signal: AbortSignal | undefined;
    const upload: UploadFn = (_f, o) => new Promise(() => { signal = o.signal; });
    const q = new UploadQueue({ upload });
    q.add([mp4("v.mp4")]);
    await flush();
    q.remove(q.getSnapshot()[0].id);
    expect(signal?.aborted).toBe(true);
  });
});
