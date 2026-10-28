import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatch, withEtag } from "@/lib/etag";
import { revisionBase, type RevisionEntityId, type RevisionResource } from "@/lib/revision-resources";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type { RestoredFrom, RevisionDetail, RevisionSummary, RevisionsListQuery } from "@/types/revisions";

// Generic over the entity (doc/05 section 11.7): `GET /{e}/{id}/revisions`, `.../{revId}`, `POST .../restore`.
export const RevisionsAPI = {
  List: async (resource: RevisionResource, id: RevisionEntityId, query: RevisionsListQuery = {}) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<RevisionSummary[]>>(
      API_ENDPOINTS.REVISIONS.LIST(revisionBase(resource, id)),
      { params: query }
    );
    return data;
  },
  Get: async (resource: RevisionResource, id: RevisionEntityId, revId: number) => {
    const { data } = await axiosInstance.get<ApiResponse<RevisionDetail>>(
      API_ENDPOINTS.REVISIONS.DETAIL(revisionBase(resource, id), revId)
    );
    return data;
  },
  // `If-Match` = the CURRENT ETag of the entity (mandatory, 428 without it). The answer is the entity in the
  // shape of its own GET plus `restored_from`, and carries the new ETag. No Idempotency-Key (05 11.1.5).
  Restore: async (
    resource: RevisionResource,
    id: RevisionEntityId,
    revId: number,
    etag: string | undefined,
    changeNote?: string
  ) =>
    withEtag(
      await axiosInstance.post<ApiResponse<Record<string, unknown> & { restored_from?: RestoredFrom }>>(
        API_ENDPOINTS.REVISIONS.RESTORE(revisionBase(resource, id), revId),
        changeNote ? { change_note: changeNote } : undefined,
        ifMatch(etag, { required: true })
      )
    ),
};
