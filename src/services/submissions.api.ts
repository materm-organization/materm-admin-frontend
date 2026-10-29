import type { AxiosResponse } from "axios";

import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { unwrapBlobError } from "@/lib/blob-error";
import { ifMatchHeaders, withEtag } from "@/lib/etag";
import { idempotencyKeyHeaders } from "@/lib/idempotency";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type {
  BulkStatusPayload,
  BulkStatusResult,
  SubmissionDetail,
  SubmissionListItem,
  SubmissionNote,
  SubmissionStatus,
  SubmissionsExportQuery,
  SubmissionsQuery,
  SubmissionsSummary,
} from "@/types/submissions";

// Submissions (doc/05 section 13.7). Never send `assigned_to` / `mine` (P2: 422 `not_applicable`). Every call that names a row
// carries its `created_at` as `?created_at=` (the partition hint: a value that is not the row's is a 404).
const hint = (createdAt?: string) => (createdAt ? { created_at: createdAt } : undefined);

export type SubmissionsExportResult = { blob: Blob; filename: string };

// `attachment; filename="submissions-20261028T031500Z.csv"` -> the file name (a fixed fallback if the header is missing).
export function filenameFromDisposition(header: string | undefined): string {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header ?? "");
  const name = match?.[1] ? decodeURIComponent(match[1]).replace(/[\\/]/g, "_") : "";
  return name || "submissions.csv";
}

export const SubmissionsAPI = {
  List: async (query: SubmissionsQuery = {}) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<SubmissionListItem[]>>(API_ENDPOINTS.SUBMISSIONS.LIST, { params: query });
    return data;
  },
  Summary: async () => {
    const { data } = await axiosInstance.get<ApiResponse<SubmissionsSummary>>(API_ENDPOINTS.SUBMISSIONS.SUMMARY);
    return data.data;
  },
  // No side effect on the server (C-09): the "read" state is a separate PATCH the screen sends after a second.
  Get: async (id: number | string, createdAt?: string, locale?: string) =>
    withEtag(await axiosInstance.get<ApiResponse<SubmissionDetail>>(API_ENDPOINTS.SUBMISSIONS.DETAIL(id), { params: { ...hint(createdAt), ...(locale ? { locale } : {}) } })),
  // `If-Match` is optional here (several people work in the inbox); the status table decides. The answer is a LIST ITEM, not the detail.
  SetStatus: async (id: number | string, status: SubmissionStatus, createdAt?: string, etag?: string) =>
    withEtag(
      await axiosInstance.patch<ApiResponse<SubmissionListItem>>(API_ENDPOINTS.SUBMISSIONS.DETAIL(id), { status }, { params: hint(createdAt), headers: ifMatchHeaders(etag) })
    ),
  BulkStatus: async (payload: BulkStatusPayload) => {
    const { data } = await axiosInstance.post<ApiResponse<BulkStatusResult>>(API_ENDPOINTS.SUBMISSIONS.BULK_STATUS, payload);
    return data.data;
  },
  // Append-only; the note is not an ETag event. `Idempotency-Key` is opt-in (a repeat would append again).
  AddNote: async (id: number | string, note: string, createdAt?: string, idempotencyKey?: string) => {
    const { data } = await axiosInstance.post<ApiResponse<SubmissionNote>>(
      API_ENDPOINTS.SUBMISSIONS.NOTES(id),
      { note },
      { params: hint(createdAt), headers: idempotencyKeyHeaders(idempotencyKey) }
    );
    return data.data;
  },
  // A plain `<a href>` would not send the Bearer token, so the file is fetched as a Blob. An error body is a Blob too: it is
  // unwrapped so that the code (`EXPORT_TOO_LARGE`, `RATE_LIMITED`...) and `Retry-After` reach the caller.
  Export: async (query: SubmissionsExportQuery): Promise<SubmissionsExportResult> => {
    let response: AxiosResponse<Blob>;
    try {
      response = await axiosInstance.get<Blob>(API_ENDPOINTS.SUBMISSIONS.EXPORT, { params: query, responseType: "blob" });
    } catch (error) {
      throw await unwrapBlobError(error);
    }
    return { blob: response.data, filename: filenameFromDisposition(String(response.headers?.["content-disposition"] ?? "")) };
  },
};
