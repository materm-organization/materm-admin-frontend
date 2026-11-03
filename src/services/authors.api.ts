import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatch, withEtag } from "@/lib/etag";
import { idempotencyKeyHeaders } from "@/lib/idempotency";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type { Author, AuthorsQuery, CreateAuthorPayload, UpdateAuthorPayload } from "@/types/authors";

// Authors (doc/05 section 15). A list row has no ETag header: `etagOfRow`. PATCH / DELETE / restore need `If-Match` (428 without it).
export const AuthorsAPI = {
  List: async (query: AuthorsQuery = {}) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<Author[]>>(API_ENDPOINTS.AUTHORS.LIST, { params: query });
    return data;
  },
  Get: async (id: number | string) => withEtag(await axiosInstance.get<ApiResponse<Author>>(API_ENDPOINTS.AUTHORS.DETAIL(id))),
  Create: async (payload: CreateAuthorPayload, idempotencyKey?: string) =>
    withEtag(await axiosInstance.post<ApiResponse<Author>>(API_ENDPOINTS.AUTHORS.LIST, payload, { headers: idempotencyKeyHeaders(idempotencyKey) })),
  Update: async (id: number | string, payload: UpdateAuthorPayload, etag: string | undefined) =>
    withEtag(await axiosInstance.patch<ApiResponse<Author>>(API_ENDPOINTS.AUTHORS.DETAIL(id), payload, ifMatch(etag, { required: true }))),
  // Soft delete. 409 `ENTITY_REFERENCED` with `details.reason = "author_has_posts"` while posts use the author.
  Delete: async (id: number | string, etag: string | undefined) => {
    const { data } = await axiosInstance.delete<ApiResponse<null>>(API_ENDPOINTS.AUTHORS.DETAIL(id), ifMatch(etag, { required: true }));
    return data;
  },
  Restore: async (id: number | string, etag: string | undefined) =>
    withEtag(await axiosInstance.post<ApiResponse<Author>>(API_ENDPOINTS.AUTHORS.RESTORE(id), undefined, ifMatch(etag, { required: true }))),
};
