import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { revisionsQueryKey } from "@/lib/revision-resources";
import { RedirectsAPI } from "@/services/redirects.api";
import type { CreateRedirectPayload, RedirectCheckPayload, RedirectsExportQuery, RedirectsQuery, UpdateRedirectPayload } from "@/types/redirects";

const LIST_KEY = [API_ENDPOINTS.REDIRECTS.LIST] as const;

export const useRedirects = (query: RedirectsQuery, enabled = true) =>
  useQuery({ queryKey: [...LIST_KEY, query], queryFn: () => RedirectsAPI.List(query), enabled, placeholderData: keepPreviousData });

// The dry run behind the dialog's live feedback. `payload = null` = nothing to check yet.
export const useRedirectCheck = (payload: RedirectCheckPayload | null) =>
  useQuery({
    queryKey: [API_ENDPOINTS.REDIRECTS.CHECK, payload],
    queryFn: ({ signal }) => RedirectsAPI.Check(payload as RedirectCheckPayload, signal),
    enabled: payload !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

// A write changes the rows of the list and adds a history row.
function useRefresh() {
  const queryClient = useQueryClient();
  return (id?: number | string) => {
    void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    // A new / changed redirect changes the answer of the checks of the others.
    void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.REDIRECTS.CHECK] });
    if (id !== undefined) void queryClient.invalidateQueries({ queryKey: revisionsQueryKey("redirects", id) });
  };
}

export const useMutationCreateRedirect = () => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: CreateRedirectPayload; idempotencyKey?: string }) => RedirectsAPI.Create(payload, idempotencyKey),
    onSuccess: () => refresh(),
  });
};
export const useMutationUpdateRedirect = () => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, payload, etag }: { id: number; payload: UpdateRedirectPayload; etag: string | undefined }) => RedirectsAPI.Update(id, payload, etag),
    onSuccess: (_r, { id }) => refresh(id),
  });
};
export const useMutationDeleteRedirect = () => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, etag }: { id: number; etag: string | undefined }) => RedirectsAPI.Delete(id, etag),
    onSuccess: (_r, { id }) => refresh(id),
  });
};
export const useMutationRestoreRedirect = () => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, etag }: { id: number; etag: string | undefined }) => RedirectsAPI.Restore(id, etag),
    onSuccess: (_r, { id }) => refresh(id),
  });
};
export const useMutationExportRedirects = () =>
  useMutation({ mutationFn: (query: RedirectsExportQuery) => RedirectsAPI.Export(query) });
