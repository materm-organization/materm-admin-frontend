// Media library wire types (doc/05-api-spec.md section 11.6, doc/api/openapi-admin.yaml: MediaAsset,
// MediaAssetDetail, MediaFolder, MediaUsage). P1 has no upload: the rows are the seeded `static/...` assets.
import type { ApiMeta } from "@/types/api";

export type UserRef = { id: number; name: string | null } | null;

export type MediaKind = "image" | "video" | "audio" | "document" | "brand" | "other";
export type MediaStatus = "uploading" | "processing" | "ready" | "failed" | "quarantined";
export type MediaSource = "static" | "file_service";

// `{x, y}` 0..1 with at most 3 decimals, or null (no focal point set).
export type MediaFocal = { x: number; y: number } | null;

export type MediaAssetTranslation = {
  // "" = no alt text (the DB column is NOT NULL default '').
  alt?: string;
  caption?: string | null;
  credit?: string | null;
};

export type MediaFolderRef = { id: number; name: string; path: string } | null;

export type SaveLiveWarning = {
  path: string;
  code: string;
  message?: string;
  params?: Record<string, unknown>;
};

// List rows and the detail share this shape; the detail adds `folder` + `variants`. `warnings` only comes back
// with a write. The list carries no ETag: build it from `updated_at` (`"<updated_at>"`, doc/05 11.1.1).
export type MediaAsset = {
  id: number;
  public_id: string;
  folder_id: number | null;
  kind: MediaKind;
  status: MediaStatus;
  error_message?: string | null;
  source: MediaSource;
  original_filename: string;
  mime_type: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  focal: MediaFocal;
  is_decorative: boolean;
  dominant_color?: string | null;
  blurhash?: string | null;
  checksum_sha256?: string | null;
  // null when `media.staticBaseUrl` is not configured: the UI shows a placeholder tile.
  url: string | null;
  translations: Record<string, MediaAssetTranslation>;
  usage_count: number;
  created_by?: UserRef;
  updated_by?: UserRef;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  purge_at?: string | null;
  warnings?: SaveLiveWarning[];
};

export type MediaAssetDetail = MediaAsset & {
  folder: MediaFolderRef;
  variants: unknown[];
};

export type MediaFolder = {
  id: number;
  public_id: string;
  parent_id: number | null;
  name: string;
  sort_order: number;
  depth: number;
  path: string;
  asset_count: number;
  child_count: number;
  etag: string;
  created_by?: UserRef;
  updated_by?: UserRef;
  created_at: string;
  updated_at: string;
};

export type MediaUsage = {
  entity_type: string;
  id: number;
  title?: string | null;
  // JSON Pointer inside the owner aggregate.
  field: string;
  status?: string | null;
  in_draft_only: boolean;
};

// 409 MEDIA_IN_USE `details` (usage in live data) / 409 ENTITY_REFERENCED `details` (draft-only references).
export type MediaInUseDetails = {
  usages?: Array<Pick<MediaUsage, "entity_type" | "id" | "title" | "field">>;
  total_usages?: number;
  references?: Array<Pick<MediaUsage, "entity_type" | "id" | "title" | "field">>;
  total_references?: number;
};

export type MediaListSort =
  | "-created_at"
  | "created_at"
  | "original_filename"
  | "-original_filename"
  | "bytes"
  | "-bytes"
  | "updated_at"
  | "-updated_at"
  | "deleted_at"
  | "-deleted_at";

// Query of `GET /media/assets` (the API rejects anything else with 422 `unknown_field`). `ids` cannot be
// combined with a filter.
export type MediaListQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  sort?: string;
  ids?: string;
  // A folder id, or "root" (= no folder).
  folder_id?: string | number;
  include_subfolders?: boolean;
  kind?: string;
  mime?: string;
  status?: string;
  unused?: boolean;
  missing_alt?: boolean;
  trashed?: boolean;
};

// PATCH body: only what changed (`minProperties: 1`).
export type UpdateMediaAssetPayload = {
  folder_id?: number | null;
  is_decorative?: boolean;
  focal?: MediaFocal;
  translations?: Record<string, MediaAssetTranslation>;
};

export type CreateMediaFolderPayload = { name: string; parent_id?: number | null; sort_order?: number };
export type UpdateMediaFolderPayload = { name?: string; parent_id?: number | null; sort_order?: number };

export type MediaAssetsPage = { rows: MediaAsset[]; meta: ApiMeta };
