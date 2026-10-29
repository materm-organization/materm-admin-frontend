// Albums wire types (doc/05-api-spec.md section 13.4; doc/api/openapi-admin.yaml: AlbumTranslation, AlbumTranslationPatch,
// AlbumItemTranslation, AlbumTranslationStatus, AlbumListItem, AlbumDetail, AlbumWriteResult, AlbumItem, CreateAlbumRequest,
// UpdateAlbumRequest, CreateAlbumItemsRequest, UpdateAlbumItemRequest, AlbumItemsCreateResult, AlbumItemWriteResult).
// ETag of an album = `"<lock_version>"`; every item command sends it as `If-Match` and answers a new one.
import type { ApiMeta } from "@/types/api";
import type { SaveLiveWarning } from "@/types/media";
import type { PageDraftRef } from "@/types/pages";
import type { AggregateStamp, PublishableMeta, PublishedRevisionRef } from "@/types/publishing";
import type { SettingsMediaRef } from "@/types/settings";

export type AlbumTranslation = { title: string; description?: string | null };
// The PATCH form of a translation: every field optional; the whole object `null` = delete that language's row.
export type AlbumTranslationPatch = Partial<AlbumTranslation>;
export type AlbumItemTranslation = { caption_title?: string | null; caption_description?: string | null; alt?: string | null };

export type AlbumTranslationStatus = { enabled: boolean; title: boolean; description: boolean };

export type AlbumListItem = PublishableMeta & {
  id: number;
  public_id: string;
  key: string;
  title: string | null;
  title_locale: string | null;
  cover_media: SettingsMediaRef | null;
  item_count: number;
  // How many sections use the album (shown as "Used in").
  usage_count: number;
  translation_status: Record<string, AlbumTranslationStatus>;
  draft: PageDraftRef;
};

export type AlbumDetail = AlbumListItem & {
  cover_media_id: number | null;
  translations: Record<string, AlbumTranslation>;
  missing_locales: string[];
};

export type AlbumWriteResult = AlbumDetail & { aggregate: AggregateStamp; warnings: SaveLiveWarning[] };
export type AlbumPublishResult = AlbumWriteResult & { published_revision: PublishedRevisionRef };
export type AlbumRestoreResult = AlbumWriteResult & { restored_from: { revision_id: number; version: number } };

// `DELETE /albums/{id}`: `null` when it was in the trash already.
export type AlbumDeleteResult = { aggregate: AggregateStamp; warnings: SaveLiveWarning[] } | null;

export type AlbumItem = {
  id: number;
  public_id: string;
  media_id: number;
  media: SettingsMediaRef;
  sort_order: number;
  layout_hint: string | null;
  translations: Record<string, AlbumItemTranslation>;
  // A `photo_story` slot uses this picture (live or draft).
  in_use: boolean;
  usage_count: number;
};

export type ItemOrderEntry = { id: number; sort_order: number };

export type AlbumItemsCreateResult = { items: AlbumItem[]; order: ItemOrderEntry[]; aggregate: AggregateStamp; warnings: SaveLiveWarning[] };
export type AlbumItemWriteResult = { item: AlbumItem; aggregate: AggregateStamp; warnings: SaveLiveWarning[] };
// `DELETE .../items/{itemId}`.
export type AlbumItemDeleteResult = { order: ItemOrderEntry[]; aggregate: AggregateStamp; warnings: SaveLiveWarning[] };
// `PUT .../items/order`.
export type AlbumOrderResult = { order: ItemOrderEntry[]; aggregate: AggregateStamp };

export type CreateAlbumPayload = { key: string; translations: Record<string, AlbumTranslation>; cover_media_id?: number | null };
export type UpdateAlbumPayload = { translations?: Record<string, AlbumTranslationPatch | null>; cover_media_id?: number | null };
export type CreateAlbumItemInput = { media_id: number; layout_hint?: string | null; translations?: Record<string, AlbumItemTranslation> };
export type CreateAlbumItemsPayload = { items: CreateAlbumItemInput[]; position?: number };
export type UpdateAlbumItemPayload = {
  media_id?: number;
  layout_hint?: string | null;
  // merge per language; `null` removes that language's row
  translations?: Record<string, AlbumItemTranslation | null>;
};

// Query of `GET /albums` (anything else is a 422 `unknown_field`).
export type AlbumsQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  locale?: string;
  status?: string;
  has_unpublished_changes?: boolean;
  trashed?: boolean;
  sort?: string;
};

export type AlbumsList = { data: AlbumListItem[]; meta: ApiMeta };
