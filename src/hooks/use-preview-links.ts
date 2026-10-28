import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { publishableBase, type PublishableResource } from "@/lib/publishable-resources";
import { PreviewLinksAPI } from "@/services/preview-links.api";
import type { CreatePreviewLinkPayload, PreviewLinksQuery } from "@/types/preview-links";

// The query key is the list's URL + the query: NEVER anything that comes out of a created link (its url holds the token).
export const previewLinksQueryKey = (resource: PublishableResource, id: number | string) =>
  [API_ENDPOINTS.PREVIEW_LINKS.COLLECTION(publishableBase(resource, id))] as const;

// The links already issued for an entity (default: the active ones). Rows never have the url.
export const usePreviewLinks = (resource: PublishableResource, id: number | string, query: PreviewLinksQuery = {}, enabled = true) =>
  useQuery({
    queryKey: [...previewLinksQueryKey(resource, id), query],
    queryFn: () => PreviewLinksAPI.List(resource, id, query),
    enabled,
    placeholderData: keepPreviousData,
    // A link can expire or be revoked by someone else any minute: always read the list again when the dialog opens.
    staleTime: 0,
  });

// Issues a link. The answer holds the raw token: `gcTime: 0` so the mutation (and its `data`) leaves the cache as soon as no
// component observes it, and the caller copies the answer into its own state and calls `reset()` at once. After a success
// only the LIST is refreshed (it has no url).
export const useMutationCreatePreviewLink = (resource: PublishableResource, id: number | string) => {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (payload: CreatePreviewLinkPayload) => PreviewLinksAPI.Create(resource, id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: previewLinksQueryKey(resource, id) });
    },
  });
};

export const useMutationRevokePreviewLink = (resource: PublishableResource, id: number | string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (linkId: number) => PreviewLinksAPI.Revoke(linkId),
    // Also after a failure: a 404 / 403 means the list on screen is out of date.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: previewLinksQueryKey(resource, id) });
    },
  });
};
