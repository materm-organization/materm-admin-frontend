// Shared plumbing of the in-memory API model (`mock-db.ts` and the save-live modules `mock-menus.ts`,
// `mock-settings.ts`, `mock-ui-strings.ts`, `mock-taxonomy.ts`): the error envelope, the clock that makes ETags
// unique and ordered, query helpers and the revision store. Kept apart so those modules do not import each other.
import type { ApiFieldError } from "@/types/api";
import type { MediaAssetDetail, MediaFolder, MediaUsage, UserRef } from "@/types/media";
import type { MenuDetail } from "@/types/menus";
import type { PublishableStatus } from "@/types/publishing";
import type { RevisionDetail, RevisionKind } from "@/types/revisions";
import type { CachePurgeResult } from "@/types/system";
import type { Category, Tag } from "@/types/taxonomy";

export const MOCK_USER = { id: 6, name: "Noy Keomany" } as const;
export const DEFAULT_LOCALE_CODE = "la";
export const MOCK_LOCALE_CODES = ["la", "en", "th"] as const;
// `th` exists (so a restore of a snapshot that mentions it is valid) but is not active.
export const MOCK_ACTIVE_LOCALE_CODES = ["la", "en"] as const;

export class MockHttpError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
    public headers: Record<string, string> = {}
  ) {
    super(String(body.code ?? status));
  }
}

export const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers?: Record<string, string>) =>
  new MockHttpError(status, { success: false, code, message, request_id: "0192d3a4-7c1e-7b52-9d0a-3f5e2a1b4d11", ...extra }, headers);

export const validationFailed = (errors: ApiFieldError[]) =>
  fail(422, "VALIDATION_FAILED", "The submitted data is not valid.", { errors });
export const notFound = () => fail(404, "NOT_FOUND", "The requested resource was not found.");
export const forbidden = (summary: string) => fail(403, "FORBIDDEN", "You do not have permission to perform this action.", { details: { summary } });
export const preconditionRequired = () => fail(428, "PRECONDITION_REQUIRED", "This request must include an If-Match header.");
export const lockConflict = () => fail(409, "CONFLICT_LOCK_VERSION", "The record was changed by someone else. Reload and try again.");
export const invalidState = (reason: string, extra: Record<string, unknown> = {}) =>
  fail(409, "INVALID_STATE", "The request conflicts with the current state of the resource.", { details: { reason, ...extra } });
export const duplicate = (errors: ApiFieldError[]) =>
  fail(409, "CONFLICT_DUPLICATE", "A record with the same value already exists.", { errors });
export const badRequest = () => fail(400, "BAD_REQUEST", "Malformed body.");

// ---------------------------------------------------------------------------------------------------------------
// Time: every write moves the clock so ETags (`"<updated_at>"`, microseconds) are unique and ordered.
// ---------------------------------------------------------------------------------------------------------------
export const CLOCK_START = Date.UTC(2026, 9, 27, 3, 0, 0);

export function micros(ms: number, extra = 0): string {
  const iso = new Date(ms).toISOString(); // 2026-10-27T03:00:00.000Z
  return iso.replace(/\.(\d{3})Z$/, (_m, milli: string) => `.${milli}${String(extra % 1000).padStart(3, "0")}Z`);
}

// ---------------------------------------------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------------------------------------------
export type StoredRevision = RevisionDetail;
export type MockEntity = { etag: string; body: Record<string, unknown> };

// A page of the mock (doc/05 section 12.2.2): the REAL rows (`live`, written directly while the page is not
// published) and, for a published page with pending edits, a `kind = "draft"` row in `db.revisions["pages/<id>"]`
// holding the working copy (PG-1). Both use the snapshot shape of doc/04 section 5.2 / doc/05 12.8.2.
export type MockSnapshotSection = {
  id: number;
  public_id: string;
  section_type: string;
  section_version: number;
  variant: string | null;
  sort_order: number;
  is_visible: boolean;
  anchor_id: string | null;
  props: Record<string, unknown>;
  shared_section_id: null;
};
export type MockSnapshotTranslation = {
  locale_code: string;
  title: string;
  seo_title: string | null;
  seo_title_absolute: boolean;
  seo_description: string | null;
  og_image_id: number | null;
  canonical_path: string | null;
  is_enabled: boolean;
};
export type MockPageSnapshot = {
  page: {
    key: string;
    name: string;
    template: string;
    path: string;
    parent_id: null;
    is_home: boolean;
    noindex: boolean;
    in_sitemap: boolean;
    sort_order: number;
  };
  translations: MockSnapshotTranslation[];
  sections: MockSnapshotSection[];
};
export type MockPageRoot = {
  id: number;
  public_id: string;
  is_system: boolean;
  status: PublishableStatus;
  // ETag = `"<lock_version>"`.
  lock_version: number;
  published_at: string | null;
  first_published_at: string | null;
  unpublished_at: string | null;
  created_by: UserRef;
  updated_by: UserRef;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  live: MockPageSnapshot;
};
// Albums only exist for the `album_id` references of a section.
export type MockAlbum = { id: number; title: string; status: "published" | "draft" };
// A stored answer of a request that carried an `Idempotency-Key` (create page, set-home, publish, unpublish).
export type MockIdempotent = { fingerprint: string; status: number; data: unknown; etag?: string };
// A post of the mock (doc/05 section 13.3), stored like a page: the REAL rows (`live`, written directly while the post is not
// published) and, for a published post with pending edits, a `kind = "draft"` row in `db.revisions["posts/<id>"]` holding the
// working copy. Both use the snapshot shape of doc/04 section 5.2.
export type MockPostMedia = { id: number; media_id: number; sort_order: number; translations: Record<string, { alt?: string | null; caption?: string | null }> };
export type MockPostTranslation = {
  locale_code: string;
  slug: string;
  title: string;
  excerpt: string | null;
  label: string | null;
  location_label: string | null;
  body: Record<string, unknown> | null;
  gallery_heading: string | null;
  gallery_description: string | null;
  hero_alt: string | null;
  seo_title: string | null;
  seo_description: string | null;
  og_image_id: number | null;
  is_enabled: boolean;
};
export type MockPostSnapshot = {
  post: {
    category_id: number | null;
    hero_media_id: number | null;
    teaser_media_id: number | null;
    is_featured: boolean;
  };
  tag_ids: number[];
  translations: MockPostTranslation[];
  media: MockPostMedia[];
};
export type MockPostRoot = {
  id: number;
  public_id: string;
  status: PublishableStatus;
  lock_version: number;
  published_at: string | null;
  first_published_at: string | null;
  unpublished_at: string | null;
  created_by: UserRef;
  updated_by: UserRef;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  live: MockPostSnapshot;
};
// Who the signed-in user is for the posts model (05 13.3.2): an editor (every action), an author (`create`, `update_own`,
// `delete_own`, `translate`: only their own posts, and no publish) or a translator (`read` + `translate`).
export type MockPostRole = "editor" | "author" | "translator";

export type MockMenu = Omit<MenuDetail, "items" | "limits" | "options"> & {
  items: MenuDetail["items"];
};

export type MockSettingRow = {
  key: string;
  group: string;
  value_type: string;
  is_localized: boolean;
  required: boolean;
  description: string;
  sort_order: number;
  max_length?: number;
  pattern?: string;
  accept?: { kinds: string[]; mime_types: string[] };
  value: string | number | boolean | null;
  media_id: number | null;
  translations: Record<string, string>;
};

export type MockUiRow = {
  id: number;
  key: string;
  locale: string;
  value: string;
  note: string | null;
  updated_at: string;
  updated_by: UserRef;
};

export type MockManifest = {
  version: number;
  generated_at: string;
  source_commit: string;
  synced_at: string;
  keys: Array<{ key: string; namespace: string; values: Record<string, string> }>;
};

// A preview link of the mock (doc/05 12.9). Times are WALL-CLOCK milliseconds (a link lives 30 minutes of real time), unlike
// the rest of the model whose clock is synthetic. The raw token is NOT kept: only the creation answer ever has it.
export type MockPreviewLink = {
  id: number;
  // The kind of entity the link is frozen on (pages, posts: PT-18) and its id (`page_id` is the historic name).
  entity: "pages" | "posts";
  page_id: number;
  locale: string;
  created_by: UserRef;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  last_used_at: number | null;
  use_count: number;
  revision: { id: number; version: number; frozen_at: string };
  // The page's `lock_version` when the link was frozen: a higher one now = `is_stale`.
  frozen_lock_version: number;
};

export type MockDb = {
  clock: number;
  assets: MediaAssetDetail[];
  folders: MediaFolder[];
  usages: Record<number, MediaUsage[]>;
  revisions: Record<string, StoredRevision[]>;
  // Entities other than the real ones below (an id the playground invents) the generic restore falls back to.
  entities: Record<string, MockEntity>;
  purges: { tags: number; all: number };
  nextRevisionId: number;
  nextFolderId: number;
  // --- T1.3.8 save-live ---------------------------------------------------------------------------------------
  pages: MockPageRoot[];
  nextPageId: number;
  nextSectionId: number;
  albums: MockAlbum[];
  idempotency: Record<string, MockIdempotent>;
  posts: MockPostRoot[];
  nextPostId: number;
  nextPostMediaId: number;
  postRole: MockPostRole;
  menus: MockMenu[];
  nextMenuItemId: number;
  // Resources whose writer holds ONLY `translate` (no `update`): the model then enforces 05 11.1.3 (403 on a value
  // that differs in a non-translatable field). Empty = a user with every action.
  translateOnly: string[];
  settings: MockSettingRow[];
  // ETag = the version number of the group's latest revision.
  settingsVersion: Record<string, number>;
  settingsUpdatedAt: Record<string, { at: string; by: UserRef }>;
  uiRows: MockUiRow[];
  nextUiRowId: number;
  manifests: MockManifest[];
  bundleSyncs: number;
  categories: Category[];
  tags: Tag[];
  nextCategoryId: number;
  nextTagId: number;
  // --- T1.4.4 preview links ---------------------------------------------------------------------------------
  previewLinks: MockPreviewLink[];
  nextPreviewLinkId: number;
  // Wall-clock instants of the links issued by the signed-in user (30 per hour, all pages together).
  previewIssued: number[];
  // The server has no `preview.portalUrl` / `revalidate.url`: creating a link is a 503 (toggled by `__MATERM_MOCK__`).
  previewUnconfigured: boolean;
};

export function tick(db: { clock: number }): string {
  db.clock += 1000;
  return micros(db.clock, 417);
}

export const keyOf = (resource: string, id: string | number) => `${resource}/${id}`;
export const etagOf = (stamp: string) => `"${stamp}"`;

export function requireIfMatch(header: string | null, current: string) {
  if (!header) throw preconditionRequired();
  if (header !== current) throw lockConflict();
}

export function pushRevision(
  db: Pick<MockDb, "revisions" | "nextRevisionId">,
  resource: string,
  id: string | number,
  entityType: string,
  kind: RevisionKind,
  snapshot: Record<string, unknown>,
  changeNote: string | null,
  createdAt: string,
  createdBy: UserRef,
  schemaVersion = 1,
  entityId?: number
): StoredRevision {
  const list = (db.revisions[keyOf(resource, id)] ??= []);
  const version = (list.reduce((max, r) => Math.max(max, r.version), 0) || 0) + 1;
  const rev: StoredRevision = {
    id: db.nextRevisionId++,
    version,
    kind,
    change_note: changeNote,
    is_preview: changeNote === "preview",
    schema_version: schemaVersion,
    created_at: createdAt,
    created_by: createdBy,
    entity: { type: entityType, id: entityId ?? (typeof id === "number" ? id : 0), key: typeof id === "string" ? id : null },
    snapshot,
  };
  list.push(rev);
  // The latest 50 versions per entity are kept (doc/05 11.1.2); a publishable entity also keeps every `published`
  // row and its `draft` (05 12.2.4).
  const prunable = list.filter((r) => r.kind === "history" || r.kind === "restore");
  for (let i = 0; i < prunable.length && list.length > 50; i++) list.splice(list.indexOf(prunable[i]), 1);
  return rev;
}

// ---------------------------------------------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------------------------------------------
export type Params = URLSearchParams;

export function rejectUnknown(params: Params, allowed: readonly string[]) {
  const errors: ApiFieldError[] = [];
  for (const key of new Set(params.keys())) {
    if (!allowed.includes(key)) errors.push({ in: "query", path: `/${key}`, code: "unknown_field" });
  }
  if (errors.length) throw validationFailed(errors);
}

export function pageOf(params: Params, defaultLimit = 20) {
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(params.get("limit") ?? defaultLimit) || defaultLimit));
  return { page, limit };
}

export function paginate<T>(rows: T[], params: Params, defaultLimit = 20) {
  const { page, limit } = pageOf(params, defaultLimit);
  const total = rows.length;
  return {
    data: rows.slice((page - 1) * limit, page * limit),
    meta: { total, page, limit, total_page: Math.ceil(total / limit) },
  };
}

// Strict boolean query parameter (`true` / `false`); anything else is a 422.
export function boolParam(params: Params, name: string): boolean | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;
  if (raw !== "true" && raw !== "false") throw validationFailed([{ in: "query", path: `/${name}`, code: "invalid_format" }]);
  return raw === "true";
}

export type { CachePurgeResult };
