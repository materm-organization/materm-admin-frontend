// Mock of the P2 upload endpoints (the backend is built in parallel; this is the CONTRACT the UI codes against):
//   POST /media/uploads        multipart, ONE part `file` (+ optional `folder_id`), `?allow_duplicate=true`
//   POST /media/assets/{id}/file     multipart, ONE part `file`, `If-Match` required
// Strict like the rest of the mock (unknown query / form fields are 422 `unknown_field`, no `If-Match` is 428, a stale
// one 409), the type is decided by MAGIC BYTES (415) and the size by the type (413). A duplicate checksum answers
// 409 `CONFLICT_DUPLICATE`, `details = { reason: "duplicate_checksum", duplicate_of: { id, public_id, original_filename, kind,
// mime_type, etag, url } }` = the REAL shape, a partial asset; `parseDuplicate` in services/media.api.ts is the only code that reads it.
import { MOCK_USER, fail, etagOf, requireIfMatch, tick, validationFailed, type MockDb } from "@/mocks/mock-core";
import { findAsset, recomputeFolders, tileUrl } from "@/mocks/mock-db";
import type { ApiFieldError } from "@/types/api";
import type { MediaAssetDetail, MediaKind } from "@/types/media";

export const MOCK_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MOCK_MAX_SVG_BYTES = 1024 * 1024;
// Video support, release 1 (admin backend b307bed, pkg/mediafile/video.go): MP4 only, 50 MiB, 35 s, 1920x1080, 40 Mbit/s.
export const MOCK_MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MOCK_MAX_VIDEO_MS = 35_000;
export const MOCK_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif", "image/svg+xml", "application/pdf", "video/mp4"];

// Knob for tests: the next `n` uploads answer 503 `upload_slots_busy` with `Retry-After: 3` (the two video slots are taken).
let slotsBusy = 0;
export function setUploadSlotsBusy(n: number) {
  slotsBusy = n;
}

export type SniffedFile = { mime: string; kind: MediaKind };

const VIDEO_BRANDS = ["isom", "iso2", "mp41", "mp42", "avc1", "M4V "];
const ascii = (b: Uint8Array, i: number, n = 4) => String.fromCharCode(...b.slice(i, i + n));
// ftyp first, a video major brand, and no AVIF brand anywhere (AVIF is its own type).
function isMp4(b: Uint8Array): boolean {
  if (b.length < 16 || ascii(b, 4) !== "ftyp") return false;
  const size = new DataView(b.buffer, b.byteOffset).getUint32(0);
  if (size < 16 || size > b.length || (size - 16) % 4 !== 0 || !VIDEO_BRANDS.includes(ascii(b, 8))) return false;
  for (let i = 16; i + 4 <= size; i += 4) if (["avif", "avis"].includes(ascii(b, i))) return false;
  return true;
}

type Box = { type: string; start: number; end: number };
function boxesOf(b: Uint8Array, from: number, to: number, strict: boolean): Box[] | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Box[] = [];
  let off = from;
  while (off < to) {
    if (to - off < 8) return strict ? null : out;
    let size = dv.getUint32(off);
    let header = 8;
    if (size === 1) {
      size = Number(dv.getBigUint64(off + 8));
      header = 16;
    } else if (size === 0) size = to - off;
    if (size < header || off + size > to) return null;
    out.push({ type: ascii(b, off + 4), start: off + header, end: off + size });
    off += size;
  }
  return out;
}

export type MockMp4 = { durationMs: number; width: number; height: number };
// The 422 of a refused MP4, as the real server words it (`errors[0] = {in:"body", path:"/file", code, message, params}`).
function videoRefusal(code: string, message: string, params?: Record<string, string | number>) {
  return validationFailed([{ in: "body", path: "/file", code, message, params }]);
}
const damaged = (why: string) => videoRefusal("damaged", `The video file is damaged or is not a plain MP4 (${why}).`);

// The rules of `inspectMP4` in the same order: structure, fast start, codec (inside the tracks), dimensions, duration, bit rate.
export function inspectMp4(b: Uint8Array): MockMp4 {
  const top = boxesOf(b, 0, b.length, true);
  if (!top) throw damaged("boxes do not add up to the file");
  const moovs = top.filter((t) => t.type === "moov");
  const mdatAt = top.findIndex((t) => t.type === "mdat");
  if (moovs.length !== 1) throw damaged(`${moovs.length} moov boxes, expected 1`);
  if (mdatAt < 0) throw damaged("no mdat box (no media data)");
  if (mdatAt < top.findIndex((t) => t.type === "moov")) {
    throw videoRefusal(
      "faststart_required",
      "The video index (moov) is after the video data, so it cannot start playing before it is fully downloaded. Export the video again with fast start enabled (for example ffmpeg -movflags +faststart)."
    );
  }
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const moov = boxesOf(b, moovs[0].start, moovs[0].end, false) ?? [];
  let durationMs = 0;
  let size: { width: number; height: number } | null = null;
  for (const m of moov) {
    if (m.type === "mvhd") {
      const v = b[m.start];
      const ts = dv.getUint32(m.start + (v === 1 ? 20 : 12));
      const dur = v === 1 ? Number(dv.getBigUint64(m.start + 24)) : dv.getUint32(m.start + 16);
      if (!ts || !dur) throw damaged("no duration");
      durationMs = Math.ceil((dur * 1000) / ts);
      if (durationMs > MOCK_MAX_VIDEO_MS) {
        throw videoRefusal("duration_too_long", `The video is ${(durationMs / 1000).toFixed(1)} seconds long; at most 35 seconds is accepted.`, { duration_ms: durationMs, max_ms: MOCK_MAX_VIDEO_MS });
      }
    } else if (m.type === "trak" && !size) {
      const kids = boxesOf(b, m.start, m.end, false) ?? [];
      const mdia = kids.find((k) => k.type === "mdia");
      const hdlr = mdia ? (boxesOf(b, mdia.start, mdia.end, false) ?? []).find((k) => k.type === "hdlr") : undefined;
      if (!hdlr || ascii(b, hdlr.start + 8) !== "vide") continue;
      const tkhd = kids.find((k) => k.type === "tkhd");
      if (!tkhd) throw damaged("video track without tkhd");
      const v = b[tkhd.start];
      const wAt = tkhd.start + (v === 1 ? 88 : 76);
      let width = dv.getUint32(wAt) >>> 16;
      let height = dv.getUint32(wAt + 4) >>> 16;
      const mat = tkhd.start + (v === 1 ? 52 : 40);
      if (dv.getUint32(mat) === 0 && dv.getUint32(mat + 16) === 0 && dv.getUint32(mat + 4) !== 0 && dv.getUint32(mat + 12) !== 0) [width, height] = [height, width];
      const mdiaKids = boxesOf(b, mdia!.start, mdia!.end, false) ?? [];
      const minf = mdiaKids.find((k) => k.type === "minf");
      const stbl = minf ? (boxesOf(b, minf.start, minf.end, false) ?? []).find((k) => k.type === "stbl") : undefined;
      const stsd = stbl ? (boxesOf(b, stbl.start, stbl.end, false) ?? []).find((k) => k.type === "stsd") : undefined;
      if (!stsd) throw damaged("video track without a sample description");
      const codec = ascii(b, stsd.start + 12);
      if (codec !== "avc1" && codec !== "avc3") {
        throw videoRefusal("codec_unsupported", `The video codec "${codec}" is not supported; export it as H.264 (AVC) in an MP4 file.`, { codec });
      }
      size = { width, height };
    }
  }
  if (!durationMs) throw damaged("no mvhd box");
  if (!size) throw damaged("no video track");
  if (size.width > 1920 || size.height > 1080) {
    throw videoRefusal("dimensions_too_large", `The video is ${size.width}x${size.height} pixels; at most 1920x1080 is accepted.`, { width: size.width, height: size.height, max_width: 1920, max_height: 1080 });
  }
  if (b.length * 8000 > 40_000_000 * durationMs) {
    throw videoRefusal("bitrate_too_high", "The video bit rate is above 40 Mbit/s. Export it again with a lower bit rate.", { max_bits_per_second: 40_000_000 });
  }
  return { durationMs, ...size };
}

// Magic bytes of the allowed types (FR-MEDIA-02); `null` = not allowed (415).
export function sniff(bytes: Uint8Array): SniffedFile | null {
  const at = (i: number, text: string) => [...text].every((c, k) => bytes[i + k] === c.charCodeAt(0));
  if (bytes[0] === 0x89 && at(1, "PNG")) return { mime: "image/png", kind: "image" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", kind: "image" };
  if (at(0, "GIF8")) return { mime: "image/gif", kind: "image" };
  if (at(0, "RIFF") && at(8, "WEBP")) return { mime: "image/webp", kind: "image" };
  if (at(4, "ftyp") && (at(8, "avif") || at(8, "avis"))) return { mime: "image/avif", kind: "image" };
  if (at(0, "%PDF")) return { mime: "application/pdf", kind: "document" };
  if (isMp4(bytes)) return { mime: "video/mp4", kind: "video" };
  const head = new TextDecoder().decode(bytes.slice(0, 512)).toLowerCase();
  if (head.includes("<svg")) return { mime: "image/svg+xml", kind: "brand" };
  return null;
}

// A multipart part: the file keeps its bytes, the other parts are text.
export type UploadedFile = { name: string; type: string; bytes: Uint8Array };

// Parses the multipart body BY HAND from the raw bytes. `request.formData()` is not usable here: under jsdom the
// File class differs from undici's and it throws; this also behaves the same in the browser mock.
export function parseMultipart(body: Uint8Array, contentType: string | null): Array<{ name: string; filename?: string; type?: string; bytes: Uint8Array }> {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "")?.[1] ?? /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "")?.[2];
  if (!contentType?.toLowerCase().startsWith("multipart/form-data") || !boundary) throw fail(400, "BAD_REQUEST", "Malformed multipart body.");
  const enc = new TextEncoder();
  const delimiter = enc.encode(`--${boundary}`);
  const indexOf = (hay: Uint8Array, needle: Uint8Array, from: number) => {
    outer: for (let i = from; i <= hay.length - needle.length; i += 1) {
      for (let k = 0; k < needle.length; k += 1) if (hay[i + k] !== needle[k]) continue outer;
      return i;
    }
    return -1;
  };
  const parts: Array<{ name: string; filename?: string; type?: string; bytes: Uint8Array }> = [];
  let pos = indexOf(body, delimiter, 0);
  while (pos !== -1) {
    const start = pos + delimiter.length;
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break; // closing delimiter
    const next = indexOf(body, delimiter, start);
    if (next === -1) throw fail(400, "BAD_REQUEST", "Malformed multipart body.");
    // part = CRLF headers CRLF CRLF data CRLF
    const part = body.slice(start + 2, next - 2);
    const split = indexOf(part, enc.encode("\r\n\r\n"), 0);
    if (split === -1) throw fail(400, "BAD_REQUEST", "Malformed multipart body.");
    const headers = new TextDecoder().decode(part.slice(0, split));
    const disposition = /content-disposition:[^\r\n]*/i.exec(headers)?.[0] ?? "";
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
    if (name === undefined) throw fail(400, "BAD_REQUEST", "Malformed multipart body.");
    parts.push({
      name,
      filename: /filename="([^"]*)"/i.exec(disposition)?.[1],
      type: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim(),
      bytes: part.slice(split + 4),
    });
    pos = next;
  }
  return parts;
}

// Reads the body strictly: exactly one `file` part, nothing but `allowedFields` (text) besides.
export async function parseUploadForm(request: Request, allowedFields: readonly string[]): Promise<{ file: UploadedFile; fields: Record<string, string> }> {
  const parts = parseMultipart(new Uint8Array(await request.arrayBuffer()), request.headers.get("content-type"));
  const errors: ApiFieldError[] = [];
  const fields: Record<string, string> = {};
  let file: UploadedFile | null = null;
  for (const part of parts) {
    if (part.name === "file" && part.filename !== undefined) {
      if (file) errors.push({ in: "body", path: "/file", code: "too_many" });
      file = { name: part.filename, type: part.type ?? "", bytes: part.bytes };
    } else if (allowedFields.includes(part.name) && part.filename === undefined) {
      fields[part.name] = new TextDecoder().decode(part.bytes);
    } else {
      errors.push({ in: "body", path: `/${part.name}`, code: "unknown_field" });
    }
  }
  if (!file) errors.push({ in: "body", path: "/file", code: "required" });
  if (errors.length > 0) throw validationFailed(errors);
  return { file: file as UploadedFile, fields };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const tooLarge = (reason: string) =>
  fail(413, "PAYLOAD_TOO_LARGE", "The file is larger than the library accepts.", {
    details: { reason, max_bytes: MOCK_MAX_FILE_BYTES, max_svg_bytes: MOCK_MAX_SVG_BYTES, max_video_bytes: MOCK_MAX_VIDEO_BYTES, max_megapixels: 40 },
  });

// Slots, type by magic bytes, size by type, the MP4 rules, checksum. The order of the real service: a file part over 50 MiB is
// refused first (`max_video_bytes`, whatever it is), then the sniff (415), then the limit of the sniffed type, then the MP4 rules.
async function inspect(file: UploadedFile) {
  if (file.bytes.byteLength > MOCK_MAX_VIDEO_BYTES) throw tooLarge("max_video_bytes");
  if (slotsBusy > 0 && isMp4(file.bytes)) {
    slotsBusy -= 1;
    throw fail(503, "SERVICE_UNAVAILABLE", "The server is busy. Try again in a moment.", { details: { reason: "upload_slots_busy" } }, { "Retry-After": "3" });
  }
  const sniffed = sniff(file.bytes);
  if (!sniffed) throw fail(415, "UNSUPPORTED_MEDIA_TYPE", "The file type is not allowed or the file is damaged.", { details: { reason: "unsupported", allowed: MOCK_ALLOWED_MIME } });
  const limit = sniffed.mime === "image/svg+xml" ? MOCK_MAX_SVG_BYTES : sniffed.mime === "video/mp4" ? MOCK_MAX_VIDEO_BYTES : MOCK_MAX_FILE_BYTES;
  if (file.bytes.byteLength > limit) throw tooLarge(sniffed.mime === "video/mp4" ? "max_video_bytes" : "file too large");
  const video = sniffed.mime === "video/mp4" ? inspectMp4(file.bytes) : null;
  return { sniffed, bytes: file.bytes.byteLength, checksum: await sha256(file.bytes), video };
}

function newPublicId(n: number) {
  return `0192d3a4-7c1e-7b52-9d0a-${String(n).padStart(12, "0")}`;
}

export async function uploadAsset(db: MockDb, request: Request) {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (key !== "allow_duplicate") throw validationFailed([{ in: "query", path: key, code: "unknown_field" }]);
  }
  const allowDuplicate = params.get("allow_duplicate") === "true";
  const { file, fields } = await parseUploadForm(request, ["folder_id"]);

  let folderId: number | null = null;
  if (fields.folder_id !== undefined) {
    folderId = /^\d+$/.test(fields.folder_id) ? Number(fields.folder_id) : NaN;
    if (Number.isNaN(folderId) || !db.folders.some((f) => f.id === folderId)) {
      throw validationFailed([{ in: "body", path: "/folder_id", code: "unknown_reference" }]);
    }
  }
  const { sniffed, bytes, checksum, video } = await inspect(file);

  const existing = db.assets.find((a) => !a.deleted_at && a.checksum_sha256 === checksum);
  if (existing && !allowDuplicate) {
    // The real shape (admin backend): a PARTIAL asset, not the detail.
    const duplicateOf = { id: existing.id, public_id: existing.public_id, original_filename: existing.original_filename, kind: existing.kind, mime_type: existing.mime_type, etag: etagOf(existing.updated_at), url: existing.url };
    throw fail(409, "CONFLICT_DUPLICATE", "A file with the same content already exists.", { details: { reason: "duplicate_checksum", duplicate_of: duplicateOf } });
  }

  const id = Math.max(0, ...db.assets.map((a) => a.id)) + 1;
  const now = tick(db);
  const asset: MediaAssetDetail = {
    id,
    public_id: newPublicId(id),
    folder_id: folderId,
    kind: sniffed.kind,
    status: "ready",
    error_message: null,
    source: "file_service",
    original_filename: file.name,
    mime_type: sniffed.mime,
    bytes,
    width: video?.width ?? null,
    height: video?.height ?? null,
    duration_ms: video?.durationMs ?? null,
    focal: null,
    is_decorative: false,
    dominant_color: null,
    blurhash: null,
    checksum_sha256: checksum,
    url: tileUrl(id, file.name),
    translations: {},
    usage_count: 0,
    created_by: MOCK_USER,
    updated_by: MOCK_USER,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    purge_at: null,
    folder: null,
    variants: [],
  };
  db.assets.push(asset);
  recomputeFolders(db);
  return { asset, etag: etagOf(asset.updated_at) };
}

export async function replaceAssetFile(db: MockDb, id: string, request: Request) {
  const asset = findAsset(db, id);
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) throw validationFailed([{ in: "query", path: key, code: "unknown_field" }]);
  requireIfMatch(request.headers.get("If-Match"), etagOf(asset.updated_at));
  const { file } = await parseUploadForm(request, []);
  if (asset.deleted_at) throw fail(409, "INVALID_STATE", "The file is in the trash.", { details: { reason: "trashed" } });
  const { sniffed, bytes, checksum, video } = await inspect(file);
  // A video replaces only a video (and the reverse): 422 at /file with the kind the row expects.
  if ((sniffed.kind === "video") !== (asset.kind === "video")) {
    throw validationFailed([{ in: "body", path: "/file", code: "kind_mismatch", params: { expected_kind: asset.kind } }]);
  }

  const stamp = tick(db);
  asset.original_filename = file.name;
  asset.mime_type = sniffed.mime;
  asset.kind = sniffed.kind;
  asset.bytes = bytes;
  asset.width = video?.width ?? asset.width;
  asset.height = video?.height ?? asset.height;
  asset.duration_ms = video ? video.durationMs : asset.duration_ms;
  asset.checksum_sha256 = checksum;
  asset.url = tileUrl(asset.id, `${file.name} v2`);
  asset.updated_at = stamp;
  asset.updated_by = MOCK_USER;
  return { asset, etag: etagOf(asset.updated_at) };
}
