import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { WithEtag } from "@/lib/etag";
import { revisionsQueryKey } from "@/lib/revision-resources";
import { AlbumsAPI } from "@/services/albums.api";
import type { ApiResponse } from "@/types/api";
import type {
  AlbumDetail,
  AlbumItem,
  AlbumsQuery,
  CreateAlbumItemsPayload,
  CreateAlbumPayload,
  ItemOrderEntry,
  UpdateAlbumItemPayload,
  UpdateAlbumPayload,
} from "@/types/albums";
import type { AggregateStamp } from "@/types/publishing";

const LIST_KEY = [API_ENDPOINTS.ALBUMS.LIST] as const;
export const albumQueryKey = (id: number | string) => [API_ENDPOINTS.ALBUMS.DETAIL(id)] as const;
// NOT under `["/albums"]`: a command refreshes the lists by that prefix, the items are written through instead.
export const albumItemsQueryKey = (id: number | string) => [API_ENDPOINTS.ALBUMS.ITEMS(id)] as const;

// SCR-28: the list (paginated; the trash is `trashed: true`).
export const useAlbums = (query: AlbumsQuery, enabled = true) =>
  useQuery({ queryKey: [...LIST_KEY, "list", query], queryFn: () => AlbumsAPI.List(query), enabled, placeholderData: keepPreviousData });

// One album with the ETag every command sends as `If-Match`.
export const useAlbum = (id: number | string, enabled = true) => useQuery({ queryKey: albumQueryKey(id), queryFn: () => AlbumsAPI.Get(id), enabled });

// The pictures of the album, in order, with the album's ETag (the same one: an item command moves it).
export const useAlbumItems = (id: number | string, enabled = true) => useQuery({ queryKey: albumItemsQueryKey(id), queryFn: () => AlbumsAPI.Items(id), enabled });

type CachedAlbum = WithEtag<ApiResponse<AlbumDetail>>;
type CachedItems = WithEtag<ApiResponse<AlbumItem[]>>;

// A command answers the album in the shape of its own GET plus the NEW ETag: put it in the cache instead of refetching (the next
// write would carry a stale `If-Match` until a refetch arrived). Lists, the history and the schema form's album picker go stale.
export function writeThroughAlbum(queryClient: QueryClient, id: number | string, result: { data: Partial<AlbumDetail> | Record<string, unknown>; etag: string | undefined }) {
  if (result.etag) {
    queryClient.setQueryData<CachedAlbum>(albumQueryKey(id), (old) =>
      old ? { etag: result.etag, data: { ...old.data, data: { ...old.data.data, ...(result.data as Partial<AlbumDetail>) } } } : old
    );
    // The items share the album's ETag.
    queryClient.setQueryData<CachedItems>(albumItemsQueryKey(id), (old) => (old ? { ...old, etag: result.etag } : old));
  }
  void queryClient.invalidateQueries({ queryKey: LIST_KEY });
  void queryClient.invalidateQueries({ queryKey: revisionsQueryKey("albums", id) });
  void queryClient.invalidateQueries({ queryKey: ["schema-form"] });
}

function useRefreshLists() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    void queryClient.invalidateQueries({ queryKey: ["schema-form"] });
  };
}

export const useMutationCreateAlbum = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: CreateAlbumPayload; idempotencyKey?: string }) => AlbumsAPI.Create(payload, idempotencyKey),
    onSuccess: () => refresh(),
  });
};

export const useMutationDeleteAlbum = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: ({ id, etag }: { id: number; etag: string | undefined }) => AlbumsAPI.Delete(id, etag),
    onSuccess: () => refresh(),
  });
};

export const useMutationRestoreAlbum = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: ({ id, etag }: { id: number; etag: string | undefined }) => AlbumsAPI.Restore(id, etag),
    onSuccess: () => refresh(),
  });
};

// ---- the writes of the album editor ----------------------------------------------------------------------------------------
// ONE queue per editor (a chain of promises): each write reads the album's ETag from the cache when its turn comes, so a reorder
// followed by a caption save never sends the same stale `If-Match`. Every success puts the answer's NEW ETag into the cache.
// Errors are the caller's (409 `CONFLICT_LOCK_VERSION` -> ConflictDialog, 409 `ENTITY_REFERENCED`, 422 field errors).
const currentEtag = (queryClient: QueryClient, albumId: number | string) => queryClient.getQueryData<CachedAlbum>(albumQueryKey(albumId))?.etag;

// The order the server answered (`[{id, sort_order}]`) applied to the cached items.
export function applyOrder(items: AlbumItem[], order: ItemOrderEntry[]): AlbumItem[] {
  const rank = new Map(order.map((o) => [o.id, o.sort_order]));
  return items
    .filter((i) => rank.has(i.id))
    .map((i) => ({ ...i, sort_order: rank.get(i.id)! }))
    .sort((a, b) => a.sort_order - b.sort_order);
}

const stampOf = (aggregate: AggregateStamp): Partial<AlbumDetail> => ({
  lock_version: aggregate.lock_version,
  status: aggregate.status,
  has_unpublished_changes: aggregate.has_unpublished_changes,
  updated_at: aggregate.updated_at,
});

export function useAlbumWrites(albumId: number) {
  const queryClient = useQueryClient();
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const run = useCallback(
    <T,>(task: (etag: string | undefined) => Promise<T>): Promise<T> => {
      const result = chain.current.then(() => task(currentEtag(queryClient, albumId)));
      chain.current = result.catch(() => undefined);
      return result;
    },
    [queryClient, albumId]
  );

  const setItems = useCallback(
    (update: (items: AlbumItem[]) => AlbumItem[]) =>
      queryClient.setQueryData<CachedItems>(albumItemsQueryKey(albumId), (old) => (old ? { ...old, data: { ...old.data, data: update(old.data.data) } } : old)),
    [queryClient, albumId]
  );

  // The album's stamp + its item count go into the cache with the new ETag.
  const stamped = useCallback(
    (aggregate: AggregateStamp, etag: string | undefined, itemCount?: number) =>
      writeThroughAlbum(queryClient, albumId, {
        data: { ...stampOf(aggregate), ...(itemCount === undefined ? {} : { item_count: itemCount }) },
        etag: etag ?? `"${aggregate.lock_version}"`,
      }),
    [queryClient, albumId]
  );
  const countOf = useCallback(() => queryClient.getQueryData<CachedItems>(albumItemsQueryKey(albumId))?.data.data.length ?? 0, [queryClient, albumId]);

  return useMemo(
    () => ({
      // PATCH of the album (title, description, cover): the answer IS the album.
      updateAlbum: (payload: UpdateAlbumPayload) =>
        run(async (etag) => {
          const response = await AlbumsAPI.Update(albumId, payload, etag);
          writeThroughAlbum(queryClient, albumId, { data: response.data.data, etag: response.etag });
          return response.data.data;
        }),
      addItems: (payload: CreateAlbumItemsPayload, idempotencyKey?: string) =>
        run(async (etag) => {
          const response = await AlbumsAPI.CreateItems(albumId, payload, etag, idempotencyKey);
          const { items: created, order, aggregate } = response.data.data;
          setItems((items) => applyOrder([...items, ...created], order));
          stamped(aggregate, response.etag, order.length);
          return response.data.data;
        }),
      updateItem: (itemId: number, payload: UpdateAlbumItemPayload) =>
        run(async (etag) => {
          const response = await AlbumsAPI.UpdateItem(albumId, itemId, payload, etag);
          const { item, aggregate } = response.data.data;
          setItems((items) => items.map((i) => (i.id === item.id ? item : i)));
          stamped(aggregate, response.etag);
          return response.data.data;
        }),
      deleteItem: (itemId: number) =>
        run(async (etag) => {
          const response = await AlbumsAPI.DeleteItem(albumId, itemId, etag);
          const { order, aggregate } = response.data.data;
          setItems((items) => applyOrder(items, order));
          stamped(aggregate, response.etag, order.length);
          return response.data.data;
        }),
      // Shown at once, put back when the server refuses.
      reorder: (ids: number[]) => {
        const before = queryClient.getQueryData<CachedItems>(albumItemsQueryKey(albumId));
        setItems((items) => ids.map((id, i) => ({ ...items.find((x) => x.id === id)!, sort_order: i })));
        return run(async (etag) => {
          try {
            const response = await AlbumsAPI.ReorderItems(albumId, ids, etag);
            const { order, aggregate } = response.data.data;
            setItems((items) => applyOrder(items, order));
            stamped(aggregate, response.etag, countOf());
            return response.data.data;
          } catch (error) {
            if (before) queryClient.setQueryData(albumItemsQueryKey(albumId), (current: CachedItems | undefined) => (current ? { ...current, data: before.data } : before));
            throw error;
          }
        });
      },
    }),
    [albumId, countOf, queryClient, run, setItems, stamped]
  );
}
