import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { WithEtag } from "@/lib/etag";
import { revisionsQueryKey } from "@/lib/revision-resources";
import { PostsAPI } from "@/services/posts.api";
import type { ApiResponse } from "@/types/api";
import type { CreatePostPayload, PostDetail, PostsQuery, ReplacePostMediaPayload, UpdatePostPayload } from "@/types/posts";

const LIST_KEY = [API_ENDPOINTS.POSTS.LIST] as const;
export const postQueryKey = (id: number | string) => [API_ENDPOINTS.POSTS.DETAIL(id)] as const;

// SCR-24: the list (paginated; the trash is `trashed: true`).
export const usePosts = (query: PostsQuery, enabled = true) =>
  useQuery({ queryKey: [...LIST_KEY, "list", query], queryFn: () => PostsAPI.List(query), enabled, placeholderData: keepPreviousData });

// One post with the ETag every command sends as `If-Match`.
export const usePost = (id: number | string, enabled = true) =>
  useQuery({ queryKey: postQueryKey(id), queryFn: () => PostsAPI.Get(id), enabled });

type CachedPost = WithEtag<ApiResponse<PostDetail>>;

// A command answers the post in the shape of its own GET plus the NEW ETag: put it in the cache instead of refetching (a
// refetch would only tell the same, and the next write would carry a stale `If-Match` until it arrived). Lists, the history
// and the schema form's post picker are marked stale: a status, a "pending changes" flag and a revision row changed.
export function writeThroughPost(queryClient: QueryClient, id: number | string, result: { data: Partial<PostDetail> | Record<string, unknown>; etag: string | undefined }) {
  if (result.etag) {
    queryClient.setQueryData<CachedPost>(postQueryKey(id), (old) =>
      old ? { etag: result.etag, data: { ...old.data, data: { ...old.data.data, ...(result.data as Partial<PostDetail>) } } } : old
    );
  }
  void queryClient.invalidateQueries({ queryKey: LIST_KEY });
  void queryClient.invalidateQueries({ queryKey: revisionsQueryKey("posts", id) });
}

function useRefreshLists() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    // The categories / tags screens show how many posts use them; the schema form's post picker reads the same rows.
    void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.CATEGORIES.LIST] });
    void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.TAGS.LIST] });
    void queryClient.invalidateQueries({ queryKey: ["schema-form"] });
  };
}

export const useMutationCreatePost = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: CreatePostPayload; idempotencyKey?: string }) => PostsAPI.Create(payload, idempotencyKey),
    onSuccess: () => refresh(),
  });
};

export const useMutationDeletePost = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: ({ id, etag }: { id: number; etag: string | undefined }) => PostsAPI.Delete(id, etag),
    onSuccess: () => refresh(),
  });
};

export const useMutationRestorePost = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: ({ id, etag }: { id: number; etag: string | undefined }) => PostsAPI.Restore(id, etag),
    onSuccess: () => refresh(),
  });
};

// ---- the writes of the post editor -----------------------------------------------------------------------------------------
// They run ONE AT A TIME (a chain of promises) and each reads the post's ETag from the cache when its turn comes, so a PATCH and
// the PUT of the gallery that follows it never send the same stale `If-Match`. Every success puts the answer's NEW ETag into the
// cache (no refetch). Errors are the caller's (409 `CONFLICT_LOCK_VERSION` -> ConflictDialog, 409 `CONFLICT_DUPLICATE` -> the slug).
const currentEtag = (queryClient: QueryClient, postId: number | string) => queryClient.getQueryData<CachedPost>(postQueryKey(postId))?.etag;

export function usePostWrites(postId: number) {
  const queryClient = useQueryClient();
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const run = useCallback(
    <T,>(task: (etag: string | undefined) => Promise<T>): Promise<T> => {
      const result = chain.current.then(() => task(currentEtag(queryClient, postId)));
      chain.current = result.catch(() => undefined);
      return result;
    },
    [queryClient, postId]
  );

  return useMemo(
    () => ({
      // PATCH: the answer IS the post (with its new ETag).
      updatePost: (payload: UpdatePostPayload) =>
        run(async (etag) => {
          const response = await PostsAPI.Update(postId, payload, etag);
          writeThroughPost(queryClient, postId, { data: response.data.data, etag: response.etag });
          return response.data.data;
        }),
      // PUT of the gallery: the answer is NOT the post, only its gallery and stamp. The post's cache gets the gallery and the stamp.
      replaceMedia: (payload: ReplacePostMediaPayload) =>
        run(async (etag) => {
          const response = await PostsAPI.ReplaceMedia(postId, payload, etag);
          const { media, aggregate } = response.data.data;
          writeThroughPost(queryClient, postId, {
            data: { media, lock_version: aggregate.lock_version, status: aggregate.status, has_unpublished_changes: aggregate.has_unpublished_changes, updated_at: aggregate.updated_at },
            etag: response.etag ?? `"${aggregate.lock_version}"`,
          });
          return response.data.data;
        }),
    }),
    [postId, queryClient, run]
  );
}
