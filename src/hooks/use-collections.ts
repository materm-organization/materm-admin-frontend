import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";

import { entryRef } from "@/lib/collections/ref";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { WithEtag } from "@/lib/etag";
import { revisionsQueryKey } from "@/lib/revision-resources";
import { CollectionsAPI } from "@/services/collections.api";
import type { ApiResponse } from "@/types/api";
import type {
  Collection,
  CollectionEntriesQuery,
  CollectionEntryDetail,
  CollectionsQuery,
  CreateCollectionEntryPayload,
  CreateCollectionPayload,
  UpdateCollectionEntryPayload,
  UpdateCollectionPayload,
} from "@/types/collections";

// Every collections list starts with "/collections" so a publish command (which refreshes `listPath`) refreshes them all.
const ROOT = "/collections";
export const collectionQueryKey = (key: string) => [API_ENDPOINTS.COLLECTIONS.DETAIL(key)] as const;
export const entryQueryKey = (key: string, id: number | string) => [API_ENDPOINTS.COLLECTIONS.ENTRY(key, id)] as const;

export const useCollections = (query: CollectionsQuery, enabled = true) =>
  useQuery({ queryKey: [ROOT, "list", query], queryFn: () => CollectionsAPI.List(query), enabled, placeholderData: keepPreviousData });

// One definition with the ETag every write sends as `If-Match`.
export const useCollection = (key: string, enabled = true) => useQuery({ queryKey: collectionQueryKey(key), queryFn: () => CollectionsAPI.Get(key), enabled });

export const useCollectionEntries = (key: string, query: CollectionEntriesQuery, enabled = true) =>
  useQuery({ queryKey: [ROOT, key, "entries", "list", query], queryFn: () => CollectionsAPI.Entries(key, query), enabled, placeholderData: keepPreviousData });

export const useCollectionEntry = (key: string, id: number | string, enabled = true) =>
  useQuery({ queryKey: entryQueryKey(key, id), queryFn: () => CollectionsAPI.Entry(key, id), enabled });

type CachedCollection = WithEtag<ApiResponse<Collection>>;
type CachedEntry = WithEtag<ApiResponse<CollectionEntryDetail>>;

function useRefreshLists() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: [ROOT] });
}

// A definition write answers the whole definition: it goes into the cache with its new ETag (no refetch), lists and history go stale.
export function writeThroughCollection(queryClient: QueryClient, key: string, result: { data: Collection; etag: string | undefined }) {
  queryClient.setQueryData<CachedCollection>(collectionQueryKey(key), (old) =>
    old ? { etag: result.etag ?? result.data.etag, data: { ...old.data, data: result.data } } : { etag: result.etag ?? result.data.etag, data: { success: true, data: result.data } }
  );
  void queryClient.invalidateQueries({ queryKey: [ROOT] });
  void queryClient.invalidateQueries({ queryKey: revisionsQueryKey("collections", key) });
}

export const useMutationCreateCollection = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: CreateCollectionPayload; idempotencyKey?: string }) => CollectionsAPI.Create(payload, idempotencyKey),
    onSuccess: () => refresh(),
  });
};

export const useMutationUpdateCollection = (key: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, etag }: { payload: UpdateCollectionPayload; etag: string | undefined }) => CollectionsAPI.Update(key, payload, etag),
    onSuccess: (r) => writeThroughCollection(queryClient, key, { data: r.data.data, etag: r.etag }),
  });
};

export const useMutationDeleteCollection = () => {
  const refresh = useRefreshLists();
  return useMutation({ mutationFn: ({ key, etag }: { key: string; etag: string | undefined }) => CollectionsAPI.Delete(key, etag), onSuccess: () => refresh() });
};

export const useMutationRestoreCollection = () => {
  const refresh = useRefreshLists();
  return useMutation({ mutationFn: ({ key, etag }: { key: string; etag: string | undefined }) => CollectionsAPI.Restore(key, etag), onSuccess: () => refresh() });
};

export const useMutationCreateEntry = (key: string) => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: CreateCollectionEntryPayload; idempotencyKey?: string }) => CollectionsAPI.CreateEntry(key, payload, idempotencyKey),
    onSuccess: () => refresh(),
  });
};

export const useMutationDeleteEntry = (key: string) => {
  const refresh = useRefreshLists();
  return useMutation({ mutationFn: ({ id, etag }: { id: number; etag: string | undefined }) => CollectionsAPI.DeleteEntry(key, id, etag), onSuccess: () => refresh() });
};

export const useMutationRestoreEntry = (key: string) => {
  const refresh = useRefreshLists();
  return useMutation({ mutationFn: ({ id, etag }: { id: number; etag: string | undefined }) => CollectionsAPI.RestoreEntry(key, id, etag), onSuccess: () => refresh() });
};

// A command answers the entry in the shape of its own GET plus the NEW ETag: put it in the cache instead of refetching.
export function writeThroughEntry(queryClient: QueryClient, key: string, id: number | string, result: { data: Partial<CollectionEntryDetail>; etag: string | undefined }) {
  if (result.etag) {
    queryClient.setQueryData<CachedEntry>(entryQueryKey(key, id), (old) =>
      old ? { etag: result.etag, data: { ...old.data, data: { ...old.data.data, ...result.data } } } : old
    );
  }
  void queryClient.invalidateQueries({ queryKey: [ROOT] });
  void queryClient.invalidateQueries({ queryKey: revisionsQueryKey("collection-entries", entryRef(key, id)) });
}

// ONE write queue per entry editor: each PATCH reads the ETag from the cache when its turn comes (a second save never sends a stale `If-Match`).
export function useEntryWrites(key: string, id: number) {
  const queryClient = useQueryClient();
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const run = useCallback(
    <T,>(task: (etag: string | undefined) => Promise<T>): Promise<T> => {
      const result = chain.current.then(() => task(queryClient.getQueryData<CachedEntry>(entryQueryKey(key, id))?.etag));
      chain.current = result.catch(() => undefined);
      return result;
    },
    [queryClient, key, id]
  );
  return useMemo(
    () => ({
      update: (payload: UpdateCollectionEntryPayload) =>
        run(async (etag) => {
          const response = await CollectionsAPI.UpdateEntry(key, id, payload, etag);
          writeThroughEntry(queryClient, key, id, { data: response.data.data, etag: response.etag });
          return response.data.data;
        }),
    }),
    [key, id, queryClient, run]
  );
}
