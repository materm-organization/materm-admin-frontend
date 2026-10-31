import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { WithEtag } from "@/lib/etag";
import { SUBMISSION_GC_TIME } from "@/lib/submissions";
import { SubmissionsAPI } from "@/services/submissions.api";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type {
  BulkStatusItem,
  BulkStatusResult,
  SubmissionDetail,
  SubmissionListItem,
  SubmissionNote,
  SubmissionStatus,
  SubmissionsExportQuery,
  SubmissionsQuery,
} from "@/types/submissions";

// Personal data: nothing here lives in the cache for more than a minute after the last screen that used it, and nothing is put in
// storage (doc/07 3.20). The summary has only counts, so it keeps the default.
const LIST_KEY = [API_ENDPOINTS.SUBMISSIONS.LIST] as const;
const SUMMARY_KEY = [API_ENDPOINTS.SUBMISSIONS.SUMMARY] as const;
export const submissionQueryKey = (id: number | string, createdAt?: string) => [API_ENDPOINTS.SUBMISSIONS.DETAIL(id), createdAt ?? ""] as const;

export const useSubmissions = (query: SubmissionsQuery, enabled = true) =>
  useQuery({
    queryKey: [...LIST_KEY, "list", query],
    queryFn: () => SubmissionsAPI.List(query),
    enabled,
    placeholderData: keepPreviousData,
    gcTime: SUBMISSION_GC_TIME,
  });

// The badge of the sidebar, the chips of the inbox and the dashboard card: `new` (spam not counted). Polled every minute.
export const useSubmissionsSummary = (enabled = true) =>
  useQuery({ queryKey: SUMMARY_KEY, queryFn: () => SubmissionsAPI.Summary(), enabled, refetchInterval: 60_000, staleTime: 15_000 });

export const useSubmission = (id: number | string, createdAt?: string, enabled = true) =>
  useQuery({ queryKey: submissionQueryKey(id, createdAt), queryFn: () => SubmissionsAPI.Get(id, createdAt), enabled, gcTime: SUBMISSION_GC_TIME });

type CachedSubmission = WithEtag<ApiResponse<SubmissionDetail>>;

function refreshAfterStatus(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: LIST_KEY });
  void queryClient.invalidateQueries({ queryKey: SUMMARY_KEY });
  // The forms list shows "new messages" per form; the dashboard card shows the same count.
  void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.FORMS.LIST] });
  void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.DASHBOARD.SUMMARY] });
}

// PATCH answers a LIST ITEM (status, handled_by, handled_at, notes_count ...): merge it into the cached detail and keep `fields`,
// `extra` and `notes`. The answer's ETag replaces the cached one.
export function mergeStatusAnswer(queryClient: QueryClient, id: number | string, createdAt: string | undefined, answer: { data: SubmissionListItem; etag: string | undefined }) {
  queryClient.setQueryData<CachedSubmission>(submissionQueryKey(id, createdAt), (old) =>
    old ? { etag: answer.etag ?? old.etag, data: { ...old.data, data: { ...old.data.data, ...answer.data } } } : old
  );
}

export const useMutationSetSubmissionStatus = (createdAt?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, etag }: { id: number; status: SubmissionStatus; etag?: string }) => SubmissionsAPI.SetStatus(id, status, createdAt, etag),
    onSuccess: (answer, { id }) => {
      mergeStatusAnswer(queryClient, id, createdAt, { data: answer.data.data, etag: answer.etag });
      refreshAfterStatus(queryClient);
    },
  });
};

// The rows come from the list: each carries its own `etag`, which is sent as it is (no detail is read first).
export type BulkRow = Pick<SubmissionListItem, "id" | "etag">;

export const useMutationBulkSubmissionStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ rows, status }: { rows: BulkRow[]; status: SubmissionStatus }): Promise<BulkStatusResult> => {
      const items: BulkStatusItem[] = rows.map((r) => ({ id: r.id, etag: r.etag }));
      return SubmissionsAPI.BulkStatus({ items, status });
    },
    onSuccess: (result) => {
      const touched = new Set([...result.updated.map((u) => u.id), ...result.skipped.filter((s) => s.reason === "stale").map((s) => s.id)]);
      // The rows of the cached lists get the new status and ETag at once (a stale row keeps its old one until the reload below).
      const updatedById = new Map(result.updated.map((u) => [u.id, u]));
      queryClient.setQueriesData<ApiResponsePagination<SubmissionListItem[]>>({ queryKey: LIST_KEY }, (old) =>
        old && Array.isArray(old.data)
          ? { ...old, data: old.data.map((r) => { const u = updatedById.get(r.id); return u ? { ...r, status: u.status, etag: u.etag } : r; }) }
          : old
      );
      // The new ETag of a changed row is kept right away, so the next write from an open detail does not conflict with our own change.
      const etagOfUpdated = new Map(result.updated.map((u) => [u.id, u]));
      queryClient.setQueriesData<CachedSubmission>({ predicate: (q) => detailId(q.queryKey) !== null && etagOfUpdated.has(detailId(q.queryKey) as number) }, (old) => {
        const u = old ? etagOfUpdated.get(old.data.data.id) : undefined;
        return old && u ? { etag: u.etag, data: { ...old.data, data: { ...old.data.data, status: u.status } } } : old;
      });
      // Detail screens of changed or stale rows reload (handled_by, handled_at, current status); the others stay.
      void queryClient.invalidateQueries({ predicate: (q) => {
        const id = detailId(q.queryKey);
        return id !== null && touched.has(id);
      } });
      refreshAfterStatus(queryClient);
    },
  });
};

const detailId = (queryKey: readonly unknown[]): number | null => {
  const m = /^\/submissions\/(\d+)$/.exec(String(queryKey[0]));
  return m ? Number(m[1]) : null;
};

// A note is appended to the cached detail; it does not change the ETag nor the status.
export const useMutationAddSubmissionNote = (createdAt?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note, idempotencyKey }: { id: number; note: string; idempotencyKey?: string }) => SubmissionsAPI.AddNote(id, note, createdAt, idempotencyKey),
    onSuccess: (note: SubmissionNote, { id }) => {
      queryClient.setQueryData<CachedSubmission>(submissionQueryKey(id, createdAt), (old) =>
        old ? { ...old, data: { ...old.data, data: { ...old.data.data, notes: [...old.data.data.notes, note], notes_count: old.data.data.notes_count + 1 } } } : old
      );
      void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
};

export const useMutationExportSubmissions = () =>
  useMutation({
    mutationFn: (query: SubmissionsExportQuery) => SubmissionsAPI.Export(query),
    // The file lives in the caller's hands only.
    gcTime: 0,
  });
