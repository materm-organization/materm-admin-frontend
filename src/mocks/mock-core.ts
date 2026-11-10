// Shared plumbing of the in-memory API model (`mock-db.ts` and the save-live modules `mock-menus.ts`,
// `mock-settings.ts`, `mock-ui-strings.ts`, `mock-taxonomy.ts`): the error envelope, the clock that makes ETags
// unique and ordered, query helpers and the revision store. Kept apart so those modules do not import each other.
import { toUtcMicros } from "@/services/media.api";
import type { ApiFieldError } from "@/types/api";
import type { MediaAssetDetail, MediaFolder, MediaUsage, UserRef } from "@/types/media";
import type { MenuDetail } from "@/types/menus";
import type { PublishableStatus } from "@/types/publishing";
import type { RevisionDetail, RevisionKind } from "@/types/revisions";
import type { CachePurgeResult } from "@/types/system";
import type { Author } from "@/types/authors";
import type { Redirect } from "@/types/redirects";
import type { MockWebhookState } from "@/mocks/mock-webhooks";
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

// A body timestamp as the real server writes it: the Asia/Vientiane offset and exactly 6 fraction digits
// (`2026-10-27T10:00:00.000417+07:00`). ETags are NOT this: they stay UTC with the microseconds (`etagOf` converts).
export function micros(ms: number, extra = 0): string {
  const local = new Date(ms + 7 * 3_600_000).toISOString(); // 2026-10-27T10:00:00.000Z (shifted: read as +07:00)
  return local.replace(/\.(\d{3})Z$/, (_m, milli: string) => `.${milli}${String(extra % 1000).padStart(3, "0")}+07:00`);
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
  // 05 18: a reference to a shared section (props are then `{}` and the variant `null`).
  shared_section_id: number | null;
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
// ---- T1.5.6 albums and FAQ groups (doc/05 sections 13.4, 13.5), stored like a post: the REAL rows (`live`, written directly
// while the thing is not published) and, for a published one with pending edits, a `kind = "draft"` row in
// `db.revisions["albums/<id>"]` / `["faq-groups/<id>"]` holding the working copy. Snapshots follow doc/05 13.2 (children as arrays
// keyed by `locale_code`). `db.albums` is also read by the pages model (`album_id` references): it needs `id`, `status`, `deleted_at`.
export type MockAlbumItemTranslation = { locale_code: string; caption_title: string | null; caption_description: string | null; alt: string | null };
export type MockAlbumItem = { id: number; public_id: string; media_id: number; sort_order: number; layout_hint: string | null; translations: MockAlbumItemTranslation[] };
export type MockAlbumTranslation = { locale_code: string; title: string; description: string | null };
export type MockAlbumSnapshot = { album: { cover_media_id: number | null }; translations: MockAlbumTranslation[]; items: MockAlbumItem[] };
export type MockFaqItemTranslation = { locale_code: string; question: string; answer: Record<string, unknown> };
export type MockFaqItem = { id: number; public_id: string; sort_order: number; is_visible: boolean; translations: MockFaqItemTranslation[] };
export type MockFaqSnapshot = { group: { name: string }; items: MockFaqItem[] };
type MockPublishableRoot<S> = {
  id: number;
  public_id: string;
  key: string;
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
  live: S;
};
export type MockEntryTranslation = { locale_code: string; title: string; slug: string | null; data: Record<string, unknown>; is_enabled: boolean };
export type MockEntrySnapshot = { entry: { data: Record<string, unknown>; schema_version: number; sort_order: number }; translations: MockEntryTranslation[] };
// A collection definition (05 17.2): save-live; ETag = its UTC `updated_at`.
export type MockCollection = {
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
  json_schema: Record<string, unknown>;
  localized_schema: Record<string, unknown>;
  ui_schema: Record<string, unknown>;
  schema_version: number;
  created_by: UserRef;
  updated_by: UserRef;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
// A shared section (05 18.8.1): the snapshot is `{name, section_type, section_version, variant, props}` (04 5.2). The type is fixed for the life of the row (SS-13).
export type MockSharedSnapshot = { name: string; section_type: string; section_version: number; variant: string | null; props: Record<string, unknown> };
export type MockSharedSection = MockPublishableRoot<MockSharedSnapshot> & { section_type: string; section_version: number };
export type MockAlbum = MockPublishableRoot<MockAlbumSnapshot>;
export type MockFaqGroup = MockPublishableRoot<MockFaqSnapshot>;
// A collection entry: `key` is its id as text (the engine's restore check is replaced by the slug rule), `collection_key` its collection.
export type MockCollectionEntry = MockPublishableRoot<MockEntrySnapshot> & { collection_key: string };
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
    // Absent on the older seeds (read as `null`).
    author_id?: number | null;
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
export type MockWorkflowRole = "full" | "writer" | "reviewer" | "scheduler";
// A booked time (05 12.11): `run_at` is a wall-clock instant in ms. `failed` = the server tried 3 times and gave up (the entity stays `scheduled`,
// overdue).
export type MockSchedule = { action: "publish" | "apply_revision"; run_at: number; status: "pending" | "running" | "failed"; attempts: number; last_error: string | null };
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
  // T1.5.6 galleries and FAQ: `translateOnly` containing "albums" / "faq-groups" makes the model a translate-only writer (05 13.4.2, 13.5.2).
  nextAlbumId: number;
  nextAlbumItemId: number;
  faqGroups: MockFaqGroup[];
  nextFaqGroupId: number;
  // SCR-40 / 41 collections (05 17): `collectionRole` drives the 403 rules (editor = entries only, viewer = read only); `translateOnly`
  // containing "collection-entries" makes the caller a translator.
  collections: MockCollection[];
  nextCollectionId: number;
  collectionEntries: MockCollectionEntry[];
  nextCollectionEntryId: number;
  collectionRole: "admin" | "editor" | "viewer";
  // Shared sections (05 18): `sharedSectionRole` drives the 403 rules (05 18.15: editor = everything but manage_schema, author / viewer = read only);
  // `translateOnly` containing "shared-sections" makes the caller a translator (read + translate), and containing "sections" does the same for the page sections.
  sharedSections: MockSharedSection[];
  nextSharedSectionId: number;
  sharedSectionRole: "admin" | "editor" | "viewer";
  nextFaqItemId: number;
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
  // SCR-42 redirects (doc/05 6.10): save-live rows, ETag = `"<updated_at>"`.
  redirects: Redirect[];
  nextRedirectId: number;
  // Authors (doc/05 15): save-live rows, ETag = `"<updated_at>"`.
  authors: Author[];
  nextAuthorId: number;
  // External webhooks (doc/05 16): rows, deliveries, the rate window of the test button, `unconfigured` = no secret key (503).
  webhooks: MockWebhookState;
  // --- T1.4.4 preview links ---------------------------------------------------------------------------------
  previewLinks: MockPreviewLink[];
  nextPreviewLinkId: number;
  // Wall-clock instants of the links issued by the signed-in user (30 per hour, all pages together).
  previewIssued: number[];
  // The server has no `preview.portalUrl` / `revalidate.url`: creating a link is a 503 (toggled by `__MATERM_MOCK__`).
  previewUnconfigured: boolean;
  // --- D1 review and schedule (doc/05 12.10 - 12.11) -------------------------------------------------------------
  // The schedule rows (the server's schedule table) of the pages, posts, albums and collection entries, by `"<kind>/<id>"`.
  schedules: Record<string, MockSchedule>;
  // Wall-clock instants of the schedule calls (60 per hour for the signed-in user, every kind together).
  scheduleCalls: number[];
  // Who the signed-in user is for the review / schedule routes (on top of each model's own roles): `full` = every action; `writer` =
  // `update` only (can submit for review, can not reject, can not schedule); `reviewer` = `read` + `review` (can reject only);
  // `scheduler` = `schedule` WITHOUT `publish` (BR-11: the schedule routes refuse).
  workflowRole: MockWorkflowRole;
};

export function tick(db: { clock: number }): string {
  db.clock += 1000;
  return micros(db.clock, 417);
}

export const keyOf = (resource: string, id: string | number) => `${resource}/${id}`;
// The ETag of a stamp is its UTC instant with the microseconds (doc/05 11.1.1), whatever offset the body carries.
export const etagOf = (stamp: string) => `"${toUtcMicros(stamp)}"`;

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

// Strict like the real list endpoints (found by the real-backend run): `limit` is 1..100 and `page` >= 1, an integer each;
// anything else is a 422 (`out_of_range` / `invalid_type`), never silently clamped. `limit: 200` once went unnoticed because of that.
export function pageOf(params: Params, defaultLimit = 20) {
  const errors: ApiFieldError[] = [];
  const int = (name: string, fallback: number, min: number, max?: number) => {
    const raw = params.get(name);
    if (raw === null || raw === "") return fallback;
    if (!/^-?\d+$/.test(raw)) {
      errors.push({ in: "query", path: `/${name}`, code: "invalid_type", params: { expected: "integer" } });
      return fallback;
    }
    const n = Number(raw);
    if (n < min || (max !== undefined && n > max)) {
      errors.push({ in: "query", path: `/${name}`, code: "out_of_range", params: max !== undefined ? { min, max } : { min } });
      return fallback;
    }
    return n;
  };
  const page = int("page", 1, 1);
  const limit = int("limit", defaultLimit, 1, 100);
  if (errors.length) throw validationFailed(errors);
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
