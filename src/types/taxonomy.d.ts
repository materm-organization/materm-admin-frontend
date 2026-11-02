// Blog categories and tags (doc/05-api-spec.md section 11.5, doc/api/openapi-admin.yaml: Category, Tag,
// CategoryTranslation, TagTranslation, Create/Update requests). Save-live + soft delete (30 days in the trash).
// ETag = `"<updated_at>"` (microseconds, UTC). A list row carries it as `etag` (use `etagOfRow`, services/media.api.ts, which falls back
// to `updated_at` shifted to UTC: the row's own `updated_at` carries the server's +07:00 offset, which is now the normal case).
import type { ApiMeta } from "@/types/api";
import type { SaveLiveWarning, UserRef } from "@/types/media";

export type CategoryTranslation = { name: string; slug?: string; description?: string | null };
export type TagTranslation = { name: string; slug?: string };

type Common = {
  id: number;
  public_id: string;
  // Immutable after creation (422 `immutable`).
  key: string;
  post_count: number;
  // Of those, `published` + `scheduled`: a category with any can not be deleted (409 `ENTITY_REFERENCED`).
  published_post_count: number;
  created_by?: UserRef;
  updated_by?: UserRef;
  created_at: string;
  updated_at: string;
  // On list rows and single reads (the ETag of the row, quoted).
  etag?: string;
  deleted_at?: string | null;
  purge_at?: string | null;
  // Only on the answer of a write.
  warnings?: SaveLiveWarning[];
};

export type Category = Common & {
  sort_order: number;
  is_active: boolean;
  translations: Record<string, CategoryTranslation>;
};

export type Tag = Common & {
  translations: Record<string, TagTranslation>;
};

export type TaxonomyKind = "categories" | "tags";

export type CategoriesQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  trashed?: boolean;
  is_active?: boolean;
  sort?: string;
};

export type TagsQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  trashed?: boolean;
  unused?: boolean;
  sort?: string;
};

export type CreateCategoryPayload = {
  key: string;
  sort_order?: number;
  is_active?: boolean;
  translations: Record<string, CategoryTranslation>;
};

// Partial; `translations`: `{ en: null }` deletes the English text (never the default language).
export type UpdateCategoryPayload = {
  sort_order?: number;
  is_active?: boolean;
  translations?: Record<string, CategoryTranslation | null>;
};

export type CreateTagPayload = { key: string; translations: Record<string, TagTranslation> };
export type UpdateTagPayload = { translations: Record<string, TagTranslation | null> };

export type TaxonomyListMeta = ApiMeta;
