import { useMutation, useQueryClient } from "@tanstack/react-query";

import { PUBLISHABLE_RESOURCES, type PublishableResource } from "@/lib/publishable-resources";
import { revisionsQueryKey } from "@/lib/revision-resources";
import { PublishingAPI } from "@/services/publishing.api";

// The three commands of the publish engine for one entity (doc/05 section 12.7). After a command the entity's lists and
// its history are marked stale; the entity's OWN cache is the host's to update from the answer (no refetch: the answer
// carries the new ETag), see `PublishBar`'s `onResult`.
function useRefresh(resource: PublishableResource, id: number | string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: [PUBLISHABLE_RESOURCES[resource].listPath] });
    void queryClient.invalidateQueries({ queryKey: revisionsQueryKey(resource, id) });
  };
}

type Etag = string | undefined;

export const useMutationPublish = (resource: PublishableResource, id: number | string) => {
  const refresh = useRefresh(resource, id);
  return useMutation({
    mutationFn: ({ etag, dryRun, changeNote, idempotencyKey }: { etag: Etag; dryRun?: boolean; changeNote?: string; idempotencyKey?: string }) =>
      PublishingAPI.Publish(resource, id, etag, { dryRun, changeNote, idempotencyKey }),
    // A dry run changes nothing.
    onSuccess: (_r, { dryRun }) => {
      if (!dryRun) refresh();
    },
  });
};

export const useMutationUnpublish = (resource: PublishableResource, id: number | string) => {
  const refresh = useRefresh(resource, id);
  return useMutation({
    mutationFn: ({ etag, confirmReferences, idempotencyKey }: { etag: Etag; confirmReferences?: boolean; idempotencyKey?: string }) =>
      PublishingAPI.Unpublish(resource, id, etag, { confirmReferences, idempotencyKey }),
    onSuccess: () => refresh(),
  });
};

export const useMutationDiscardDraft = (resource: PublishableResource, id: number | string) => {
  const refresh = useRefresh(resource, id);
  return useMutation({
    mutationFn: ({ etag }: { etag: Etag }) => PublishingAPI.DiscardDraft(resource, id, etag),
    onSuccess: () => refresh(),
  });
};

// D1 (doc/05 12.10 - 12.11). Same rules as above: the host writes the answer through, the lists and the history go stale.
export const useMutationSubmitReview = (resource: PublishableResource, id: number | string) => {
  const refresh = useRefresh(resource, id);
  return useMutation({
    mutationFn: ({ etag, note, idempotencyKey }: { etag: Etag; note?: string; idempotencyKey?: string }) => PublishingAPI.SubmitReview(resource, id, etag, { note, idempotencyKey }),
    onSuccess: () => refresh(),
  });
};

// `gcTime: 0`: the comment is the variables of the mutation; it is dropped from the cache as soon as nothing observes the mutation.
export const useMutationReject = (resource: PublishableResource, id: number | string) => {
  const refresh = useRefresh(resource, id);
  return useMutation({
    gcTime: 0,
    mutationFn: ({ etag, comment, idempotencyKey }: { etag: Etag; comment: string; idempotencyKey?: string }) => PublishingAPI.Reject(resource, id, etag, { comment, idempotencyKey }),
    onSuccess: () => refresh(),
  });
};

export const useMutationSchedule = (resource: PublishableResource, id: number | string) => {
  const refresh = useRefresh(resource, id);
  return useMutation({
    mutationFn: ({ etag, scheduledAt, idempotencyKey }: { etag: Etag; scheduledAt: string; idempotencyKey?: string }) => PublishingAPI.Schedule(resource, id, etag, { scheduledAt, idempotencyKey }),
    onSuccess: () => refresh(),
  });
};

export const useMutationUnschedule = (resource: PublishableResource, id: number | string) => {
  const refresh = useRefresh(resource, id);
  return useMutation({
    mutationFn: ({ etag }: { etag: Etag }) => PublishingAPI.Unschedule(resource, id, etag),
    onSuccess: () => refresh(),
  });
};
