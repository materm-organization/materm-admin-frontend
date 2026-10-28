import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatch, withEtag } from "@/lib/etag";
import { idempotencyKeyHeaders } from "@/lib/idempotency";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type {
  Category,
  CategoriesQuery,
  CreateCategoryPayload,
  CreateTagPayload,
  Tag,
  TagsQuery,
  UpdateCategoryPayload,
  UpdateTagPayload,
} from "@/types/taxonomy";

// Blog categories and tags (doc/05 section 11.5). A list row has no ETag: build it from `updated_at`
// (`etagOfRow`). PATCH / DELETE / restore need `If-Match` (428 without it).
export const CategoriesAPI = {
  List: async (query: CategoriesQuery = {}) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<Category[]>>(API_ENDPOINTS.CATEGORIES.LIST, { params: query });
    return data;
  },
  Get: async (id: number | string) =>
    withEtag(await axiosInstance.get<ApiResponse<Category>>(API_ENDPOINTS.CATEGORIES.DETAIL(id))),
  Create: async (payload: CreateCategoryPayload, idempotencyKey?: string) =>
    withEtag(
      await axiosInstance.post<ApiResponse<Category>>(API_ENDPOINTS.CATEGORIES.LIST, payload, {
        headers: idempotencyKeyHeaders(idempotencyKey),
      })
    ),
  Update: async (id: number | string, payload: UpdateCategoryPayload, etag: string | undefined) =>
    withEtag(
      await axiosInstance.patch<ApiResponse<Category>>(API_ENDPOINTS.CATEGORIES.DETAIL(id), payload, ifMatch(etag, { required: true }))
    ),
  // Soft delete (30 days in the trash). 409 `ENTITY_REFERENCED` while published posts use it (`details.references`).
  Delete: async (id: number | string, etag: string | undefined) => {
    const { data } = await axiosInstance.delete<ApiResponse<null>>(API_ENDPOINTS.CATEGORIES.DETAIL(id), ifMatch(etag, { required: true }));
    return data;
  },
  Restore: async (id: number | string, etag: string | undefined) =>
    withEtag(
      await axiosInstance.post<ApiResponse<Category>>(API_ENDPOINTS.CATEGORIES.RESTORE(id), undefined, ifMatch(etag, { required: true }))
    ),
};

export const TagsAPI = {
  List: async (query: TagsQuery = {}) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<Tag[]>>(API_ENDPOINTS.TAGS.LIST, { params: query });
    return data;
  },
  Get: async (id: number | string) => withEtag(await axiosInstance.get<ApiResponse<Tag>>(API_ENDPOINTS.TAGS.DETAIL(id))),
  Create: async (payload: CreateTagPayload, idempotencyKey?: string) =>
    withEtag(
      await axiosInstance.post<ApiResponse<Tag>>(API_ENDPOINTS.TAGS.LIST, payload, { headers: idempotencyKeyHeaders(idempotencyKey) })
    ),
  Update: async (id: number | string, payload: UpdateTagPayload, etag: string | undefined) =>
    withEtag(await axiosInstance.patch<ApiResponse<Tag>>(API_ENDPOINTS.TAGS.DETAIL(id), payload, ifMatch(etag, { required: true }))),
  Delete: async (id: number | string, etag: string | undefined) => {
    const { data } = await axiosInstance.delete<ApiResponse<null>>(API_ENDPOINTS.TAGS.DETAIL(id), ifMatch(etag, { required: true }));
    return data;
  },
  Restore: async (id: number | string, etag: string | undefined) =>
    withEtag(await axiosInstance.post<ApiResponse<Tag>>(API_ENDPOINTS.TAGS.RESTORE(id), undefined, ifMatch(etag, { required: true }))),
};
