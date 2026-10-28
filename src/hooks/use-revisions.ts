import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { revisionsQueryKey, type RevisionEntityId, type RevisionResource } from "@/lib/revision-resources";
import { RevisionsAPI } from "@/services/revisions.api";
import type { RevisionsListQuery } from "@/types/revisions";

// History of a save-live entity (SCR-37; doc/05 section 11.7): one hook for all of them,
// `useRevisions("menus", "main")`, `useRevisions("media/assets", 7)`. The list is paginated (default 20).
export const useRevisions = (
  resource: RevisionResource,
  id: RevisionEntityId,
  query: RevisionsListQuery = {},
  enabled = true
) =>
  useQuery({
    queryKey: [...revisionsQueryKey(resource, id), "list", query],
    queryFn: () => RevisionsAPI.List(resource, id, query),
    enabled,
    placeholderData: keepPreviousData,
  });

// One revision with its snapshot. Immutable, so cached for good.
export const useRevision = (
  resource: RevisionResource,
  id: RevisionEntityId,
  revId: number | undefined,
  enabled = true
) =>
  useQuery({
    queryKey: [...revisionsQueryKey(resource, id), "detail", revId ?? 0],
    queryFn: () => RevisionsAPI.Get(resource, id, revId as number),
    enabled: enabled && revId !== undefined,
    staleTime: Infinity,
  });

// Restore takes effect at once on the website (save-live). The caller passes the entity's CURRENT etag. The
// entity's own queries are the editor's to refresh (`RevisionsTab`'s `onRestored`); the revision pages are
// refreshed here (a restore adds a `restore` row).
export const useMutationRestoreRevision = (resource: RevisionResource, id: RevisionEntityId) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ revId, etag, changeNote }: { revId: number; etag: string | undefined; changeNote?: string }) =>
      RevisionsAPI.Restore(resource, id, revId, etag, changeNote),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...revisionsQueryKey(resource, id), "list"] });
    },
  });
};
