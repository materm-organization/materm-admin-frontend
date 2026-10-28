import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatchHeaders, withEtag } from "@/lib/etag";
import { idempotencyKeyHeaders } from "@/lib/idempotency";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type {
  CreatePagePayload,
  PageCreateResult,
  PageDeleteResult,
  PageDetail,
  PageListItem,
  PageReferences,
  PageTemplate,
  PageSection,
  PageWriteResult,
  PagesQuery,
  SectionOrderResult,
  SectionSummary,
  SectionWriteResult,
  CreateSectionPayload,
  SetHomeResult,
  UpdatePagePayload,
  UpdateSectionPayload,
} from "@/types/pages";

// The ETag of a page is `"<lock_version>"` (doc/05 12.2.3); a list row has no ETag header, so build it from the row.
export const pageEtag = (row: { lock_version: number }) => `"${row.lock_version}"`;

// Pages (doc/05 section 12.3, 12.4). Every write sends `If-Match` (428 without it); the answer carries the new ETag.
export const PagesAPI = {
  List: async (query: PagesQuery = {}) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<PageListItem[]>>(API_ENDPOINTS.PAGES.LIST, { params: query });
    return data;
  },
  Get: async (id: number | string) => withEtag(await axiosInstance.get<ApiResponse<PageDetail>>(API_ENDPOINTS.PAGES.DETAIL(id))),
  Create: async (payload: CreatePagePayload, idempotencyKey?: string) =>
    withEtag(
      await axiosInstance.post<ApiResponse<PageCreateResult>>(API_ENDPOINTS.PAGES.LIST, payload, {
        headers: idempotencyKeyHeaders(idempotencyKey),
      })
    ),
  // 05 12.3.3: partial, `If-Match` mandatory; a change that alters nothing answers 200 with the same ETag.
  Update: async (id: number | string, payload: UpdatePagePayload, etag: string | undefined) =>
    withEtag(await axiosInstance.patch<ApiResponse<PageWriteResult>>(API_ENDPOINTS.PAGES.DETAIL(id), payload, { headers: ifMatchHeaders(etag, { required: true }) })),
  // Soft delete (30 days in the trash). 409 `ENTITY_REFERENCED` (`details.references`) until the caller repeats it with
  // `confirm_references=true` (PG-13); the first request never carries it. 409 `INVALID_STATE` `is_home` / `system_page`.
  Delete: async (id: number | string, etag: string | undefined, options: { confirmReferences?: boolean } = {}) =>
    withEtag(
      await axiosInstance.delete<ApiResponse<PageDeleteResult>>(API_ENDPOINTS.PAGES.DETAIL(id), {
        headers: ifMatchHeaders(etag, { required: true }),
        params: options.confirmReferences ? { confirm_references: true } : undefined,
      })
    ),
  Restore: async (id: number | string, etag: string | undefined) =>
    withEtag(
      await axiosInstance.post<ApiResponse<PageWriteResult>>(API_ENDPOINTS.PAGES.RESTORE(id), undefined, {
        headers: ifMatchHeaders(etag, { required: true }),
      })
    ),
  // `If-Match` = the ETag of the TARGET page. The old home page moves to `previous_home_path` (default: `/<key>`).
  SetHome: async (id: number | string, etag: string | undefined, options: { previousHomePath?: string; idempotencyKey?: string } = {}) =>
    withEtag(
      await axiosInstance.post<ApiResponse<SetHomeResult>>(
        API_ENDPOINTS.PAGES.SET_HOME(id),
        options.previousHomePath ? { previous_home_path: options.previousHomePath } : undefined,
        { headers: { ...ifMatchHeaders(etag, { required: true }), ...idempotencyKeyHeaders(options.idempotencyKey) } }
      )
    ),
  References: async (id: number | string) => {
    const { data } = await axiosInstance.get<ApiResponse<PageReferences>>(API_ENDPOINTS.PAGES.REFERENCES(id));
    return data;
  },
  Templates: async () => {
    const { data } = await axiosInstance.get<ApiResponse<PageTemplate[]>>(API_ENDPOINTS.PAGE_TEMPLATES.LIST);
    return data;
  },
};

// Sections of a page (05 12.5). Every write sends the PAGE's `If-Match` and answers the page's new `ETag`; the answers
// are the section / the order and the page's `aggregate`, never the page itself.
export const PageSectionsAPI = {
  // `include=props`: the editor needs every props object (the list alone would not carry them, 12.5.3).
  List: async (pageId: number | string) =>
    withEtag(await axiosInstance.get<ApiResponse<SectionSummary[]>>(API_ENDPOINTS.PAGES.SECTIONS(pageId), { params: { include: "props" } })),
  Get: async (pageId: number | string, id: number | string) =>
    withEtag(await axiosInstance.get<ApiResponse<PageSection>>(API_ENDPOINTS.PAGES.SECTION(pageId, id))),
  Create: async (pageId: number | string, payload: CreateSectionPayload, etag: string | undefined, idempotencyKey?: string) =>
    withEtag(
      await axiosInstance.post<ApiResponse<SectionWriteResult>>(API_ENDPOINTS.PAGES.SECTIONS(pageId), payload, {
        headers: { ...ifMatchHeaders(etag, { required: true }), ...idempotencyKeyHeaders(idempotencyKey) },
      })
    ),
  Update: async (pageId: number | string, id: number | string, payload: UpdateSectionPayload, etag: string | undefined) =>
    withEtag(
      await axiosInstance.patch<ApiResponse<SectionWriteResult>>(API_ENDPOINTS.PAGES.SECTION(pageId, id), payload, { headers: ifMatchHeaders(etag, { required: true }) })
    ),
  Reorder: async (pageId: number | string, ids: number[], etag: string | undefined) =>
    withEtag(
      await axiosInstance.put<ApiResponse<SectionOrderResult>>(
        API_ENDPOINTS.PAGES.SECTIONS_ORDER(pageId),
        { sections: ids.map((id) => ({ id })) },
        { headers: ifMatchHeaders(etag, { required: true }) }
      )
    ),
  Delete: async (pageId: number | string, id: number | string, etag: string | undefined) =>
    withEtag(await axiosInstance.delete<ApiResponse<SectionOrderResult>>(API_ENDPOINTS.PAGES.SECTION(pageId, id), { headers: ifMatchHeaders(etag, { required: true }) })),
};
