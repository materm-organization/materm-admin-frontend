import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatchHeaders, withEtag } from "@/lib/etag";
import { idempotencyKeyHeaders } from "@/lib/idempotency";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type {
  AlbumDeleteResult,
  AlbumDetail,
  AlbumItem,
  AlbumItemDeleteResult,
  AlbumItemWriteResult,
  AlbumItemsCreateResult,
  AlbumListItem,
  AlbumOrderResult,
  AlbumWriteResult,
  AlbumsQuery,
  CreateAlbumItemsPayload,
  CreateAlbumPayload,
  UpdateAlbumItemPayload,
  UpdateAlbumPayload,
} from "@/types/albums";

// The ETag of an album is `"<lock_version>"` (doc/05 13.4); a list row has no ETag header, so build it from the row.
export const albumEtag = (row: { lock_version: number }) => `"${row.lock_version}"`;

const required = (etag: string | undefined) => ({ headers: ifMatchHeaders(etag, { required: true }) });

// Albums (doc/05 section 13.4). Every write sends `If-Match` = the ETag of the ALBUM (also the item commands); the answer carries the new one.
export const AlbumsAPI = {
  List: async (query: AlbumsQuery = {}) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<AlbumListItem[]>>(API_ENDPOINTS.ALBUMS.LIST, { params: query });
    return data;
  },
  Get: async (id: number | string) => withEtag(await axiosInstance.get<ApiResponse<AlbumDetail>>(API_ENDPOINTS.ALBUMS.DETAIL(id))),
  // 201 + `ETag: "1"`; opt-in `Idempotency-Key`. 409 `CONFLICT_DUPLICATE` at `/key`.
  Create: async (payload: CreateAlbumPayload, idempotencyKey?: string) =>
    withEtag(await axiosInstance.post<ApiResponse<AlbumWriteResult>>(API_ENDPOINTS.ALBUMS.LIST, payload, { headers: idempotencyKeyHeaders(idempotencyKey) })),
  Update: async (id: number | string, payload: UpdateAlbumPayload, etag: string | undefined) =>
    withEtag(await axiosInstance.patch<ApiResponse<AlbumWriteResult>>(API_ENDPOINTS.ALBUMS.DETAIL(id), payload, required(etag))),
  // 409 `ENTITY_REFERENCED` while a section uses the album (no `confirm_references`, BR-19).
  Delete: async (id: number | string, etag: string | undefined) =>
    withEtag(await axiosInstance.delete<ApiResponse<AlbumDeleteResult>>(API_ENDPOINTS.ALBUMS.DETAIL(id), required(etag))),
  Restore: async (id: number | string, etag: string | undefined) =>
    withEtag(await axiosInstance.post<ApiResponse<AlbumWriteResult>>(API_ENDPOINTS.ALBUMS.RESTORE(id), undefined, required(etag))),

  // ---- items (not paginated, <= 200) ---------------------------------------------------------------------------------
  Items: async (id: number | string) => withEtag(await axiosInstance.get<ApiResponse<AlbumItem[]>>(API_ENDPOINTS.ALBUMS.ITEMS(id))),
  CreateItems: async (id: number | string, payload: CreateAlbumItemsPayload, etag: string | undefined, idempotencyKey?: string) =>
    withEtag(
      await axiosInstance.post<ApiResponse<AlbumItemsCreateResult>>(API_ENDPOINTS.ALBUMS.ITEMS(id), payload, {
        headers: { ...ifMatchHeaders(etag, { required: true }), ...idempotencyKeyHeaders(idempotencyKey) },
      })
    ),
  UpdateItem: async (id: number | string, itemId: number | string, payload: UpdateAlbumItemPayload, etag: string | undefined) =>
    withEtag(await axiosInstance.patch<ApiResponse<AlbumItemWriteResult>>(API_ENDPOINTS.ALBUMS.ITEM(id, itemId), payload, required(etag))),
  // 409 `ENTITY_REFERENCED` while a `photo_story` slot uses the picture; nothing confirms it.
  DeleteItem: async (id: number | string, itemId: number | string, etag: string | undefined) =>
    withEtag(await axiosInstance.delete<ApiResponse<AlbumItemDeleteResult>>(API_ENDPOINTS.ALBUMS.ITEM(id, itemId), required(etag))),
  // The WHOLE set of ids in the new order.
  ReorderItems: async (id: number | string, itemIds: number[], etag: string | undefined) =>
    withEtag(await axiosInstance.put<ApiResponse<AlbumOrderResult>>(API_ENDPOINTS.ALBUMS.ITEMS_ORDER(id), { items: itemIds.map((itemId) => ({ id: itemId })) }, required(etag))),
};
