import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatchHeaders, withEtag } from "@/lib/etag";
import { idempotencyKeyHeaders } from "@/lib/idempotency";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type {
  Collection,
  CollectionDeleteResult,
  CollectionEntriesQuery,
  CollectionEntryDeleteResult,
  CollectionEntryDetail,
  CollectionEntryListItem,
  CollectionEntryWriteResult,
  CollectionListItem,
  CollectionsQuery,
  CreateCollectionEntryPayload,
  CreateCollectionPayload,
  UpdateCollectionEntryPayload,
  UpdateCollectionPayload,
} from "@/types/collections";

// The ETag of an entry is `"<lock_version>"` (05 17.7); a list row has no ETag header, so build it from the row.
export const entryEtag = (row: { lock_version: number }) => `"${row.lock_version}"`;

const required = (etag: string | undefined) => ({ headers: ifMatchHeaders(etag, { required: true }) });

// Collection definitions and their entries (doc/05 section 17). A definition's ETag is its `etag` field (header and row); an entry's is `"<lock_version>"`.
export const CollectionsAPI = {
  List: async (query: CollectionsQuery = {}) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<CollectionListItem[]>>(API_ENDPOINTS.COLLECTIONS.LIST, { params: query });
    return data;
  },
  Get: async (key: string) => withEtag(await axiosInstance.get<ApiResponse<Collection>>(API_ENDPOINTS.COLLECTIONS.DETAIL(key))),
  // 201 + `ETag`; opt-in `Idempotency-Key`. 409 `CONFLICT_DUPLICATE` at `/key`; 422 with the schema codes.
  Create: async (payload: CreateCollectionPayload, idempotencyKey?: string) =>
    withEtag(await axiosInstance.post<ApiResponse<Collection>>(API_ENDPOINTS.COLLECTIONS.LIST, payload, { headers: idempotencyKeyHeaders(idempotencyKey) })),
  // 409 `INVALID_STATE` `details.reason` `schema_breaks_entries` | `too_many_entries_to_verify` | `trashed`.
  Update: async (key: string, payload: UpdateCollectionPayload, etag: string | undefined) =>
    withEtag(await axiosInstance.patch<ApiResponse<Collection>>(API_ENDPOINTS.COLLECTIONS.DETAIL(key), payload, required(etag))),
  // 409 `ENTITY_REFERENCED` `details.reason` `collection_has_entries` while entries outside the trash exist.
  Delete: async (key: string, etag: string | undefined) =>
    withEtag(await axiosInstance.delete<ApiResponse<CollectionDeleteResult>>(API_ENDPOINTS.COLLECTIONS.DETAIL(key), required(etag))),
  Restore: async (key: string, etag: string | undefined) =>
    withEtag(await axiosInstance.post<ApiResponse<Collection>>(API_ENDPOINTS.COLLECTIONS.RESTORE(key), undefined, required(etag))),

  // ---- entries ------------------------------------------------------------------------------------------------------------------
  Entries: async (key: string, query: CollectionEntriesQuery = {}) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<CollectionEntryListItem[]>>(API_ENDPOINTS.COLLECTIONS.ENTRIES(key), { params: query });
    return data;
  },
  Entry: async (key: string, id: number | string) => withEtag(await axiosInstance.get<ApiResponse<CollectionEntryDetail>>(API_ENDPOINTS.COLLECTIONS.ENTRY(key, id))),
  CreateEntry: async (key: string, payload: CreateCollectionEntryPayload, idempotencyKey?: string) =>
    withEtag(await axiosInstance.post<ApiResponse<CollectionEntryWriteResult>>(API_ENDPOINTS.COLLECTIONS.ENTRIES(key), payload, { headers: idempotencyKeyHeaders(idempotencyKey) })),
  UpdateEntry: async (key: string, id: number | string, payload: UpdateCollectionEntryPayload, etag: string | undefined) =>
    withEtag(await axiosInstance.patch<ApiResponse<CollectionEntryWriteResult>>(API_ENDPOINTS.COLLECTIONS.ENTRY(key, id), payload, required(etag))),
  DeleteEntry: async (key: string, id: number | string, etag: string | undefined) =>
    withEtag(await axiosInstance.delete<ApiResponse<CollectionEntryDeleteResult>>(API_ENDPOINTS.COLLECTIONS.ENTRY(key, id), required(etag))),
  RestoreEntry: async (key: string, id: number | string, etag: string | undefined) =>
    withEtag(await axiosInstance.post<ApiResponse<CollectionEntryWriteResult>>(API_ENDPOINTS.COLLECTIONS.ENTRY_RESTORE(key, id), undefined, required(etag))),
};
