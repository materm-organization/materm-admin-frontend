import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatchHeaders, withEtag } from "@/lib/etag";
import { idempotencyKeyHeaders } from "@/lib/idempotency";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type {
  CreateSharedSectionPayload,
  SharedSection,
  SharedSectionDeleteResult,
  SharedSectionListItem,
  SharedSectionUsages,
  SharedSectionWriteResult,
  SharedSectionsQuery,
  UpdateSharedSectionPayload,
} from "@/types/shared-sections";

// The ETag of a shared section is `"<lock_version>"` (05 18.2); a list row has no ETag header, so build it from the row.
export const sharedSectionEtag = (row: { lock_version: number }) => `"${row.lock_version}"`;

const required = (etag: string | undefined) => ({ headers: ifMatchHeaders(etag, { required: true }) });

// Shared sections (doc/05 section 18). Publish / unpublish / discard-draft / revisions go through `PublishingAPI` / `RevisionsTab` (resource `shared-sections`).
export const SharedSectionsAPI = {
  List: async (query: SharedSectionsQuery = {}) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<SharedSectionListItem[]>>(API_ENDPOINTS.SHARED_SECTIONS.LIST, { params: query });
    return data;
  },
  Get: async (id: number | string) => withEtag(await axiosInstance.get<ApiResponse<SharedSection>>(API_ENDPOINTS.SHARED_SECTIONS.DETAIL(id))),
  // 201 + `ETag: "1"`; opt-in `Idempotency-Key`.
  Create: async (payload: CreateSharedSectionPayload, idempotencyKey?: string) =>
    withEtag(await axiosInstance.post<ApiResponse<SharedSectionWriteResult>>(API_ENDPOINTS.SHARED_SECTIONS.LIST, payload, { headers: idempotencyKeyHeaders(idempotencyKey) })),
  // `If-Match` mandatory. `props` replaces the whole object. 409 `INVALID_STATE` `trashed`.
  Update: async (id: number | string, payload: UpdateSharedSectionPayload, etag: string | undefined) =>
    withEtag(await axiosInstance.patch<ApiResponse<SharedSectionWriteResult>>(API_ENDPOINTS.SHARED_SECTIONS.DETAIL(id), payload, required(etag))),
  // 409 `ENTITY_REFERENCED` `details.reason` `shared_section_in_use` while any page (trash included) or page draft references it.
  Delete: async (id: number | string, etag: string | undefined) =>
    withEtag(await axiosInstance.delete<ApiResponse<SharedSectionDeleteResult>>(API_ENDPOINTS.SHARED_SECTIONS.DETAIL(id), required(etag))),
  Restore: async (id: number | string, etag: string | undefined) =>
    withEtag(await axiosInstance.post<ApiResponse<SharedSectionWriteResult>>(API_ENDPOINTS.SHARED_SECTIONS.RESTORE(id), undefined, required(etag))),
  Usages: async (id: number | string, options: { includeTrashed?: boolean } = {}) => {
    const { data } = await axiosInstance.get<ApiResponse<SharedSectionUsages>>(API_ENDPOINTS.SHARED_SECTIONS.USAGES(id), {
      params: options.includeTrashed === undefined ? undefined : { include_trashed: options.includeTrashed },
    });
    return data;
  },
};
