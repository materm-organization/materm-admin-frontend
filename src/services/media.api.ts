import axios from "axios";

import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatch, ifMatchHeaders, withEtag } from "@/lib/etag";
import { idempotencyKeyHeaders } from "@/lib/idempotency";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type {
  CreateMediaFolderPayload,
  MediaAsset,
  MediaAssetDetail,
  MediaBulkDeleteUpdated,
  MediaBulkItem,
  MediaBulkMoveUpdated,
  MediaBulkResult,
  MediaDuplicateSummary,
  MediaFolder,
  MediaListQuery,
  MediaUploadResult,
  MediaUsage,
  UpdateMediaAssetPayload,
  UpdateMediaFolderPayload,
} from "@/types/media";

// Media library (doc/05 section 11.6). Writes of an asset need `If-Match`: the detail answers `{ data, etag }`
// (`withEtag`); a LIST row has no ETag, so a caller that acts on a row builds it with `etagOfRow(row)`.
export const MediaAPI = {
  // `ids` (<= 50) can not be combined with a filter (422 `unknown_field`).
  ListAssets: async (query: MediaListQuery = {}) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<MediaAsset[]>>(API_ENDPOINTS.MEDIA.ASSETS, {
      params: query,
    });
    return data;
  },
  // Also works for a trashed row (to open the restore page).
  GetAsset: async (id: number | string) =>
    withEtag(await axiosInstance.get<ApiResponse<MediaAssetDetail>>(API_ENDPOINTS.MEDIA.ASSET(id))),
  // `If-Match` is mandatory (428 without it): `required: true` throws instead of sending a doomed request.
  UpdateAsset: async (id: number | string, payload: UpdateMediaAssetPayload, etag: string | undefined) =>
    withEtag(
      await axiosInstance.patch<ApiResponse<MediaAssetDetail>>(
        API_ENDPOINTS.MEDIA.ASSET(id),
        payload,
        ifMatch(etag, { required: true })
      )
    ),
  // Soft delete. 409 `MEDIA_IN_USE` (`details.usages`) / `ENTITY_REFERENCED` (`details.references`).
  DeleteAsset: async (id: number | string, etag: string | undefined) => {
    const { data } = await axiosInstance.delete<ApiResponse<null>>(API_ENDPOINTS.MEDIA.ASSET(id), {
      headers: ifMatchHeaders(etag, { required: true }),
    });
    return data;
  },
  // No Idempotency-Key on a restore (doc/05 11.1.5).
  RestoreAsset: async (id: number | string, etag: string | undefined) =>
    withEtag(
      await axiosInstance.post<ApiResponse<MediaAssetDetail>>(
        API_ENDPOINTS.MEDIA.ASSET_RESTORE(id),
        undefined,
        ifMatch(etag, { required: true })
      )
    ),
  ListUsages: async (id: number | string, params: { page?: number; limit?: number } = {}) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<MediaUsage[]>>(
      API_ENDPOINTS.MEDIA.ASSET_USAGES(id),
      { params }
    );
    return data;
  },
  // P2 (FR-MEDIA-01): ONE file per request, multipart field `file`, optional `folder_id`. 201 = the asset;
  // a duplicate checksum answers with the existing asset (see `parseDuplicate`) unless `allow_duplicate=true`.
  // Failures are rejected as they are (`mapUploadError` in lib/media-upload.ts); nothing here is retried.
  UploadFile: async (file: File, options: UploadOptions = {}): Promise<MediaUploadResult> => {
    const body = new FormData();
    body.append("file", file);
    if (options.folderId !== undefined && options.folderId !== null) body.append("folder_id", String(options.folderId));
    try {
      const response = await axiosInstance.post<ApiResponse<MediaAssetDetail>>(API_ENDPOINTS.MEDIA.UPLOADS, body, {
        params: options.allowDuplicate ? { allow_duplicate: true } : undefined,
        // 20 MB over a slow link: the default 30 s is too short.
        timeout: UPLOAD_TIMEOUT_MS,
        signal: options.signal,
        onUploadProgress: (event) => options.onProgress?.(event.total ? Math.min(100, Math.round((event.loaded / event.total) * 100)) : undefined),
      });
      // A 2xx other than 201 may be the duplicate warning (shape not final, see `parseDuplicate`).
      if (response.status !== 201) {
        const duplicate = parseDuplicate(response.data);
        if (duplicate) return duplicate;
      }
      return { kind: "created", asset: response.data.data, etag: withEtag(response).etag };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        const duplicate = parseDuplicate(error.response.data);
        if (duplicate && (error.response.status === 409 || error.response.status === 422)) return duplicate;
      }
      throw error;
    }
  },
  // FR-MEDIA-08: keep the id, new file. `If-Match` is mandatory (428); 409 `CONFLICT_LOCK_VERSION` = `isConflictError`.
  ReplaceFile: async (id: number | string, file: File, etag: string | undefined, options: Pick<UploadOptions, "onProgress" | "signal"> = {}) => {
    const body = new FormData();
    body.append("file", file);
    return withEtag(
      await axiosInstance.post<ApiResponse<MediaAssetDetail>>(API_ENDPOINTS.MEDIA.ASSET_FILE(id), body, {
        ...ifMatch(etag, { required: true }),
        timeout: UPLOAD_TIMEOUT_MS,
        signal: options.signal,
        onUploadProgress: (event) => options.onProgress?.(event.total ? Math.min(100, Math.round((event.loaded / event.total) * 100)) : undefined),
      })
    );
  },
  // FR-MEDIA-11. `folder_id` is REQUIRED (null = the root). <= 100 items, unique ids; no `If-Match` header.
  BulkMove: async (items: MediaBulkItem[], folderId: number | null) => {
    const { data } = await axiosInstance.post<ApiResponse<MediaBulkResult<MediaBulkMoveUpdated>>>(API_ENDPOINTS.MEDIA.BULK_MOVE, {
      items,
      folder_id: folderId,
    });
    return data.data;
  },
  BulkDelete: async (items: MediaBulkItem[]) => {
    const { data } = await axiosInstance.post<ApiResponse<MediaBulkResult<MediaBulkDeleteUpdated>>>(API_ENDPOINTS.MEDIA.BULK_DELETE, { items });
    return data.data;
  },
  // Flat, not paginated, ordered by path.
  ListFolders: async () => {
    const { data } = await axiosInstance.get<ApiResponse<MediaFolder[]>>(API_ENDPOINTS.MEDIA.FOLDERS);
    return data;
  },
  // `Idempotency-Key` is opt-in on this POST (doc/05 11.1.5): once per dialog open.
  CreateFolder: async (payload: CreateMediaFolderPayload, idempotencyKey?: string) =>
    withEtag(
      await axiosInstance.post<ApiResponse<MediaFolder>>(API_ENDPOINTS.MEDIA.FOLDERS, payload, {
        headers: idempotencyKeyHeaders(idempotencyKey),
      })
    ),
  // If-Match is optional on folders (when sent it must match): the folder's own `etag` field.
  UpdateFolder: async (id: number | string, payload: UpdateMediaFolderPayload, etag?: string) =>
    withEtag(
      await axiosInstance.patch<ApiResponse<MediaFolder>>(API_ENDPOINTS.MEDIA.FOLDER(id), payload, ifMatch(etag))
    ),
  // Only an empty folder: 409 `INVALID_STATE` (`details.reason = "folder_not_empty"`).
  DeleteFolder: async (id: number | string, etag?: string) => {
    const { data } = await axiosInstance.delete<ApiResponse<null>>(API_ENDPOINTS.MEDIA.FOLDER(id), {
      headers: ifMatchHeaders(etag),
    });
    return data;
  },
};

// The ETag of a list row. The server sends it as `etag` on the rows that carry one (categories, tags, media, menus); use it
// as is. Otherwise it is `"<updated_at>"` in UTC with the microseconds (doc/05 11.1.1 rule 1): a row's `updated_at` may be
// written with the server's own offset (`2026-10-29T13:43:36.053927+07:00`), which is NOT the ETag, so the instant is
// shifted to UTC here without touching the fraction (found by the real-backend run: DELETE /categories/{id} was a 409).
export function etagOfRow(row: Pick<MediaAsset, "updated_at"> & { etag?: string | null }): string {
  if (row.etag) return row.etag;
  return `"${toUtcMicros(row.updated_at)}"`;
}

const ISO_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
export function toUtcMicros(value: string): string {
  const m = ISO_WITH_OFFSET.exec(value);
  if (!m || m[8] === "Z") return value;
  const [, y, mo, d, h, mi, sec, fraction = "", offset] = m;
  const sign = offset.startsWith("-") ? -1 : 1;
  const offsetMinutes = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  const utc = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec)) - offsetMinutes * 60_000);
  return `${utc.toISOString().slice(0, 19)}${fraction}Z`;
}

const UPLOAD_TIMEOUT_MS = 120_000;

export type UploadOptions = {
  folderId?: number | null;
  allowDuplicate?: boolean;
  signal?: AbortSignal;
  // 0..100 (undefined when the browser does not know the total).
  onProgress?: (percent: number | undefined) => void;
};

// THE ONE PLACE that knows how the backend reports a duplicate checksum (FR-MEDIA-12). The real answer is
//   409 CONFLICT_DUPLICATE, details = { reason: "duplicate_checksum", duplicate_of: { id, public_id, original_filename, kind, mime_type, etag, url? } }
// a PARTIAL asset (`existing` is only a summary, to show the name). The older guesses are still read, returning `null` when
// the body is not a duplicate warning:
//   { details: { duplicate_of: 12 } } / { details: { existing: {...} } } / { success: true, duplicate_of: 12 } / { warnings: [...] }
export function parseDuplicate(body: unknown): Extract<MediaUploadResult, { kind: "duplicate" }> | null {
  const root = asRecord(body);
  if (!root) return null;
  const sources = [root, asRecord(root.details), asRecord(root.data), asRecord(asRecord(root.data)?.details)];
  for (const source of sources) {
    if (!source) continue;
    for (const key of ["duplicate_of", "existing_asset", "existing", "existing_asset_id", "existing_id"]) {
      const found = source[key];
      const id = toId(found);
      if (id !== null) return { kind: "duplicate", existingId: id, existing: toSummary(found) };
    }
  }
  const warnings = Array.isArray(root.warnings) ? root.warnings : [];
  for (const w of warnings) {
    const rec = asRecord(w);
    if (rec && typeof rec.code === "string" && rec.code.includes("duplicate")) {
      const id = toId(asRecord(rec.params)?.duplicate_of ?? asRecord(rec.params)?.existing_id ?? asRecord(rec.params)?.id);
      if (id !== null) return { kind: "duplicate", existingId: id, existing: null };
    }
  }
  return null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
// The duplicate's own data is only a SUMMARY (409 `CONFLICT_DUPLICATE`, `details.duplicate_of`): never treated as a full asset.
function toSummary(value: unknown): MediaDuplicateSummary | null {
  const rec = asRecord(value);
  if (!rec || typeof rec.id !== "number" || typeof rec.original_filename !== "string") return null;
  return rec as unknown as MediaDuplicateSummary;
}
function toId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  const rec = asRecord(value);
  return rec && typeof rec.id === "number" ? rec.id : null;
}
