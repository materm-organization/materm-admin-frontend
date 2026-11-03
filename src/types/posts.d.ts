// Posts wire types (doc/05-api-spec.md section 13.3; doc/api/openapi-admin.yaml: PostTranslation, PostTranslationPatch,
// PostCategoryRef, PostTagRef, PostMediaItem, PostMediaInput, PostTranslationStatus, PostListItem, PostDetail,
// PostWriteResult, CreatePostRequest, UpdatePostRequest, ReplacePostMediaRequest, PostMediaResult, PostSlugCheck).
// ETag of a post = `"<lock_version>"`; a list row has no ETag header, build it with `postEtag(row)`.
import type { ApiMeta } from "@/types/api";
import type { SaveLiveWarning } from "@/types/media";
import type { PageDraftRef } from "@/types/pages";
import type { SettingsMediaRef } from "@/types/settings";
import type { AggregateStamp, PublishableMeta, PublishedRevisionRef } from "@/types/publishing";

// Tiptap / ProseMirror document JSON, profile `full` (doc/04 section 3.7). Never HTML.
export type PostBody = { type: "doc"; content?: unknown[] } | Record<string, unknown>;

// One language of a post (a map key = the locale code). A row exists only with a title and a slug.
export type PostTranslation = {
  slug: string;
  title: string;
  excerpt?: string | null;
  label?: string | null;
  location_label?: string | null;
  body?: PostBody | null;
  gallery_heading?: string | null;
  gallery_description?: string | null;
  hero_alt?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  og_image_id?: number | null;
  is_enabled?: boolean;
};

// The PATCH form of a translation: every field optional; the whole object `null` = delete that language's row.
export type PostTranslationPatch = Partial<PostTranslation>;

export type PostCategoryRef = { id: number; key: string; name: string | null } | null;
export type PostTagRef = { id: number; key: string; name: string | null };

export type PostMediaTranslation = { alt?: string | null; caption?: string | null };

// A row of the gallery at the end of the article. `id` is reserved already in a draft (03 7.1 item 8).
export type PostMediaItem = {
  id: number;
  media_id: number;
  media: SettingsMediaRef;
  sort_order: number;
  translations: Record<string, PostMediaTranslation>;
};

// What `PUT /posts/{id}/media` takes per row: no `id` = a new row.
export type PostMediaInput = {
  id?: number;
  media_id: number;
  translations?: Record<string, PostMediaTranslation>;
};

export type PostTranslationStatus = {
  enabled: boolean;
  title: boolean;
  excerpt: boolean;
  seo_title: boolean;
  seo_description: boolean;
  body: boolean;
};

export type PostListItem = PublishableMeta & {
  id: number;
  public_id: string;
  title: string | null;
  title_locale: string | null;
  slug: string | null;
  category: PostCategoryRef;
  // The byline (doc/05 15.8): the working copy's author (the draft's when there is one); `author_name` also when the author is in the trash.
  author_id: number | null;
  author_name: string | null;
  tag_count: number;
  hero_media_id: number | null;
  teaser_media_id: number | null;
  is_featured: boolean;
  translation_status: Record<string, PostTranslationStatus>;
  draft: PageDraftRef;
};

export type PostDetail = PostListItem & {
  translations: Record<string, PostTranslation>;
  tag_ids: number[];
  tags: PostTagRef[];
  media: PostMediaItem[];
  missing_locales: string[];
};

export type PostWriteResult = PostDetail & {
  aggregate: AggregateStamp;
  warnings: SaveLiveWarning[];
};

export type PostPublishResult = PostWriteResult & { published_revision: PublishedRevisionRef };
export type PostRestoreResult = PostWriteResult & { restored_from: { revision_id: number; version: number } };

// `DELETE /posts/{id}`: `null` when it was in the trash already.
export type PostDeleteResult = { aggregate: AggregateStamp; warnings: SaveLiveWarning[] } | null;

// `PUT /posts/{id}/media`: NOT the post - the gallery, the post's new stamp and the warnings.
export type PostMediaResult = { media: PostMediaItem[]; aggregate: AggregateStamp; warnings: SaveLiveWarning[] };

export type CreatePostPayload = {
  translations: Record<string, PostTranslation>;
  category_id?: number | null;
  // An active author (422 `author_inactive` / `unknown_reference`).
  author_id?: number | null;
  tag_ids?: number[];
  hero_media_id?: number | null;
  teaser_media_id?: number | null;
  is_featured?: boolean;
  published_at?: string | null;
};

export type UpdatePostPayload = {
  translations?: Record<string, PostTranslationPatch | null>;
  // `{ "<post_media_id>": { "<locale>": { alt, caption } } }`
  media_translations?: Record<string, Record<string, PostMediaTranslation>>;
  category_id?: number | null;
  // `null` clears. Checked only when the value changes (an author switched off later stays on the post).
  author_id?: number | null;
  // Replaces the whole set (<= 10).
  tag_ids?: number[];
  hero_media_id?: number | null;
  teaser_media_id?: number | null;
  is_featured?: boolean;
  published_at?: string | null;
};

export type ReplacePostMediaPayload = { media: PostMediaInput[] };

// `GET /posts/slug-check`: `valid=false` is an answer, not an error.
export type PostSlugCheck = {
  locale: string;
  slug: string;
  normalized: string;
  valid: boolean;
  reason: "format" | "too_long" | null;
  available: boolean;
  conflict: { post_id: number; title: string | null } | null;
  suggestion: string | null;
};

// Query of `GET /posts` (anything else is a 422 `unknown_field`).
export type PostsQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  locale?: string;
  // comma list of statuses
  status?: string;
  category_id?: number;
  // comma list (<= 5): a post with ALL of them
  tag_id?: string;
  created_by?: number;
  published_from?: string;
  published_to?: string;
  has_unpublished_changes?: boolean;
  trashed?: boolean;
  sort?: string;
};

export type PostsList = { data: PostListItem[]; meta: ApiMeta };
