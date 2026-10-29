import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatchHeaders, withEtag } from "@/lib/etag";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type { FormDetail, FormListItem, FormsQuery, FormWriteResult, RecipientsResult, ReplaceRecipientsPayload, UpdateFormPayload } from "@/types/forms";

// Forms (doc/05 section 13.6). No create / delete in P1. `PATCH` carries the form's ETag (`"<lock_version>"`); the recipients
// have their OWN validator: `PUT .../recipients` takes `recipients_etag` as `If-Match` and does not move the form's ETag.
export const FormsAPI = {
  List: async (query: FormsQuery = {}) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<FormListItem[]>>(API_ENDPOINTS.FORMS.LIST, { params: query });
    return data;
  },
  Get: async (id: number | string) => withEtag(await axiosInstance.get<ApiResponse<FormDetail>>(API_ENDPOINTS.FORMS.DETAIL(id))),
  // Texts and settings only (the field schema is P2: 422 `not_applicable`). `If-Match` is mandatory (428 without it).
  Update: async (id: number | string, payload: UpdateFormPayload, etag: string | undefined) =>
    withEtag(await axiosInstance.patch<ApiResponse<FormWriteResult>>(API_ENDPOINTS.FORMS.DETAIL(id), payload, { headers: ifMatchHeaders(etag, { required: true }) })),
  // The WHOLE set, at once, effective immediately (not tied to the draft). The answer's ETag is the NEW `recipients_etag`.
  ReplaceRecipients: async (id: number | string, payload: ReplaceRecipientsPayload, recipientsEtag: string | undefined) =>
    withEtag(
      await axiosInstance.put<ApiResponse<RecipientsResult>>(API_ENDPOINTS.FORMS.RECIPIENTS(id), payload, {
        headers: ifMatchHeaders(recipientsEtag, { required: true }),
      })
    ),
};
