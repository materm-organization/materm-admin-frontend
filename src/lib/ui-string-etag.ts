// The ETag of a KEY-LEVEL restore of a UI string (`POST /ui-strings/{key}/revisions/{revId}/restore`).
//
// PROVISIONAL CONTRACT (decided for the backend, not yet in doc/05): a UI string has no single-entity GET, so the
// ETag is built from the key's HISTORY - the version number of the latest revision of that key, quoted
// (`"3"`; `"0"` while the key has no revision) - and is answered as the `ETag` header of
// `GET /ui-strings/{key}/revisions`. Everything that depends on the exact format is in THIS file:
//   - `formatUiStringKeyEtag` is the one line to change (e.g. to a weak validator `W/"3"`);
//   - `fetchUiStringRestoreEtag` reads the header first and only builds the value itself when the header is missing.
import { axiosInstance } from "@/lib/axios";
import { withEtag } from "@/lib/etag";
import { revisionBase } from "@/lib/revision-resources";
import type { ApiResponsePagination } from "@/types/api";
import type { RevisionSummary } from "@/types/revisions";

export const formatUiStringKeyEtag = (latestVersion: number): string => `"${latestVersion}"`;

export async function fetchUiStringRestoreEtag(key: string): Promise<string | undefined> {
  const response = await axiosInstance.get<ApiResponsePagination<RevisionSummary[]>>(`${revisionBase("ui-strings", key)}/revisions`, {
    params: { limit: 1, sort: "-version" },
  });
  const fromHeader = withEtag(response).etag;
  if (fromHeader) return fromHeader;
  return formatUiStringKeyEtag(response.data.data[0]?.version ?? 0);
}
