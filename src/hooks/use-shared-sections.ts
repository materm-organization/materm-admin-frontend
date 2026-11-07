import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { WithEtag } from "@/lib/etag";
import { revisionsQueryKey } from "@/lib/revision-resources";
import { SharedSectionsAPI } from "@/services/shared-sections.api";
import type { ApiResponse } from "@/types/api";
import type { CreateSharedSectionPayload, SharedSection, SharedSectionsQuery, UpdateSharedSectionPayload } from "@/types/shared-sections";

// Every shared-sections list and usages query starts with "/shared-sections" so a publish command (which refreshes `listPath`) and a page
// section write (which changes the usage counts) refresh them all. The detail key is the detail URL, a different first element.
export const SHARED_ROOT = "/shared-sections";
export const sharedSectionQueryKey = (id: number | string) => [API_ENDPOINTS.SHARED_SECTIONS.DETAIL(id)] as const;

export const useSharedSections = (query: SharedSectionsQuery, enabled = true) =>
  useQuery({ queryKey: [SHARED_ROOT, "list", query], queryFn: () => SharedSectionsAPI.List(query), enabled, placeholderData: keepPreviousData });

// One shared section with the ETag every write sends as `If-Match`.
export const useSharedSection = (id: number | string, enabled = true) =>
  useQuery({ queryKey: sharedSectionQueryKey(id), queryFn: () => SharedSectionsAPI.Get(id), enabled });

// Who references it (05 18.7). Not cached for long: a page write elsewhere changes it.
export const useSharedSectionUsages = (id: number | string, enabled = true) =>
  useQuery({ queryKey: [SHARED_ROOT, "usages", String(id)], queryFn: () => SharedSectionsAPI.Usages(id), enabled, staleTime: 0 });

type CachedShared = WithEtag<ApiResponse<SharedSection>>;

function useRefreshLists() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: [SHARED_ROOT] });
}

// A command answers the shared section in the shape of its own GET plus the NEW ETag: put it in the cache instead of refetching;
// the lists, the usages and the history go stale.
export function writeThroughShared(queryClient: QueryClient, id: number | string, result: { data: Partial<SharedSection>; etag: string | undefined }) {
  if (result.etag) {
    queryClient.setQueryData<CachedShared>(sharedSectionQueryKey(id), (old) =>
      old ? { etag: result.etag, data: { ...old.data, data: { ...old.data.data, ...result.data } } } : old
    );
  }
  void queryClient.invalidateQueries({ queryKey: [SHARED_ROOT] });
  void queryClient.invalidateQueries({ queryKey: revisionsQueryKey("shared-sections", id) });
}

export const useMutationCreateSharedSection = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: CreateSharedSectionPayload; idempotencyKey?: string }) => SharedSectionsAPI.Create(payload, idempotencyKey),
    onSuccess: () => refresh(),
  });
};

// ONE write queue per editor: each PATCH / DELETE / restore reads the ETag from the cache when its turn comes (a second save never sends a stale
// `If-Match`, and a delete never races a save that is still in flight).
export function useSharedSectionWrites(id: number) {
  const queryClient = useQueryClient();
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const run = useCallback(
    <T,>(task: (etag: string | undefined) => Promise<T>): Promise<T> => {
      const result = chain.current.then(() => task(queryClient.getQueryData<CachedShared>(sharedSectionQueryKey(id))?.etag));
      chain.current = result.catch(() => undefined);
      return result;
    },
    [queryClient, id]
  );
  return useMemo(
    () => ({
      queue: run,
      update: (payload: UpdateSharedSectionPayload) =>
        run(async (etag) => {
          const response = await SharedSectionsAPI.Update(id, payload, etag);
          writeThroughShared(queryClient, id, { data: response.data.data, etag: response.etag });
          return response.data.data;
        }),
      remove: () =>
        run(async (etag) => {
          const response = await SharedSectionsAPI.Delete(id, etag);
          void queryClient.invalidateQueries({ queryKey: [SHARED_ROOT] });
          return response;
        }),
      restore: () =>
        run(async (etag) => {
          const response = await SharedSectionsAPI.Restore(id, etag);
          writeThroughShared(queryClient, id, { data: response.data.data, etag: response.etag });
          return response.data.data;
        }),
    }),
    [id, queryClient, run]
  );
}
