import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { WithEtag } from "@/lib/etag";
import { revisionsQueryKey } from "@/lib/revision-resources";
import { FaqAPI } from "@/services/faq.api";
import type { ApiResponse } from "@/types/api";
import type { ItemOrderEntry } from "@/types/albums";
import type { CreateFaqGroupPayload, CreateFaqItemPayload, FaqGroupDetail, FaqGroupsQuery, FaqItem, UpdateFaqGroupPayload, UpdateFaqItemPayload } from "@/types/faq";
import type { AggregateStamp } from "@/types/publishing";

const LIST_KEY = [API_ENDPOINTS.FAQ_GROUPS.LIST] as const;
export const faqGroupQueryKey = (id: number | string) => [API_ENDPOINTS.FAQ_GROUPS.DETAIL(id)] as const;
// NOT under `["/faq-groups"]` (a command refreshes the lists by that prefix; the items are written through).
export const faqItemsQueryKey = (id: number | string) => [API_ENDPOINTS.FAQ_GROUPS.ITEMS(id)] as const;

// SCR-30: the list of groups (paginated; the trash is `trashed: true`).
export const useFaqGroups = (query: FaqGroupsQuery, enabled = true) =>
  useQuery({ queryKey: [...LIST_KEY, "list", query], queryFn: () => FaqAPI.List(query), enabled, placeholderData: keepPreviousData });

export const useFaqGroup = (id: number | string, enabled = true) => useQuery({ queryKey: faqGroupQueryKey(id), queryFn: () => FaqAPI.Get(id), enabled });
export const useFaqItems = (id: number | string, enabled = true) => useQuery({ queryKey: faqItemsQueryKey(id), queryFn: () => FaqAPI.Items(id), enabled });

type CachedGroup = WithEtag<ApiResponse<FaqGroupDetail>>;
type CachedItems = WithEtag<ApiResponse<FaqItem[]>>;

// Same rules as `writeThroughAlbum`: the answer's new ETag goes into the cache, lists / history / pickers go stale.
export function writeThroughFaqGroup(queryClient: QueryClient, id: number | string, result: { data: Partial<FaqGroupDetail> | Record<string, unknown>; etag: string | undefined }) {
  if (result.etag) {
    queryClient.setQueryData<CachedGroup>(faqGroupQueryKey(id), (old) =>
      old ? { etag: result.etag, data: { ...old.data, data: { ...old.data.data, ...(result.data as Partial<FaqGroupDetail>) } } } : old
    );
    queryClient.setQueryData<CachedItems>(faqItemsQueryKey(id), (old) => (old ? { ...old, etag: result.etag } : old));
  }
  void queryClient.invalidateQueries({ queryKey: LIST_KEY });
  void queryClient.invalidateQueries({ queryKey: revisionsQueryKey("faq-groups", id) });
  void queryClient.invalidateQueries({ queryKey: ["schema-form"] });
}

function useRefreshLists() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    void queryClient.invalidateQueries({ queryKey: ["schema-form"] });
  };
}

export const useMutationCreateFaqGroup = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: CreateFaqGroupPayload; idempotencyKey?: string }) => FaqAPI.Create(payload, idempotencyKey),
    onSuccess: () => refresh(),
  });
};

export const useMutationDeleteFaqGroup = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: ({ id, etag }: { id: number; etag: string | undefined }) => FaqAPI.Delete(id, etag),
    onSuccess: () => refresh(),
  });
};

export const useMutationRestoreFaqGroup = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: ({ id, etag }: { id: number; etag: string | undefined }) => FaqAPI.Restore(id, etag),
    onSuccess: () => refresh(),
  });
};

// ---- the writes of the FAQ editor (one queue, ETag read from the cache at each turn; see `useAlbumWrites`) ------------------------
const currentEtag = (queryClient: QueryClient, id: number | string) => queryClient.getQueryData<CachedGroup>(faqGroupQueryKey(id))?.etag;

function applyOrder(items: FaqItem[], order: ItemOrderEntry[]): FaqItem[] {
  const rank = new Map(order.map((o) => [o.id, o.sort_order]));
  return items
    .filter((i) => rank.has(i.id))
    .map((i) => ({ ...i, sort_order: rank.get(i.id)! }))
    .sort((a, b) => a.sort_order - b.sort_order);
}

const visibleCount = (items: FaqItem[]) => items.filter((i) => i.is_visible).length;

export function useFaqWrites(groupId: number) {
  const queryClient = useQueryClient();
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const run = useCallback(
    <T,>(task: (etag: string | undefined) => Promise<T>): Promise<T> => {
      const result = chain.current.then(() => task(currentEtag(queryClient, groupId)));
      chain.current = result.catch(() => undefined);
      return result;
    },
    [queryClient, groupId]
  );
  const setItems = useCallback(
    (update: (items: FaqItem[]) => FaqItem[]) =>
      queryClient.setQueryData<CachedItems>(faqItemsQueryKey(groupId), (old) => (old ? { ...old, data: { ...old.data, data: update(old.data.data) } } : old)),
    [queryClient, groupId]
  );
  const stamped = useCallback(
    (aggregate: AggregateStamp, etag: string | undefined) => {
      const items = queryClient.getQueryData<CachedItems>(faqItemsQueryKey(groupId))?.data.data ?? [];
      writeThroughFaqGroup(queryClient, groupId, {
        data: {
          lock_version: aggregate.lock_version,
          status: aggregate.status,
          has_unpublished_changes: aggregate.has_unpublished_changes,
          updated_at: aggregate.updated_at,
          item_count: items.length,
          visible_item_count: visibleCount(items),
        },
        etag: etag ?? `"${aggregate.lock_version}"`,
      });
    },
    [queryClient, groupId]
  );

  return useMemo(
    () => ({
      updateGroup: (payload: UpdateFaqGroupPayload) =>
        run(async (etag) => {
          const response = await FaqAPI.Update(groupId, payload, etag);
          writeThroughFaqGroup(queryClient, groupId, { data: response.data.data, etag: response.etag });
          return response.data.data;
        }),
      addItem: (payload: CreateFaqItemPayload, idempotencyKey?: string) =>
        run(async (etag) => {
          const response = await FaqAPI.CreateItem(groupId, payload, etag, idempotencyKey);
          const { item, order, aggregate } = response.data.data;
          setItems((items) => applyOrder([...items, item], order));
          stamped(aggregate, response.etag);
          return response.data.data;
        }),
      updateItem: (itemId: number, payload: UpdateFaqItemPayload) =>
        run(async (etag) => {
          const response = await FaqAPI.UpdateItem(groupId, itemId, payload, etag);
          const { item, aggregate } = response.data.data;
          setItems((items) => items.map((i) => (i.id === item.id ? item : i)));
          stamped(aggregate, response.etag);
          return response.data.data;
        }),
      deleteItem: (itemId: number) =>
        run(async (etag) => {
          const response = await FaqAPI.DeleteItem(groupId, itemId, etag);
          const { order, aggregate } = response.data.data;
          setItems((items) => applyOrder(items, order));
          stamped(aggregate, response.etag);
          return response.data.data;
        }),
      reorder: (ids: number[]) => {
        const before = queryClient.getQueryData<CachedItems>(faqItemsQueryKey(groupId));
        setItems((items) => ids.map((id, i) => ({ ...items.find((x) => x.id === id)!, sort_order: i })));
        return run(async (etag) => {
          try {
            const response = await FaqAPI.ReorderItems(groupId, ids, etag);
            const { order, aggregate } = response.data.data;
            setItems((items) => applyOrder(items, order));
            stamped(aggregate, response.etag);
            return response.data.data;
          } catch (error) {
            if (before) queryClient.setQueryData(faqItemsQueryKey(groupId), (current: CachedItems | undefined) => (current ? { ...current, data: before.data } : before));
            throw error;
          }
        });
      },
    }),
    [groupId, queryClient, run, setItems, stamped]
  );
}
