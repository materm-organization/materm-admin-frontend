// Authors = the byline of a post (doc/05 section 15, doc/api/openapi-admin.yaml: Author, CreateAuthorRequest, UpdateAuthorRequest).
// Save-live + soft delete (30 days in the trash), key `cms.blog`. ETag = `"<updated_at>"` in UTC micros (a list row carries it as `etag`).
import type { SaveLiveWarning, UserRef } from "@/types/media";

export type AuthorTranslation = { bio: string | null; job_title: string | null };

export type AuthorUserRef = { id: number; name: string; username: string };

export type AuthorAvatar = {
  id: number;
  status: string;
  original_filename: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  // `null` while the server has no media URL base.
  url: string | null;
};

export type Author = {
  id: number;
  public_id: string;
  display_name: string;
  user_id: number | null;
  user: AuthorUserRef | null;
  avatar_media_id: number | null;
  avatar: AuthorAvatar | null;
  is_active: boolean;
  // Only the languages that have a bio or a job title.
  translations: Record<string, Partial<AuthorTranslation>>;
  // Posts that are not in the trash / of those the published or scheduled ones.
  post_count: number;
  published_post_count: number;
  created_by?: UserRef;
  updated_by?: UserRef;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  purge_at: string | null;
  etag?: string;
  // Only on the answer of a write.
  warnings?: SaveLiveWarning[];
};

export type AuthorsQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  is_active?: boolean;
  has_user?: boolean;
  trashed?: boolean;
  sort?: string;
};

// A member `null` clears it; the whole language `null` deletes it (never sent by a translator).
export type AuthorTranslationInput = { bio?: string | null; job_title?: string | null };

export type CreateAuthorPayload = {
  display_name: string;
  user_id?: number | null;
  avatar_media_id?: number | null;
  is_active?: boolean;
  translations?: Record<string, AuthorTranslationInput>;
};

export type UpdateAuthorPayload = {
  display_name?: string;
  user_id?: number | null;
  avatar_media_id?: number | null;
  is_active?: boolean;
  translations?: Record<string, AuthorTranslationInput | null>;
};

// The flat snapshot of a revision (doc/05 15.4).
export type AuthorSnapshot = {
  author: { display_name: string; user_id: number | null; avatar_media_id: number | null; is_active: boolean };
  translations: Array<{ locale_code: string; bio: string | null; job_title: string | null }>;
};

// 409 `ENTITY_REFERENCED` of a delete (doc/05 15.5).
export type AuthorHasPostsDetails = { reason: "author_has_posts"; post_count: number };
