import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { WithEtag } from "@/lib/etag";
import { revisionsQueryKey } from "@/lib/revision-resources";
import { PagesAPI } from "@/services/pages.api";
import type { ApiResponse } from "@/types/api";
import type { CreatePagePayload, PageDetail, PagesQuery } from "@/types/pages";

const LIST_KEY = [API_ENDPOINTS.PAGES.LIST] as const;
export const pageQueryKey = (id: number | string) => [API_ENDPOINTS.PAGES.DETAIL(id)] as const;
const TEMPLATES_KEY = [API_ENDPOINTS.PAGE_TEMPLATES.LIST] as const;

// SCR-19: the list (paginated; the trash is `trashed: true`).
export const usePages = (query: PagesQuery, enabled = true) =>
  useQuery({ queryKey: [...LIST_KEY, "list", query], queryFn: () => PagesAPI.List(query), enabled, placeholderData: keepPreviousData });

// One page with the ETag every command sends as `If-Match`.
export const usePage = (id: number | string, enabled = true) =>
  useQuery({ queryKey: pageQueryKey(id), queryFn: () => PagesAPI.Get(id), enabled });

// The 4 templates of the registry (a few KB, rarely changes).
export const usePageTemplates = (enabled = true) =>
  useQuery({ queryKey: TEMPLATES_KEY, queryFn: () => PagesAPI.Templates(), enabled, staleTime: 5 * 60_000 });

type CachedPage = WithEtag<ApiResponse<PageDetail>>;

// A command answers the page in the shape of its own GET plus the NEW ETag: put it in the cache instead of refetching
// (a refetch would only tell the same, and the next write would carry a stale `If-Match` until it arrived). Lists and
// the history are marked stale: a status, a "pending changes" flag and a revision row changed.
export function writeThroughPage(queryClient: QueryClient, id: number | string, result: { data: Partial<PageDetail> | Record<string, unknown>; etag: string | undefined }) {
  if (result.etag) {
    queryClient.setQueryData<CachedPage>(pageQueryKey(id), (old) =>
      old ? { etag: result.etag, data: { ...old.data, data: { ...old.data.data, ...(result.data as Partial<PageDetail>) } } } : old
    );
  }
  void queryClient.invalidateQueries({ queryKey: LIST_KEY });
  void queryClient.invalidateQueries({ queryKey: revisionsQueryKey("pages", id) });
}

function useRefreshLists() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    // The menu editor's and the schema form's page pickers read the same rows.
    void queryClient.invalidateQueries({ queryKey: ["schema-form"] });
    void queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
  };
}

export const useMutationCreatePage = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: CreatePagePayload; idempotencyKey?: string }) => PagesAPI.Create(payload, idempotencyKey),
    onSuccess: () => refresh(),
  });
};

export const useMutationDeletePage = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: ({ id, etag, confirmReferences }: { id: number; etag: string | undefined; confirmReferences?: boolean }) =>
      PagesAPI.Delete(id, etag, { confirmReferences }),
    onSuccess: () => refresh(),
  });
};

export const useMutationRestorePage = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: ({ id, etag }: { id: number; etag: string | undefined }) => PagesAPI.Restore(id, etag),
    onSuccess: () => refresh(),
  });
};

export const useMutationSetHome = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: ({ id, etag, previousHomePath, idempotencyKey }: { id: number; etag: string | undefined; previousHomePath?: string; idempotencyKey?: string }) =>
      PagesAPI.SetHome(id, etag, { previousHomePath, idempotencyKey }),
    onSuccess: () => refresh(),
  });
};

// Who points at the page: asked before a delete (FR-PAGE-07).
export const fetchPageReferences = (id: number) => PagesAPI.References(id);
