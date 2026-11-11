import { describe, expect, it } from "vitest";

import { MAX_VIDEO_BYTES, MAX_FILE_BYTES, MAX_SVG_BYTES, acceptAttribute, checkFile, guessMime, isAutoRetryable, mapUploadError } from "@/lib/media-upload";
import { apiError, networkError } from "@/test/api-error";

const file = (name: string, type: string, size = 1000) => ({ name, type, size });

describe("checkFile: MP4 video", () => {
  it("allows up to 50 MB and refuses more", () => {
    expect(checkFile(file("a.mp4", "video/mp4", MAX_VIDEO_BYTES), { allowSvg: false })).toBeNull();
    expect(checkFile(file("a.mp4", "", MAX_VIDEO_BYTES + 1), { allowSvg: false })?.kind).toBe("videoTooLarge");
  });
});

describe("checkFile (client convenience check)", () => {
  it("accepts the allowed types within their size", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif", "application/pdf"]) {
      expect(checkFile(file("a", type, MAX_FILE_BYTES), { allowSvg: false })).toBeNull();
    }
  });

  it("rejects too large, unsupported and empty files", () => {
    expect(checkFile(file("a.png", "image/png", MAX_FILE_BYTES + 1), { allowSvg: true })?.kind).toBe("tooLarge");
    expect(checkFile(file("a.zip", "application/zip"), { allowSvg: true })?.kind).toBe("unsupported");
    expect(checkFile(file("a.png", "image/png", 0), { allowSvg: true })?.kind).toBe("empty");
    expect(checkFile(file("a.png", "image/png", MAX_FILE_BYTES + 1), { allowSvg: true })?.retryable).toBe(false);
  });

  it("SVG: only with `update`, and at most 1 MB", () => {
    expect(checkFile(file("a.svg", "image/svg+xml"), { allowSvg: false })?.kind).toBe("svgNotAllowed");
    expect(checkFile(file("a.svg", "image/svg+xml"), { allowSvg: true })).toBeNull();
    expect(checkFile(file("a.svg", "image/svg+xml", MAX_SVG_BYTES + 1), { allowSvg: true })?.kind).toBe("tooLarge");
  });

  it("falls back to the extension when the browser gives no type", () => {
    expect(guessMime(file("photo.JPG", ""))).toBe("image/jpeg");
    expect(checkFile(file("photo.avif", ""), { allowSvg: false })).toBeNull();
    expect(checkFile(file("noext", ""), { allowSvg: false })?.kind).toBe("unsupported");
  });

  it("`accept` lists SVG only when allowed", () => {
    expect(acceptAttribute(false)).not.toContain("svg");
    expect(acceptAttribute(true)).toContain("image/svg+xml");
  });
});

describe("mapUploadError", () => {
  it("maps the statuses of the contract", () => {
    expect(mapUploadError(apiError(413, { code: "PAYLOAD_TOO_LARGE" }))).toMatchObject({ kind: "tooLarge", retryable: false });
    expect(mapUploadError(apiError(415, { code: "UNSUPPORTED_MEDIA_TYPE" }))).toMatchObject({ kind: "unsupported", retryable: false });
    expect(mapUploadError(apiError(429, { code: "RATE_LIMITED" }))).toMatchObject({ kind: "busy", retryable: true });
    expect(mapUploadError(apiError(503, { code: "SERVICE_UNAVAILABLE" }))).toMatchObject({ kind: "unavailable", retryable: true });
    expect(mapUploadError(apiError(403, { code: "FORBIDDEN" }))).toMatchObject({ kind: "forbidden", retryable: false });
    expect(mapUploadError(apiError(422, { code: "VALIDATION_FAILED" }))).toMatchObject({ kind: "invalid", retryable: false });
    expect(mapUploadError(apiError(503, {}, { "retry-after": "2" }))).toMatchObject({ kind: "busy", retryable: true, retryAfter: 2 });
    expect(mapUploadError(networkError())).toMatchObject({ kind: "network", retryable: true });
    expect(mapUploadError(apiError(500, { code: "INTERNAL_ERROR" }))).toMatchObject({ kind: "unknown", retryable: true });
    expect(mapUploadError(new Error("boom"))).toMatchObject({ kind: "unknown" });
  });

  it("only the transient kinds are retried automatically", () => {
    expect(isAutoRetryable({ kind: "busy", retryable: true })).toBe(true);
    expect(isAutoRetryable({ kind: "unavailable", retryable: true })).toBe(true);
    expect(isAutoRetryable({ kind: "tooLarge", retryable: false })).toBe(false);
    expect(isAutoRetryable({ kind: "unknown", retryable: true })).toBe(false);
  });
});
