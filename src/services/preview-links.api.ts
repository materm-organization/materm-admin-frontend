import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { publishableBase, type PublishableResource } from "@/lib/publishable-resources";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type { CreatePreviewLinkPayload, PreviewLinkCreated, PreviewLinkItem, PreviewLinkRevoked, PreviewLinksQuery } from "@/types/preview-links";

// Preview links (doc/05 section 12.9). No `If-Match` (nothing in the entity changes), no `Idempotency-Key` (the raw token
// must not be stored server-side to replay it: a retry issues a new link).
export const PreviewLinksAPI = {
  // 201 `{ id, url, expires_at, locale, entity, revision }`: `url` carries the token and is returned ONCE.
  Create: async (resource: PublishableResource, id: number | string, payload: CreatePreviewLinkPayload) => {
    const { data } = await axiosInstance.post<ApiResponse<PreviewLinkCreated>>(
      API_ENDPOINTS.PREVIEW_LINKS.COLLECTION(publishableBase(resource, id)),
      Object.keys(payload).length > 0 ? payload : undefined
    );
    return data;
  },
  // A holder of `update` sees every user's links, a reader only their own. Never has the url.
  List: async (resource: PublishableResource, id: number | string, query: PreviewLinksQuery = {}) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<PreviewLinkItem[]>>(
      API_ENDPOINTS.PREVIEW_LINKS.COLLECTION(publishableBase(resource, id)),
      { params: query }
    );
    return data;
  },
  // The owner or an `update` holder; a second revoke is a 200 as well.
  Revoke: async (linkId: number | string) => {
    const { data } = await axiosInstance.delete<ApiResponse<PreviewLinkRevoked>>(API_ENDPOINTS.PREVIEW_LINKS.DETAIL(linkId));
    return data;
  },
};
