import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { WithEtag } from "@/lib/etag";
import { revisionsQueryKey } from "@/lib/revision-resources";
import { pageQueryKey, writeThroughPage } from "@/hooks/use-pages";
import { PageSectionsAPI, PagesAPI } from "@/services/pages.api";
import type { ApiResponse } from "@/types/api";
import type {
  CreateSectionPayload,
  PageDetail,
  PageSection,
  SectionOrder,
  SectionSummary,
  UpdatePagePayload,
  UpdateSectionPayload,
} from "@/types/pages";
import type { AggregateStamp } from "@/types/publishing";

// The sections of a page with their props (05 12.5.3, `include=props`) - the one list the section list and the editor
// read. The FIRST element of the key is the sections URL on purpose: `writeThroughPage` invalidates the key prefix
// `["/pages"]`, which must not refetch this list after every write.
export const pageSectionsKey = (pageId: number | string) => [API_ENDPOINTS.PAGES.SECTIONS(pageId)] as const;

type CachedSections = WithEtag<ApiResponse<SectionSummary[]>>;
type CachedPage = WithEtag<ApiResponse<PageDetail>>;

export const usePageSections = (pageId: number | string, enabled = true) =>
  useQuery({ queryKey: pageSectionsKey(pageId), queryFn: () => PageSectionsAPI.List(pageId), enabled });

// The page's ETag as the cache holds it NOW (a write reads it when it starts, never from a render closure: two writes
// in a row must not both carry the one the first replaced).
const currentEtag = (queryClient: QueryClient, pageId: number | string) => queryClient.getQueryData<CachedPage>(pageQueryKey(pageId))?.etag;

// What a section write tells about the page (`aggregate`) and its new ETag go into the page's cache; the page itself is
// NOT in the answer, so nothing else of it is touched (its translations, title ... stay as they are). A page fetch is
// not needed: the next write carries this ETag.
function stampPage(queryClient: QueryClient, pageId: number | string, etag: string | undefined, aggregate: AggregateStamp, sectionCount?: number) {
  queryClient.setQueryData<CachedPage>(pageQueryKey(pageId), (old) =>
    old
      ? {
          etag: etag ?? `"${aggregate.lock_version}"`,
          data: {
            ...old.data,
            data: {
              ...old.data.data,
              lock_version: aggregate.lock_version,
              status: aggregate.status,
              has_unpublished_changes: aggregate.has_unpublished_changes,
              updated_at: aggregate.updated_at,
              ...(sectionCount !== undefined ? { section_count: sectionCount } : {}),
            },
          },
        }
      : old
  );
}

export type SectionWrite = {
  etag: string | undefined;
  aggregate: AggregateStamp;
  // The order of ALL sections after the write.
  order: SectionOrder[];
  // The section that was created / changed (with its props).
  section?: PageSection;
  removedId?: number;
};

// Puts a section write into the caches: the new ETag + stamp on the page, the section and the new order in the list.
export function applySectionWrite(queryClient: QueryClient, pageId: number | string, write: SectionWrite) {
  stampPage(queryClient, pageId, write.etag, write.aggregate, write.order.length);
  queryClient.setQueryData<CachedSections>(pageSectionsKey(pageId), (old) => {
    if (!old) return old;
    const byId = new Map<number, SectionSummary>(old.data.data.map((s) => [s.id, s]));
    if (write.removedId !== undefined) byId.delete(write.removedId);
    if (write.section) byId.set(write.section.id, write.section);
    const rows = write.order
      .map((o) => {
        const row = byId.get(o.id);
        return row ? { ...row, public_id: o.public_id, sort_order: o.sort_order } : undefined;
      })
      .filter((row): row is SectionSummary => Boolean(row));
    return { etag: old.etag, data: { ...old.data, data: rows } };
  });
  // The page list shows the pending-changes flag and the section count; the History has a checkpoint now.
  void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.PAGES.LIST] });
  void queryClient.invalidateQueries({ queryKey: revisionsQueryKey("pages", pageId) });
}

// The writes of the page editor. They run ONE AT A TIME (a chain of promises) and each reads the page's ETag when its
// turn comes, so a hide toggle clicked twice, or a reorder right after a save, never sends a stale `If-Match`; every
// success puts the answer's NEW ETag into the cache (no refetch). Errors are the caller's (409 -> ConflictDialog).
export function usePageWrites(pageId: number) {
  const queryClient = useQueryClient();
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const run = useCallback(
    <T>(task: (etag: string | undefined) => Promise<T>): Promise<T> => {
      const result = chain.current.then(() => task(currentEtag(queryClient, pageId)));
      chain.current = result.catch(() => undefined);
      return result;
    },
    [queryClient, pageId]
  );

  return useMemo(
    () => ({
      createSection: (payload: CreateSectionPayload, idempotencyKey?: string) =>
        run(async (etag) => {
          const response = await PageSectionsAPI.Create(pageId, payload, etag, idempotencyKey);
          const result = response.data.data;
          applySectionWrite(queryClient, pageId, { etag: response.etag, aggregate: result.aggregate, order: result.sections, section: result.section });
          return result;
        }),
      updateSection: (sectionId: number, payload: UpdateSectionPayload) =>
        run(async (etag) => {
          const response = await PageSectionsAPI.Update(pageId, sectionId, payload, etag);
          const result = response.data.data;
          applySectionWrite(queryClient, pageId, { etag: response.etag, aggregate: result.aggregate, order: result.sections, section: result.section });
          return result;
        }),
      reorderSections: (ids: number[]) =>
        run(async (etag) => {
          const response = await PageSectionsAPI.Reorder(pageId, ids, etag);
          const result = response.data.data;
          applySectionWrite(queryClient, pageId, { etag: response.etag, aggregate: result.aggregate, order: result.sections });
          return result;
        }),
      deleteSection: (sectionId: number) =>
        run(async (etag) => {
          const response = await PageSectionsAPI.Delete(pageId, sectionId, etag);
          const result = response.data.data;
          applySectionWrite(queryClient, pageId, { etag: response.etag, aggregate: result.aggregate, order: result.sections, removedId: sectionId });
          return result;
        }),
      // The details / SEO tabs: the answer IS the page (with its new ETag), cached like every page command.
      updatePage: (payload: UpdatePagePayload) =>
        run(async (etag) => {
          const response = await PagesAPI.Update(pageId, payload, etag);
          const result = response.data.data;
          writeThroughPage(queryClient, pageId, { data: result, etag: response.etag });
          // A new template changes which sections are required: read the list again.
          if (payload.template !== undefined) void queryClient.invalidateQueries({ queryKey: pageSectionsKey(pageId) });
          return result;
        }),
    }),
    [pageId, queryClient, run]
  );
}

// Reads the sections again and WAITS for them: after a discard / restore the forms are re-seeded from the list, which
// must already hold the new props.
export const refetchPageSections = (queryClient: QueryClient, pageId: number | string) =>
  queryClient.refetchQueries({ queryKey: pageSectionsKey(pageId) });
