// Collections wire types (doc/05-api-spec.md section 17; doc/api/openapi-admin.yaml: Collection, CollectionListItem, CreateCollectionRequest,
// UpdateCollectionRequest, CollectionEntry*, ...). A collection DEFINITION is save-live (ETag = its `etag` field, a UTC instant);
// an ENTRY is publishable (ETag = `"<lock_version>"`, e.g. `"4"`).
import type { ApiMeta } from "@/types/api";
import type { JsonSchema, UiSchemaNode } from "@/types/cms";
import type { UserRef } from "@/types/media";
import type { PageDraftRef } from "@/types/pages";
import type { AggregateStamp, PublishableMeta, PublishedRevisionRef } from "@/types/publishing";
import type { SaveLiveWarning } from "@/types/media";

export type CollectionListItem = {
  id: number;
  public_id: string;
  key: string;
  name: string;
  description: string;
  icon: string | null;
  is_active: boolean;
  sort_order: number;
  title_field: string;
  has_slug: boolean;
  schema_version: number;
  // Entries outside the trash / the published ones among them.
  entry_count: number;
  published_entry_count: number;
  created_by: UserRef;
  updated_by: UserRef;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  purge_at: string | null;
  // The ETag of the row (a UTC instant with microseconds, quoted); the list rows carry it too.
  etag: string;
};

export type Collection = CollectionListItem & {
  json_schema: JsonSchema;
  localized_schema: JsonSchema;
  ui_schema: UiSchemaNode;
};

export type CreateCollectionPayload = {
  key: string;
  name: string;
  description?: string;
  icon?: string | null;
  is_active?: boolean;
  sort_order?: number;
  title_field?: string;
  has_slug?: boolean;
  json_schema: JsonSchema;
  localized_schema?: JsonSchema;
  ui_schema?: UiSchemaNode;
};

// PATCH: top-level merge; a schema that is sent REPLACES the old one. `key` is immutable (422 `immutable`).
export type UpdateCollectionPayload = Partial<Omit<CreateCollectionPayload, "key" | "icon">> & { icon?: string | null };

export type CollectionsQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  is_active?: boolean;
  trashed?: boolean;
  sort?: string;
};

// `DELETE /collections/{key}`: `null` when it was in the trash already.
export type CollectionDeleteResult = null;

// 409 INVALID_STATE `details` of a schema change that would break entries (05 17.5).
export type SchemaBreaksEntriesDetails = {
  reason: "schema_breaks_entries";
  checked: number;
  invalid_count: number;
  invalid_entries: Array<{ id: number; path: string; code: string }>;
};

export type CollectionEntryTranslation = {
  title: string;
  slug: string | null;
  data: Record<string, unknown>;
  is_enabled: boolean;
};
export type CollectionEntryTranslationPatch = {
  title?: string;
  slug?: string | null;
  data?: Record<string, unknown>;
  is_enabled?: boolean;
};
export type CollectionEntryTranslationStatus = { enabled: boolean; title: boolean; slug: boolean };

export type CollectionEntryListItem = PublishableMeta & {
  id: number;
  public_id: string;
  collection_key: string;
  title: string | null;
  title_locale: string | null;
  slug: string | null;
  sort_order: number;
  schema_version: number;
  // The collection's schema changed since this entry was last checked (it may no longer pass).
  schema_stale: boolean;
  translation_status: Record<string, CollectionEntryTranslationStatus>;
  draft: PageDraftRef;
};

export type CollectionEntryDetail = CollectionEntryListItem & {
  data: Record<string, unknown>;
  translations: Record<string, CollectionEntryTranslation>;
  missing_locales: string[];
};

export type CollectionEntryWriteResult = CollectionEntryDetail & { aggregate: AggregateStamp; warnings: SaveLiveWarning[] };
export type CollectionEntryPublishResult = CollectionEntryWriteResult & { published_revision: PublishedRevisionRef };
export type CollectionEntryRestoreResult = CollectionEntryWriteResult & { restored_from: { revision_id: number; version: number } };
export type CollectionEntryDeleteResult = { aggregate: AggregateStamp; warnings: SaveLiveWarning[] } | null;

export type CreateCollectionEntryPayload = {
  sort_order?: number;
  data?: Record<string, unknown>;
  translations: Record<string, { title: string; slug?: string | null; data?: Record<string, unknown>; is_enabled?: boolean }>;
};
export type UpdateCollectionEntryPayload = {
  sort_order?: number;
  data?: Record<string, unknown>;
  // `null` removes the row of that language (the default language can not be removed).
  translations?: Record<string, CollectionEntryTranslationPatch | null>;
};

export type CollectionEntriesQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  locale?: string;
  status?: string;
  has_unpublished_changes?: boolean;
  trashed?: boolean;
  sort?: string;
};

export type CollectionsList = { data: CollectionListItem[]; meta: ApiMeta };
