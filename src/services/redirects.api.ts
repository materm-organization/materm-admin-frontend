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
  RedirectImportReport,
  RedirectsExportQuery,
  RedirectsQuery,
  UpdateRedirectPayload,
} from "@/types/redirects";

// Redirects (doc/05 section 14). A list row has no ETag header: build it from `updated_at` (`etagOfRow`). PATCH / DELETE / restore need
// `If-Match` (428 without it). DELETE is a soft delete (the trash); restore needs `cms.redirects:delete`.
// 8 MiB is the file limit of the server (doc/05 14.13); a 413 would still use one of the 20 imports per hour, so the client refuses first.
export const REDIRECT_IMPORT_MAX_BYTES = 8 * 1024 * 1024;
// A big report (50,000 rows is about 6.6 MB) over a slow link: the default 30 s is too short.
const IMPORT_TIMEOUT_MS = 120_000;

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
  // CSV import (doc/05 14.13): ONE file in the multipart field `file`, `dry_run` always sent explicitly (the server's default is true).
  // 200 = the report (dry run, or applied). A real import with a bad row is a 422 whose `details.report` is the same report
  // (`reportFromError` reads it). Rate limit 20 per hour per user, dry runs included.
  Import: async (file: File, dryRun: boolean, signal?: AbortSignal): Promise<RedirectImportReport> => {
    const body = new FormData();
    body.append("file", file);
    const { data } = await axiosInstance.post<ApiResponse<RedirectImportReport>>(API_ENDPOINTS.REDIRECTS.IMPORT, body, {
      params: { dry_run: dryRun },
      timeout: IMPORT_TIMEOUT_MS,
      signal,
    });
    return data.data;
  },
};
