import type { AxiosResponse } from "axios";

import { axiosInstance } from "@/lib/axios";
import { unwrapBlobError } from "@/lib/blob-error";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatch, withEtag } from "@/lib/etag";
import { idempotencyKeyHeaders } from "@/lib/idempotency";
import { filenameFromDisposition } from "@/services/submissions.api";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type {
  CreateRedirectPayload,
  Redirect,
  RedirectCheckPayload,
  RedirectCheckResult,
  RedirectsExportQuery,
  RedirectsQuery,
  UpdateRedirectPayload,
} from "@/types/redirects";

// Redirects (doc/05 section 14). A list row has no ETag header: build it from `updated_at` (`etagOfRow`). PATCH / DELETE / restore need
// `If-Match` (428 without it). DELETE is a soft delete (the trash); restore needs `cms.redirects:delete`.
export const RedirectsAPI = {
  List: async (query: RedirectsQuery = {}) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<Redirect[]>>(API_ENDPOINTS.REDIRECTS.LIST, { params: query });
    return data;
  },
  Get: async (id: number | string) => withEtag(await axiosInstance.get<ApiResponse<Redirect>>(API_ENDPOINTS.REDIRECTS.DETAIL(id))),
  Create: async (payload: CreateRedirectPayload, idempotencyKey?: string) =>
    withEtag(
      await axiosInstance.post<ApiResponse<Redirect>>(API_ENDPOINTS.REDIRECTS.LIST, payload, { headers: idempotencyKeyHeaders(idempotencyKey) })
    ),
  Update: async (id: number | string, payload: UpdateRedirectPayload, etag: string | undefined) =>
    withEtag(await axiosInstance.patch<ApiResponse<Redirect>>(API_ENDPOINTS.REDIRECTS.DETAIL(id), payload, ifMatch(etag, { required: true }))),
  Delete: async (id: number | string, etag: string | undefined) => {
    const { data } = await axiosInstance.delete<ApiResponse<null>>(API_ENDPOINTS.REDIRECTS.DETAIL(id), ifMatch(etag, { required: true }));
    return data;
  },
  Restore: async (id: number | string, etag: string | undefined) =>
    withEtag(await axiosInstance.post<ApiResponse<Redirect>>(API_ENDPOINTS.REDIRECTS.RESTORE(id), undefined, ifMatch(etag, { required: true }))),
  // Dry run: nothing is written. Needs `cms.redirects:read` only.
  Check: async (payload: RedirectCheckPayload, signal?: AbortSignal) => {
    const { data } = await axiosInstance.post<ApiResponse<RedirectCheckResult>>(API_ENDPOINTS.REDIRECTS.CHECK, payload, { signal });
    return data.data;
  },
  // CSV `from,to,code` (doc/05 14.7; UTF-8 with BOM, CRLF). Fetched as a Blob: a plain link would not carry the Bearer token.
  Export: async (query: RedirectsExportQuery): Promise<{ blob: Blob; filename: string }> => {
    let response: AxiosResponse<Blob>;
    try {
      response = await axiosInstance.get<Blob>(API_ENDPOINTS.REDIRECTS.EXPORT, { params: query, responseType: "blob" });
    } catch (error) {
      throw await unwrapBlobError(error);
    }
    const filename = filenameFromDisposition(String(response.headers?.["content-disposition"] ?? ""));
    return { blob: response.data, filename: filename === "submissions.csv" ? "redirects.csv" : filename };
  },
};
