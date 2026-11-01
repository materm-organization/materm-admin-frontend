// Upload rules and error mapping of the media library (doc/07 section 3.22, FR-MEDIA-01/02/12). Pure (no React).
// The client checks below are a CONVENIENCE: the server decides (magic bytes, 413 / 415 / 422) and its answer wins.
import { parseApiError } from "@/lib/api-error";

export const MAX_FILES_PER_BATCH = 50;
export const UPLOAD_CONCURRENCY = 3;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_SVG_BYTES = 1024 * 1024;

// JPEG / PNG / WebP / AVIF / GIF / PDF (<= 20 MB) and SVG (<= 1 MB, only for `media.library:update`).
export const UPLOAD_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "application/pdf",
] as const;
export const SVG_MIME = "image/svg+xml";

export function acceptAttribute(allowSvg: boolean): string {
  return [...UPLOAD_MIME_TYPES, ...(allowSvg ? [SVG_MIME] : [])].join(",");
}

// The browser's `file.type` comes from the extension; an empty one falls back to the extension itself.
const EXTENSION_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  pdf: "application/pdf",
  svg: SVG_MIME,
};

export function guessMime(file: Pick<File, "name" | "type">): string {
  if (file.type) return file.type.toLowerCase();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME[ext] ?? "";
}

export type UploadErrorKind =
  | "unsupported" // 415 (or the client check)
  | "tooLarge" // 413 (or the client check)
  | "svgNotAllowed" // client check: SVG without `update`
  | "empty"
  | "busy" // 429 / 503 with Retry-After: the upload slots are full
  | "unavailable" // 503: the file service is down or not configured
  | "forbidden"
  | "invalid" // 422 / 400
  | "network"
  | "unknown";

export type UploadError = {
  kind: UploadErrorKind;
  retryable: boolean;
  // Seconds from `Retry-After`, when the server sent it.
  retryAfter?: number;
  // The server's own text (only a fallback for `unknown` / `invalid`).
  message?: string;
};

// The convenience check before sending: `null` = looks fine.
export function checkFile(file: Pick<File, "name" | "type" | "size">, options: { allowSvg: boolean }): UploadError | null {
  if (file.size === 0) return { kind: "empty", retryable: false };
  const mime = guessMime(file);
  if (mime === SVG_MIME) {
    if (!options.allowSvg) return { kind: "svgNotAllowed", retryable: false };
    return file.size > MAX_SVG_BYTES ? { kind: "tooLarge", retryable: false } : null;
  }
  if (!(UPLOAD_MIME_TYPES as readonly string[]).includes(mime)) return { kind: "unsupported", retryable: false };
  return file.size > MAX_FILE_BYTES ? { kind: "tooLarge", retryable: false } : null;
}

// What an axios failure of an upload / replace means for the row. Retryable: the server may say yes later
// (429 / 503), a dropped connection too. 413 / 415 / 422 never change by retrying.
export function mapUploadError(error: unknown): UploadError {
  const parsed = parseApiError(error);
  if (parsed.isNetworkError) return { kind: "network", retryable: true };
  switch (parsed.status) {
    case 413:
      return { kind: "tooLarge", retryable: false };
    case 415:
      return { kind: "unsupported", retryable: false };
    case 429:
      return { kind: "busy", retryable: true, retryAfter: parsed.retryAfter };
    case 503:
      // With a `Retry-After` the server is only full; without it the file service is down / not configured.
      return parsed.retryAfter !== undefined
        ? { kind: "busy", retryable: true, retryAfter: parsed.retryAfter }
        : { kind: "unavailable", retryable: true };
    case 403:
      return { kind: "forbidden", retryable: false };
    case 400:
    case 422:
      return { kind: "invalid", retryable: false, message: parsed.message };
    default:
      return { kind: "unknown", retryable: (parsed.status ?? 0) >= 500, message: parsed.message };
  }
}

// 429 / 503 are retried by the queue itself (a few times), everything else waits for the user's "Retry".
export function isAutoRetryable(error: UploadError): boolean {
  return error.kind === "busy" || error.kind === "unavailable";
}
