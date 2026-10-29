import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatch, ifMatchHeaders, withEtag } from "@/lib/etag";
import { idempotencyKeyHeaders } from "@/lib/idempotency";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type {
  CreateMediaFolderPayload,
  MediaAsset,
  MediaAssetDetail,
  MediaFolder,
  MediaListQuery,
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
