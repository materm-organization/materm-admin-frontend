// Upload rules and error mapping of the media library (doc/07 section 3.22, FR-MEDIA-01/02/12). Pure (no React).
// The client checks below are a CONVENIENCE: the server decides (magic bytes, 413 / 415 / 422) and its answer wins.
import { parseApiError } from "@/lib/api-error";

export const MAX_FILES_PER_BATCH = 50;
export const UPLOAD_CONCURRENCY = 3;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_SVG_BYTES = 1024 * 1024;
// MP4 video (release 1 of video support): 50 MiB. The server allows a 51 MiB request body for the multipart framing.
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 35;
export const VIDEO_MIME = "video/mp4";
// Videos go one at a time (the server has 2 video slots for everybody; a 50 MiB body also fills the link).
export const VIDEO_CONCURRENCY = 1;

// JPEG / PNG / WebP / AVIF / GIF / PDF (<= 20 MB), MP4 (<= 50 MB) and SVG (<= 1 MB, only for `media.library:update`).
export const UPLOAD_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "application/pdf",
  "video/mp4",
] as const;
export const SVG_MIME = "image/svg+xml";

export function acceptAttribute(allowSvg: boolean): string {
  return [...UPLOAD_MIME_TYPES, ...(allowSvg ? [SVG_MIME] : [])].join(",");
}

// The file chooser of a "Replace file" dialog: a video is replaced only by a video, anything else only by a non-video.
export function replaceAcceptAttribute(kind: string | undefined, allowSvg: boolean): string {
  if (kind === "video") return VIDEO_MIME;
  return acceptAttribute(allowSvg)
    .split(",")
    .filter((mime) => mime !== VIDEO_MIME)
    .join(",");
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
  mp4: "video/mp4",
  svg: SVG_MIME,
};

export function guessMime(file: Pick<File, "name" | "type">): string {
  // An .mp4 name wins over an odd declared type (some systems say video/x-m4v or application/octet-stream).
  if (file.name.toLowerCase().endsWith(".mp4") && (!file.type || file.type.startsWith("video/") || file.type === "application/octet-stream")) return VIDEO_MIME;
  if (file.type) return file.type.toLowerCase();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME[ext] ?? "";
}

export type UploadErrorKind =
  | "unsupported" // 415 (or the client check)
  | "tooLarge" // 413 (or the client check)
  | "svgNotAllowed" // client check: SVG without `update`
  | "notAccepted" // client check: the picker only takes some kinds (e.g. images)
  | "empty"
  | "busy" // 429 / 503 with Retry-After: the upload slots are full
  | "unavailable" // 503: the file service is down or not configured
  | "forbidden"
  | "invalid" // 422 / 400
  | "videoTooLarge" // 413 max_video_bytes (or the client check): an MP4 over 50 MiB
  | "faststartRequired" // 422 /file faststart_required (or the client pre-check)
  | "durationTooLong" // 422 duration_too_long; params { seconds, max }
  | "durationLimit" // the duration is not known but over the limit; params { max }
  | "dimensionsTooLarge" // 422 dimensions_too_large; params { width, height, maxWidth, maxHeight }
  | "codecUnsupported" // 422 codec_unsupported; params { codec }
  | "bitrateTooHigh" // 422 bitrate_too_high; params { maxMbit }
  | "damaged" // 422 damaged
  | "kindMismatch" // 422 kind_mismatch on a replace: a video replaces only a video; params { expected }
  | "network"
  | "unknown";

// Does the file match a picker's `accept` list (`image/*`, `image/png`, `.png`, comma separated)? Blank = anything.
export function matchesAccept(file: Pick<File, "name" | "type">, accept: string | undefined): boolean {
  const rules = (accept ?? "").split(",").map((r) => r.trim().toLowerCase()).filter(Boolean);
  if (rules.length === 0) return true;
  const mime = guessMime(file);
  const name = file.name.toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith(".")) return name.endsWith(rule);
    if (rule.endsWith("/*")) return mime.startsWith(rule.slice(0, -1));
    return mime === rule;
  });
}

export type UploadError = {
  kind: UploadErrorKind;
  retryable: boolean;
  // Seconds from `Retry-After`, when the server sent it.
  retryAfter?: number;
  // The server's own text (only a fallback for `unknown` / `invalid`).
  message?: string;
  // Numbers / words for the i18n text of `kind` (`media.upload.errors.<kind>`); only some kinds have them.
  params?: Record<string, string | number>;
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
  if (mime === VIDEO_MIME) return file.size > MAX_VIDEO_BYTES ? { kind: "videoTooLarge", retryable: false } : null;
  return file.size > MAX_FILE_BYTES ? { kind: "tooLarge", retryable: false } : null;
}

// The i18n arguments of an error text, always complete for its kind (a missing ICU argument would throw).
export function errorTextParams(error: UploadError): Record<string, string | number> {
  const p = error.params ?? {};
  switch (error.kind) {
    case "videoTooLarge":
      return { max: `${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} MB` };
    case "durationTooLong":
      return { seconds: p.seconds ?? "?", max: p.max ?? MAX_VIDEO_SECONDS };
    case "durationLimit":
      return { max: p.max ?? MAX_VIDEO_SECONDS };
    case "dimensionsTooLarge":
      return { width: p.width ?? "?", height: p.height ?? "?", maxWidth: p.maxWidth ?? 1920, maxHeight: p.maxHeight ?? 1080 };
    case "codecUnsupported":
      return { codec: p.codec ?? "?" };
    case "bitrateTooHigh":
      return { maxMbit: p.maxMbit ?? 40 };
    default:
      return p;
  }
}

// A 422 on `/file` with one of the video codes of the backend (`pkg/mediafile/video.go`); `params` are its numbers.
function mapVideoFieldError(code: string, params: Record<string, unknown> = {}): UploadError | null {
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  switch (code) {
    case "faststart_required":
      return { kind: "faststartRequired", retryable: false };
    case "duration_too_long": {
      const ms = num(params.duration_ms);
      const max = (num(params.max_ms) ?? MAX_VIDEO_SECONDS * 1000) / 1000;
      return ms === undefined
        ? { kind: "durationLimit", retryable: false, params: { max } }
        : { kind: "durationTooLong", retryable: false, params: { seconds: (ms / 1000).toFixed(1), max } };
    }
    case "dimensions_too_large":
      return {
        kind: "dimensionsTooLarge",
        retryable: false,
        params: { width: num(params.width) ?? 0, height: num(params.height) ?? 0, maxWidth: num(params.max_width) ?? 1920, maxHeight: num(params.max_height) ?? 1080 },
      };
    case "codec_unsupported":
      return { kind: "codecUnsupported", retryable: false, params: { codec: String(params.codec ?? "?") } };
    case "bitrate_too_high":
      return { kind: "bitrateTooHigh", retryable: false, params: { maxMbit: (num(params.max_bits_per_second) ?? 40_000_000) / 1_000_000 } };
    case "damaged":
      return { kind: "damaged", retryable: false };
    case "kind_mismatch":
      return { kind: "kindMismatch", retryable: false };
    default:
      return null;
  }
}

// What an axios failure of an upload / replace means for the row. Retryable: the server may say yes later
// (429 / 503), a dropped connection too. 413 / 415 / 422 never change by retrying.
export function mapUploadError(error: unknown): UploadError {
  const parsed = parseApiError(error);
  if (parsed.isNetworkError) return { kind: "network", retryable: true };
  switch (parsed.status) {
    case 413:
      return parsed.details?.reason === "max_video_bytes"
        ? { kind: "videoTooLarge", retryable: false }
        : { kind: "tooLarge", retryable: false };
    case 415: {
      const allowed = parsed.details?.allowed;
      return {
        kind: "unsupported",
        retryable: false,
        params: Array.isArray(allowed) ? { allowed: allowed.map(String).join(", ") } : undefined,
      };
    }
    case 429:
      return { kind: "busy", retryable: true, retryAfter: parsed.retryAfter };
    case 503:
      // The video slots (2) or the general slots are full: the server says so and sends Retry-After: 3.
      if (parsed.details?.reason === "upload_slots_busy") return { kind: "busy", retryable: true, retryAfter: parsed.retryAfter ?? 3 };
      // With a `Retry-After` the server is only full; without it the file service is down / not configured.
      return parsed.retryAfter !== undefined
        ? { kind: "busy", retryable: true, retryAfter: parsed.retryAfter }
        : { kind: "unavailable", retryable: true };
    case 403:
      return { kind: "forbidden", retryable: false };
    case 400:
    case 422: {
      const fe = parsed.fieldErrors.find((e) => e.path === "/file" && mapVideoFieldError(e.code, e.params) !== null);
      const video = fe ? mapVideoFieldError(fe.code, fe.params) : null;
      if (video) return video;
      return { kind: "invalid", retryable: false, message: parsed.message };
    }
    default:
      return { kind: "unknown", retryable: (parsed.status ?? 0) >= 500, message: parsed.message };
  }
}

// 429 / 503 are retried by the queue itself (a few times), everything else waits for the user's "Retry".
export function isAutoRetryable(error: UploadError): boolean {
  return error.kind === "busy" || error.kind === "unavailable";
}
