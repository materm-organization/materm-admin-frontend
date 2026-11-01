// Mock of the P2 upload endpoints (the backend is built in parallel; this is the CONTRACT the UI codes against):
//   POST /media/uploads        multipart, ONE part `file` (+ optional `folder_id`), `?allow_duplicate=true`
//   POST /media/{id}/file      multipart, ONE part `file`, `If-Match` required
// Strict like the rest of the mock (unknown query / form fields are 422 `unknown_field`, no `If-Match` is 428, a stale
// one 409), the type is decided by MAGIC BYTES (415) and the size by the type (413). A duplicate checksum answers
// 409 `DUPLICATE_MEDIA` with `details.duplicate_of` = the existing asset: that shape is an ASSUMPTION (not final in the
// backend), `parseDuplicate` in services/media.api.ts is the only code that reads it.
import { MOCK_USER, fail, etagOf, requireIfMatch, tick, validationFailed, type MockDb } from "@/mocks/mock-core";
import { findAsset, recomputeFolders, tileUrl, toListRow } from "@/mocks/mock-db";
import type { ApiFieldError } from "@/types/api";
import type { MediaAssetDetail, MediaKind } from "@/types/media";

export const MOCK_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MOCK_MAX_SVG_BYTES = 1024 * 1024;

export type SniffedFile = { mime: string; kind: MediaKind };

// Magic bytes of the allowed types (FR-MEDIA-02); `null` = not allowed (415).
export function sniff(bytes: Uint8Array): SniffedFile | null {
  const at = (i: number, text: string) => [...text].every((c, k) => bytes[i + k] === c.charCodeAt(0));
  if (bytes[0] === 0x89 && at(1, "PNG")) return { mime: "image/png", kind: "image" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", kind: "image" };
  if (at(0, "GIF8")) return { mime: "image/gif", kind: "image" };
  if (at(0, "RIFF") && at(8, "WEBP")) return { mime: "image/webp", kind: "image" };
  if (at(4, "ftyp") && (at(8, "avif") || at(8, "avis"))) return { mime: "image/avif", kind: "image" };
  if (at(0, "%PDF")) return { mime: "application/pdf", kind: "document" };
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

// Type by magic bytes, size by type, checksum.
async function inspect(file: UploadedFile) {
  const sniffed = sniff(file.bytes);
  if (!sniffed) throw fail(415, "UNSUPPORTED_MEDIA_TYPE", "This file type is not allowed.");
  const limit = sniffed.mime === "image/svg+xml" ? MOCK_MAX_SVG_BYTES : MOCK_MAX_FILE_BYTES;
  if (file.bytes.byteLength > limit) throw fail(413, "PAYLOAD_TOO_LARGE", "The file is too large.", { details: { max_bytes: limit } });
  return { sniffed, bytes: file.bytes.byteLength, checksum: await sha256(file.bytes) };
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
  const { sniffed, bytes, checksum } = await inspect(file);

  const existing = db.assets.find((a) => !a.deleted_at && a.checksum_sha256 === checksum);
  if (existing && !allowDuplicate) {
    throw fail(409, "DUPLICATE_MEDIA", "A file with the same content already exists.", { details: { duplicate_of: toListRow(existing) } });
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
    width: null,
    height: null,
    duration_ms: null,
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
  const { sniffed, bytes, checksum } = await inspect(file);

  const stamp = tick(db);
  asset.original_filename = file.name;
  asset.mime_type = sniffed.mime;
  asset.kind = sniffed.kind;
  asset.bytes = bytes;
  asset.checksum_sha256 = checksum;
  asset.url = tileUrl(asset.id, `${file.name} v2`);
  asset.updated_at = stamp;
  asset.updated_by = MOCK_USER;
  return { asset, etag: etagOf(asset.updated_at) };
}
