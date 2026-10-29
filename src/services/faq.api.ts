import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatchHeaders, withEtag } from "@/lib/etag";
import { idempotencyKeyHeaders } from "@/lib/idempotency";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type {
  CreateFaqGroupPayload,
  CreateFaqItemPayload,
  FaqGroupDeleteResult,
  FaqGroupDetail,
  FaqGroupListItem,
  FaqGroupWriteResult,
  FaqGroupsQuery,
  FaqItem,
  FaqItemDeleteResult,
  FaqItemWriteResult,
  FaqOrderResult,
  UpdateFaqGroupPayload,
  UpdateFaqItemPayload,
} from "@/types/faq";

// The ETag of a group is `"<lock_version>"` (doc/05 13.5); a list row has no ETag header, so build it from the row.
export const faqGroupEtag = (row: { lock_version: number }) => `"${row.lock_version}"`;

const required = (etag: string | undefined) => ({ headers: ifMatchHeaders(etag, { required: true }) });

// FAQ groups (doc/05 section 13.5). Every write sends `If-Match` = the ETag of the GROUP (also the item commands).
export const FaqAPI = {
  List: async (query: FaqGroupsQuery = {}) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<FaqGroupListItem[]>>(API_ENDPOINTS.FAQ_GROUPS.LIST, { params: query });
    return data;
  },
  Get: async (id: number | string) => withEtag(await axiosInstance.get<ApiResponse<FaqGroupDetail>>(API_ENDPOINTS.FAQ_GROUPS.DETAIL(id))),
  Create: async (payload: CreateFaqGroupPayload, idempotencyKey?: string) =>
    withEtag(await axiosInstance.post<ApiResponse<FaqGroupWriteResult>>(API_ENDPOINTS.FAQ_GROUPS.LIST, payload, { headers: idempotencyKeyHeaders(idempotencyKey) })),
  Update: async (id: number | string, payload: UpdateFaqGroupPayload, etag: string | undefined) =>
    withEtag(await axiosInstance.patch<ApiResponse<FaqGroupWriteResult>>(API_ENDPOINTS.FAQ_GROUPS.DETAIL(id), payload, required(etag))),
  // 409 `ENTITY_REFERENCED` while a `faq` section names the group's key (no `confirm_references`).
  Delete: async (id: number | string, etag: string | undefined) =>
    withEtag(await axiosInstance.delete<ApiResponse<FaqGroupDeleteResult>>(API_ENDPOINTS.FAQ_GROUPS.DETAIL(id), required(etag))),
  Restore: async (id: number | string, etag: string | undefined) =>
    withEtag(await axiosInstance.post<ApiResponse<FaqGroupWriteResult>>(API_ENDPOINTS.FAQ_GROUPS.RESTORE(id), undefined, required(etag))),

  Items: async (id: number | string) => withEtag(await axiosInstance.get<ApiResponse<FaqItem[]>>(API_ENDPOINTS.FAQ_GROUPS.ITEMS(id))),
  CreateItem: async (id: number | string, payload: CreateFaqItemPayload, etag: string | undefined, idempotencyKey?: string) =>
    withEtag(
      await axiosInstance.post<ApiResponse<FaqItemWriteResult>>(API_ENDPOINTS.FAQ_GROUPS.ITEMS(id), payload, {
        headers: { ...ifMatchHeaders(etag, { required: true }), ...idempotencyKeyHeaders(idempotencyKey) },
      })
    ),
  UpdateItem: async (id: number | string, itemId: number | string, payload: UpdateFaqItemPayload, etag: string | undefined) =>
    withEtag(await axiosInstance.patch<ApiResponse<FaqItemWriteResult>>(API_ENDPOINTS.FAQ_GROUPS.ITEM(id, itemId), payload, required(etag))),
  DeleteItem: async (id: number | string, itemId: number | string, etag: string | undefined) =>
    withEtag(await axiosInstance.delete<ApiResponse<FaqItemDeleteResult>>(API_ENDPOINTS.FAQ_GROUPS.ITEM(id, itemId), required(etag))),
  ReorderItems: async (id: number | string, itemIds: number[], etag: string | undefined) =>
    withEtag(await axiosInstance.put<ApiResponse<FaqOrderResult>>(API_ENDPOINTS.FAQ_GROUPS.ITEMS_ORDER(id), { items: itemIds.map((itemId) => ({ id: itemId })) }, required(etag))),
};
