import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { revisionsQueryKey } from "@/lib/revision-resources";
import { AuthorsAPI } from "@/services/authors.api";
import type { AuthorsQuery, CreateAuthorPayload, UpdateAuthorPayload } from "@/types/authors";

export const AUTHORS_LIST_KEY = [API_ENDPOINTS.AUTHORS.LIST] as const;

export const useAuthors = (query: AuthorsQuery, enabled = true) =>
  useQuery({ queryKey: [...AUTHORS_LIST_KEY, query], queryFn: () => AuthorsAPI.List(query), enabled, placeholderData: keepPreviousData });

// A write changes the rows of the list (post counts, trash) and adds a history row; the post editor's author select reads the same list.
function useRefresh() {
  const queryClient = useQueryClient();
  return (id?: number | string) => {
    void queryClient.invalidateQueries({ queryKey: AUTHORS_LIST_KEY });
    if (id !== undefined) {
      void queryClient.invalidateQueries({ queryKey: revisionsQueryKey("authors", id) });
      void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.AUDIT.LIST] });
    }
  };
}

export const useMutationCreateAuthor = () => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: CreateAuthorPayload; idempotencyKey?: string }) => AuthorsAPI.Create(payload, idempotencyKey),
    onSuccess: () => refresh(),
  });
};
export const useMutationUpdateAuthor = () => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, payload, etag }: { id: number; payload: UpdateAuthorPayload; etag: string | undefined }) => AuthorsAPI.Update(id, payload, etag),
    onSuccess: (_r, { id }) => refresh(id),
  });
};
export const useMutationDeleteAuthor = () => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, etag }: { id: number; etag: string | undefined }) => AuthorsAPI.Delete(id, etag),
    onSuccess: (_r, { id }) => refresh(id),
  });
};
export const useMutationRestoreAuthor = () => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, etag }: { id: number; etag: string | undefined }) => AuthorsAPI.Restore(id, etag),
    onSuccess: (_r, { id }) => refresh(id),
  });
};
