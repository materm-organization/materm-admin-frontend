import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatchHeaders, withEtag } from "@/lib/etag";
import { idempotencyKeyHeaders } from "@/lib/idempotency";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type {
  CreatePostPayload,
  PostDeleteResult,
  PostDetail,
  PostListItem,
  PostMediaResult,
  PostSlugCheck,
  PostWriteResult,
  PostsQuery,
  ReplacePostMediaPayload,
  UpdatePostPayload,
} from "@/types/posts";

// The ETag of a post is `"<lock_version>"` (doc/05 13.3.9); a list row has no ETag header, so build it from the row.
export const postEtag = (row: { lock_version: number }) => `"${row.lock_version}"`;

// Posts (doc/05 section 13.3). Every write sends `If-Match` (428 without it); the answer carries the new ETag.
export const PostsAPI = {
  List: async (query: PostsQuery = {}) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<PostListItem[]>>(API_ENDPOINTS.POSTS.LIST, { params: query });
    return data;
  },
  Get: async (id: number | string) => withEtag(await axiosInstance.get<ApiResponse<PostDetail>>(API_ENDPOINTS.POSTS.DETAIL(id))),
  // 201 + `ETag: "1"`; opt-in `Idempotency-Key`. 409 `CONFLICT_DUPLICATE` at `/translations/<l>/slug` (`params.suggestion`).
  Create: async (payload: CreatePostPayload, idempotencyKey?: string) =>
    withEtag(
      await axiosInstance.post<ApiResponse<PostWriteResult>>(API_ENDPOINTS.POSTS.LIST, payload, { headers: idempotencyKeyHeaders(idempotencyKey) })
    ),
  // 05 13.3.3: partial, `If-Match` mandatory; a change that alters nothing answers 200 with the same ETag.
  Update: async (id: number | string, payload: UpdatePostPayload, etag: string | undefined) =>
    withEtag(await axiosInstance.patch<ApiResponse<PostWriteResult>>(API_ENDPOINTS.POSTS.DETAIL(id), payload, { headers: ifMatchHeaders(etag, { required: true }) })),
  // Soft delete (30 days in the trash). A published post leaves `published` first; `post_referenced` is a warning, not a 409.
  Delete: async (id: number | string, etag: string | undefined) =>
    withEtag(await axiosInstance.delete<ApiResponse<PostDeleteResult>>(API_ENDPOINTS.POSTS.DETAIL(id), { headers: ifMatchHeaders(etag, { required: true }) })),
  Restore: async (id: number | string, etag: string | undefined) =>
    withEtag(await axiosInstance.post<ApiResponse<PostWriteResult>>(API_ENDPOINTS.POSTS.RESTORE(id), undefined, { headers: ifMatchHeaders(etag, { required: true }) })),
  // The gallery at the end of the article, the WHOLE set (<= 60). The answer is the gallery + the post's stamp, not the post.
  ReplaceMedia: async (id: number | string, payload: ReplacePostMediaPayload, etag: string | undefined) =>
    withEtag(await axiosInstance.put<ApiResponse<PostMediaResult>>(API_ENDPOINTS.POSTS.MEDIA(id), payload, { headers: ifMatchHeaders(etag, { required: true }) })),
  // `valid=false` is an answer (200), not an error. Checks the real rows of the other posts only.
  SlugCheck: async (query: { locale: string; slug: string; post_id?: number }) => {
    const { data } = await axiosInstance.get<ApiResponse<PostSlugCheck>>(API_ENDPOINTS.POSTS.SLUG_CHECK, { params: query });
    return data.data;
  },
};
