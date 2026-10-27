"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { z } from "zod";

import {
  type ListParams,
  type ListParamsConfig,
  countActiveFilters,
  parseListParams,
  serializeListParams,
  toApiQuery,
} from "@/lib/list-params";

// URL-synced list state (doc/07 section 2.5.1): `page`, `limit`, `keyword`, `sort` and the page's own filters
// live in the search params. Pass a MODULE-LEVEL `config` (a stable object, see ListParamsConfig). Changing a
// filter, the keyword, the sort or the limit goes back to page 1; every change is a history entry so the back
// button steps through the list states and the link can be shared.
//
// Pages that call this need a <Suspense> boundary above them (`useSearchParams`) — the protected layout has one.
export function useListParams<F extends z.ZodRawShape = z.ZodRawShape>(config: ListParamsConfig<F>) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const search = searchParams.toString();
  const params = useMemo(
    () => parseListParams(config, new URLSearchParams(search)),
    [config, search]
  );

  // Two updates in the same tick (e.g. `setKeyword` + `setSort`) must both survive, so each one builds on the
  // newest params, not on the (not yet updated) URL.
  const latest = useRef(params);
  useEffect(() => {
    latest.current = params;
  }, [params]);

  const commit = useCallback(
    (next: ListParams<F>) => {
      latest.current = next;
      const qs = serializeListParams(config, next).toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [config, pathname, router]
  );

  const setPage = useCallback(
    (page: number) => commit({ ...latest.current, page: Math.max(1, Math.floor(page)) }),
    [commit]
  );
  const setLimit = useCallback(
    (limit: number) => commit({ ...latest.current, limit, page: 1 }),
    [commit]
  );
  const setKeyword = useCallback(
    (keyword: string) => commit({ ...latest.current, keyword: keyword.trim(), page: 1 }),
    [commit]
  );
  const setSort = useCallback(
    (sort: string | undefined) => commit({ ...latest.current, sort, page: 1 }),
    [commit]
  );
  const setFilters = useCallback(
    (patch: Partial<ListParams<F>["filters"]>) =>
      commit({ ...latest.current, filters: { ...latest.current.filters, ...patch }, page: 1 }),
    [commit]
  );
  // Back to the defaults: keeps `limit` and `sort` (view preferences), drops keyword and filters.
  const clearFilters = useCallback(() => {
    const defaults = parseListParams(config, new URLSearchParams());
    commit({
      ...latest.current,
      keyword: "",
      filters: defaults.filters,
      page: 1,
    });
  }, [commit, config]);

  const query = useMemo(() => toApiQuery(params), [params]);
  const activeFilterCount = useMemo(() => countActiveFilters(config, params), [config, params]);

  return {
    params,
    // Normalised object for the service call / React Query key: `[API_ENDPOINTS.X.LIST, query]`.
    query,
    activeFilterCount,
    hasActiveFilters: activeFilterCount > 0,
    setPage,
    setLimit,
    setKeyword,
    setSort,
    setFilters,
    clearFilters,
  };
}

export type UseListParamsResult<F extends z.ZodRawShape = z.ZodRawShape> = ReturnType<
  typeof useListParams<F>
>;
