// Shared plumbing of the in-memory API model (`mock-db.ts` and the save-live modules `mock-menus.ts`,
// `mock-settings.ts`, `mock-ui-strings.ts`, `mock-taxonomy.ts`): the error envelope, the clock that makes ETags
// unique and ordered, query helpers and the revision store. Kept apart so those modules do not import each other.
import type { ApiFieldError } from "@/types/api";
import type { MediaAssetDetail, MediaFolder, MediaUsage, UserRef } from "@/types/media";
import type { MenuDetail } from "@/types/menus";
import type { RevisionDetail } from "@/types/revisions";
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

// Row of the pages the menu picker and the in-use rules read (`GET /pages`).
export type MockPage = { id: number; key: string; name: string; title: Record<string, string>; path: string; status: "published" | "draft" | "archived"; is_trashed: boolean };
// Posts only exist for the "category / tag in use" rules.
export type MockPost = { id: number; title: string; status: "published" | "draft" | "scheduled" | "archived"; category_id: number | null; tag_ids: number[]; is_trashed: boolean };

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
  pages: MockPage[];
  posts: MockPost[];
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
  kind: "history" | "restore",
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
  // Save-live keeps the latest 50 versions per entity (doc/05 11.1.2).
  if (list.length > 50) list.splice(0, list.length - 50);
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
