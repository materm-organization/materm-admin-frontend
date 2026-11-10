// SCR-40 / SCR-41 collections (doc/05 section 17): definitions (save-live, ETag = `etag` = the UTC `updated_at`) and entries (publishable,
// ETag = `"<lock_version>"`, the publish engine of `mock-faq-album-engine.ts`). Strict like the backend: unknown field / query key = 422, no
// `If-Match` = 428, stale = 409, the schema rules of 05 17.4 (`checkCollectionSchema`), the data rules of the entry (`checkEntryData`), the
// schema-change rule of 17.5 (409 `schema_breaks_entries`), slug duplicates, IDOR (an id of another collection = 404), roles.
//
// Roles (`db.collectionRole`): `admin` = everything; `editor` = entries only (no `manage_schema`); `viewer` = read only.
// `db.translateOnly` containing "collection-entries" = a translator (read + translate: title / slug / data of existing language rows).
import { canonicalJson } from "@/lib/collections/schema-builder";
import { ENTRY_SLUG_RE, ICON_RE, MAX_COLLECTION_DESCRIPTION, MAX_COLLECTION_NAME, MAX_ENTRY_SLUG, MAX_ENTRY_TITLE, MAX_SORT_ORDER, MAX_UI_SCHEMA_BYTES, collectionKeyProblem } from "@/lib/collections/constants";
import { checkEntryData } from "@/lib/collections/data-check";
import { checkCollectionSchema } from "@/lib/collections/schema-check";
import {
  DEFAULT_LOCALE_CODE,
  MOCK_ACTIVE_LOCALE_CODES,
  MOCK_LOCALE_CODES,
  MOCK_USER,
  boolParam,
  duplicate,
  etagOf,
  fail,
  forbidden,
  invalidState,
  lockConflict,
  micros,
  notFound,
  pageOf,
  paginate,
  preconditionRequired,
  pushRevision,
  rejectUnknown,
  tick,
  validationFailed,
  type MockCollection,
  type MockCollectionEntry,
  type MockDb,
  type MockEntrySnapshot,
  type MockEntryTranslation,
  type Params,
} from "@/mocks/mock-core";
import { scheduleMember, scheduledAtOf } from "@/mocks/mock-review-schedule";
import { TRASH_DAYS, blank, isObject, issue, makeEngine } from "@/mocks/mock-faq-album-engine";
import type { ApiFieldError } from "@/types/api";
import type { JsonSchema } from "@/types/cms";
import type { Collection, CollectionEntryDetail, CollectionEntryListItem, CollectionListItem } from "@/types/collections";
import type { UserRef } from "@/types/media";
import type { PublishIssue } from "@/types/publishing";

const SEED_AT = micros(Date.UTC(2026, 10, 2, 9, 0, 0), 120);
const STATUSES = ["draft", "in_review", "scheduled", "published", "archived"];
const MAX_VERIFY = 5000;
const MAX_INVALID_LISTED = 20;
const SOMCHAI: UserRef = { id: 4, name: "Somchai Vongsa" };
const EMPTY_SCHEMA = (): JsonSchema => ({ type: "object", properties: {}, additionalProperties: false });
const uuid = (prefix: string, id: number) => `0192d3a4-7c1e-7b52-9d0a-${prefix}${String(id).padStart(12 - prefix.length, "0")}`;

// ---------------------------------------------------------------------------------------------------------------
// Rights
// ---------------------------------------------------------------------------------------------------------------
type Right = "read" | "create" | "update" | "delete" | "publish" | "unpublish" | "translate" | "manage_schema";
function allowedAction(db: MockDb, right: Right): boolean {
  if (right === "read") return true;
  if (right === "manage_schema") return db.collectionRole === "admin";
  if (db.collectionRole === "viewer") return false;
  if (db.translateOnly.includes("collection-entries")) return right === "translate";
  return true;
}
function need(db: MockDb, right: Right, method: string, path: string): void {
  if (!allowedAction(db, right)) throw forbidden(`cms.collections:${right} ${method} ${path}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------------------------------------------
const isTrashed = (c: { deleted_at: string | null }) => c.deleted_at !== null;
const liveEntries = (db: MockDb, key: string) => db.collectionEntries.filter((e) => e.collection_key === key && e.deleted_at === null);

export function collectionListItem(db: MockDb, c: MockCollection): CollectionListItem {
  const entries = liveEntries(db, c.key);
  return {
    id: c.id,
    public_id: c.public_id,
    key: c.key,
    name: c.name,
    description: c.description,
    icon: c.icon,
    is_active: c.is_active,
    sort_order: c.sort_order,
    title_field: c.title_field,
    has_slug: c.has_slug,
    schema_version: c.schema_version,
    entry_count: entries.length,
    published_entry_count: entries.filter((e) => e.status === "published").length,
    created_by: c.created_by,
    updated_by: c.updated_by,
    created_at: c.created_at,
    updated_at: c.updated_at,
    deleted_at: c.deleted_at,
    purge_at: c.deleted_at ? micros(Date.parse(c.deleted_at) + TRASH_DAYS * 86_400_000, 0) : null,
    etag: etagOf(c.updated_at),
  };
}
export const collectionDetail = (db: MockDb, c: MockCollection): Collection => ({
  ...collectionListItem(db, c),
  json_schema: structuredClone(c.json_schema) as JsonSchema,
  localized_schema: structuredClone(c.localized_schema) as JsonSchema,
  ui_schema: structuredClone(c.ui_schema),
});

function findCollection(db: MockDb, key: string): MockCollection {
  const c = db.collections.find((x) => x.key === key);
  if (!c) throw notFound();
  return c;
}
const requireMatch = (ifMatch: string | null, c: MockCollection) => {
  if (!ifMatch) throw preconditionRequired();
  if (ifMatch !== etagOf(c.updated_at)) throw lockConflict();
};

const SORTS = ["sort_order", "key", "name", "updated_at", "deleted_at"];
function sortRows<T>(rows: T[], sort: string, get: (row: T, field: string) => string | number, tie: (row: T) => number): T[] {
  const m = /^(-?)([a-z_]+)$/.exec(sort)!;
  const dir = m[1] ? -1 : 1;
  return rows.slice().sort((x, y) => {
    const a = get(x, m[2]);
    const b = get(y, m[2]);
    const c = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
    return c * dir || tie(x) - tie(y);
  });
}

export function listCollections(db: MockDb, params: Params) {
  rejectUnknown(params, ["page", "limit", "keyword", "is_active", "trashed", "sort"]);
  const errors: ApiFieldError[] = [];
  const trashed = boolParam(params, "trashed") ?? false;
  const active = boolParam(params, "is_active");
  const keyword = params.get("keyword")?.trim().toLowerCase();
  const sort = params.get("sort") ?? "sort_order";
  const m = /^(-?)([a-z_]+)$/.exec(sort);
  if (!m || !SORTS.includes(m[2])) errors.push({ in: "query", path: "/sort", code: "not_in_enum", params: { expected: SORTS } });
  if (errors.length) throw validationFailed(errors);
  if (trashed) need(db, "manage_schema", "GET", "/collections?trashed=true");
  let rows = db.collections.filter((c) => isTrashed(c) === trashed);
  if (keyword) rows = rows.filter((c) => c.key.includes(keyword) || c.name.toLowerCase().includes(keyword));
  if (active !== undefined) rows = rows.filter((c) => c.is_active === active);
  const items = rows.map((c) => collectionListItem(db, c));
  const sorted = sortRows(items, sort, (r, f) => (f === "name" ? r.name.toLowerCase() : ((r as unknown as Record<string, string | number>)[f] ?? "")), (r) => r.id);
  return paginate(sorted, params);
}

export function getCollection(db: MockDb, key: string) {
  const c = findCollection(db, key);
  return { data: collectionDetail(db, c), etag: etagOf(c.updated_at) };
}

const depthOf = (v: unknown): number => (v !== null && typeof v === "object" ? 1 + Math.max(0, ...Object.values(v as object).map(depthOf)) : 0);
const topLevelNames = (c: { json_schema: Record<string, unknown>; localized_schema: Record<string, unknown> }) => [
  ...Object.keys((c.json_schema.properties as object) ?? {}),
  ...Object.keys((c.localized_schema.properties as object) ?? {}),
];

function schemaErrors(schema: unknown, name: "json_schema" | "localized_schema"): ApiFieldError[] {
  return checkCollectionSchema(schema, `/${name}`).map((i) => ({ in: "body" as const, path: i.path, code: i.code, params: i.params as ApiFieldError["params"] }));
}

type DefinitionBody = Partial<Omit<MockCollection, "id" | "public_id" | "created_by" | "updated_by" | "created_at" | "updated_at" | "deleted_at" | "schema_version">>;
function validateDefinition(db: MockDb, body: unknown, mode: "create" | "patch", current?: MockCollection): DefinitionBody {
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const errors: ApiFieldError[] = [];
  const allowed = ["name", "description", "icon", "is_active", "sort_order", "title_field", "has_slug", "json_schema", "localized_schema", "ui_schema"];
  for (const k of Object.keys(body)) {
    if (k === "key") {
      if (mode === "patch") errors.push({ in: "body", path: "/key", code: "immutable" });
    } else if (!allowed.includes(k)) errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  }
  if (mode === "patch" && Object.keys(body).filter((k) => k !== "key").length === 0 && errors.length === 0) errors.push({ in: "body", path: "", code: "min_properties" });
  const out: DefinitionBody = {};
  if (mode === "create") {
    if (typeof body.key !== "string") errors.push({ in: "body", path: "/key", code: body.key === undefined ? "required" : "invalid_type" });
    else {
      const problem = collectionKeyProblem(body.key);
      if (problem) errors.push({ in: "body", path: "/key", code: problem });
      else out.key = body.key;
    }
  }
  if (body.name !== undefined || mode === "create") {
    if (typeof body.name !== "string") errors.push({ in: "body", path: "/name", code: body.name === undefined ? "required" : "invalid_type" });
    else if (body.name.trim() === "") errors.push({ in: "body", path: "/name", code: "required" });
    else if ([...body.name.trim()].length > MAX_COLLECTION_NAME) errors.push({ in: "body", path: "/name", code: "too_long", params: { max: MAX_COLLECTION_NAME } });
    else out.name = body.name.trim();
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") errors.push({ in: "body", path: "/description", code: "invalid_type" });
    else if ([...body.description].length > MAX_COLLECTION_DESCRIPTION) errors.push({ in: "body", path: "/description", code: "too_long", params: { max: MAX_COLLECTION_DESCRIPTION } });
    else out.description = body.description;
  }
  if (body.icon !== undefined) {
    if (body.icon !== null && (typeof body.icon !== "string" || !ICON_RE.test(body.icon))) errors.push({ in: "body", path: "/icon", code: "pattern_mismatch" });
    else out.icon = body.icon as string | null;
  }
  for (const k of ["is_active", "has_slug"] as const) {
    if (body[k] !== undefined) {
      if (typeof body[k] !== "boolean") errors.push({ in: "body", path: `/${k}`, code: "invalid_type" });
      else out[k] = body[k] as boolean;
    }
  }
  if (body.sort_order !== undefined) {
    if (typeof body.sort_order !== "number" || !Number.isInteger(body.sort_order)) errors.push({ in: "body", path: "/sort_order", code: "invalid_type" });
    else if (body.sort_order < 0 || body.sort_order > MAX_SORT_ORDER) errors.push({ in: "body", path: "/sort_order", code: "out_of_range" });
    else out.sort_order = body.sort_order;
  }
  if (mode === "create" && body.json_schema === undefined) errors.push({ in: "body", path: "/json_schema", code: "required" });
  if (body.json_schema !== undefined) {
    const e = schemaErrors(body.json_schema, "json_schema");
    if (e.length) errors.push(...e);
    else out.json_schema = body.json_schema as Record<string, unknown>;
  }
  if (body.localized_schema !== undefined) {
    const e = schemaErrors(body.localized_schema, "localized_schema");
    if (e.length) errors.push(...e);
    else out.localized_schema = body.localized_schema as Record<string, unknown>;
  }
  if (body.ui_schema !== undefined) {
    if (!isObject(body.ui_schema)) errors.push({ in: "body", path: "/ui_schema", code: "invalid_type" });
    else if (JSON.stringify(body.ui_schema).length > MAX_UI_SCHEMA_BYTES) errors.push({ in: "body", path: "/ui_schema", code: "too_long" });
    else if (depthOf(body.ui_schema) > 10) errors.push({ in: "body", path: "/ui_schema", code: "too_deep" });
    else out.ui_schema = body.ui_schema;
  }
  if (body.title_field !== undefined) {
    if (typeof body.title_field !== "string") errors.push({ in: "body", path: "/title_field", code: "invalid_type" });
    else out.title_field = body.title_field;
  }
  if (out.title_field !== undefined || out.json_schema || out.localized_schema) {
    const merged = { json_schema: out.json_schema ?? current?.json_schema ?? EMPTY_SCHEMA(), localized_schema: out.localized_schema ?? current?.localized_schema ?? EMPTY_SCHEMA() };
    const title = out.title_field ?? current?.title_field ?? "title";
    if (title !== "title" && !topLevelNames(merged).includes(title)) errors.push({ in: "body", path: "/title_field", code: "unknown_reference" });
  }
  if (errors.length) throw validationFailed(errors);
  void db;
  return out;
}

export function createCollection(db: MockDb, body: unknown) {
  need(db, "manage_schema", "POST", "/collections");
  const v = validateDefinition(db, body, "create");
  if (db.collections.some((c) => !isTrashed(c) && c.key === v.key)) throw duplicate([{ in: "body", path: "/key", code: "duplicate" }]);
  const id = db.nextCollectionId++;
  const at = tick(db);
  const c: MockCollection = {
    id,
    public_id: uuid("c0", id),
    key: v.key!,
    name: v.name!,
    description: v.description ?? "",
    icon: v.icon ?? null,
    is_active: v.is_active ?? true,
    sort_order: v.sort_order ?? 0,
    title_field: v.title_field ?? "title",
    has_slug: v.has_slug ?? true,
    json_schema: v.json_schema!,
    localized_schema: v.localized_schema ?? EMPTY_SCHEMA(),
    ui_schema: v.ui_schema ?? {},
    schema_version: 1,
    created_by: MOCK_USER,
    updated_by: MOCK_USER,
    created_at: at,
    updated_at: at,
    deleted_at: null,
  };
  db.collections.push(c);
  return { data: collectionDetail(db, c), etag: etagOf(c.updated_at) };
}

const snapshotOf = (c: MockCollection) => ({
  collection: {
    name: c.name,
    description: c.description,
    icon: c.icon,
    is_active: c.is_active,
    sort_order: c.sort_order,
    title_field: c.title_field,
    has_slug: c.has_slug,
    json_schema: structuredClone(c.json_schema),
    localized_schema: structuredClone(c.localized_schema),
    ui_schema: structuredClone(c.ui_schema),
    schema_version: 1,
  },
});

// ---- 05 17.5: does every entry outside the trash still pass a candidate schema? -------------------------------------------------
type Candidate = { json_schema: Record<string, unknown>; localized_schema: Record<string, unknown>; has_slug: boolean };
function entryProblems(snap: MockEntrySnapshot, cand: Candidate, mode: "draft" | "publish"): Array<{ path: string; code: string }> {
  const out: Array<{ path: string; code: string }> = [];
  for (const i of checkEntryData(cand.json_schema as JsonSchema, snap.entry.data, mode)) out.push({ path: `/data${i.path}`, code: i.code });
  for (const t of snap.translations) {
    if (!cand.has_slug && t.slug) out.push({ path: `/translations/${t.locale_code}/slug`, code: "not_applicable" });
    if (mode === "publish" && !t.is_enabled) continue;
    for (const i of checkEntryData(cand.localized_schema as JsonSchema, t.data, mode)) out.push({ path: `/translations/${t.locale_code}/data${i.path}`, code: i.code });
  }
  return out;
}
function verifyEntries(db: MockDb, key: string, cand: Candidate) {
  const rows = liveEntries(db, key);
  if (rows.length > MAX_VERIFY) throw invalidState("too_many_entries_to_verify", { checked: rows.length });
  const invalid: Array<{ id: number; path: string; code: string }> = [];
  for (const e of rows) {
    const published = e.status === "published" || e.status === "scheduled";
    const draft = db.revisions[`collection-entries/${e.id}`]?.find((r) => r.kind === "draft");
    const problems = [...entryProblems(e.live, cand, published ? "publish" : "draft"), ...(draft ? entryProblems(draft.snapshot as unknown as MockEntrySnapshot, cand, "draft") : [])];
    if (problems.length) invalid.push({ id: e.id, ...problems[0] });
  }
  if (invalid.length) {
    throw invalidState("schema_breaks_entries", { checked: rows.length, invalid_count: invalid.length, invalid_entries: invalid.slice(0, MAX_INVALID_LISTED) });
  }
}

// Applies a validated definition change (PATCH body or a revision snapshot) under the rules of 17.5; `null` = nothing changed.
function applyDefinition(db: MockDb, c: MockCollection, v: DefinitionBody, recordAs: "history" | "restore", note: string | null): boolean {
  const next = { ...c, ...v } as MockCollection;
  const schemasChanged = canonicalJson([c.json_schema, c.localized_schema]) !== canonicalJson([next.json_schema, next.localized_schema]);
  const slugOff = c.has_slug && !next.has_slug;
  const same = canonicalJson(snapshotOf({ ...c, schema_version: 1 })) === canonicalJson(snapshotOf({ ...next, schema_version: 1 }));
  if (same) return false;
  if (schemasChanged || slugOff) verifyEntries(db, c.key, next);
  const at = tick(db);
  pushRevision(db, "collections", c.key, "cms.collections", recordAs, snapshotOf(c), note, at, MOCK_USER);
  Object.assign(c, v);
  if (schemasChanged || slugOff) c.schema_version += 1;
  c.updated_at = at;
  c.updated_by = MOCK_USER;
  return true;
}

export function patchCollection(db: MockDb, key: string, body: unknown, ifMatch: string | null) {
  need(db, "manage_schema", "PATCH", "/collections/{key}");
  const c = findCollection(db, key);
  requireMatch(ifMatch, c);
  if (isTrashed(c)) throw invalidState("trashed");
  const v = validateDefinition(db, body, "patch", c);
  applyDefinition(db, c, v, "history", null);
  return { data: collectionDetail(db, c), etag: etagOf(c.updated_at) };
}

export function deleteCollection(db: MockDb, key: string, ifMatch: string | null) {
  need(db, "manage_schema", "DELETE", "/collections/{key}");
  const c = findCollection(db, key);
  requireMatch(ifMatch, c);
  if (isTrashed(c)) return { data: null, etag: etagOf(c.updated_at) };
  const n = liveEntries(db, key).length;
  if (n > 0) throw fail(409, "ENTITY_REFERENCED", "The record is still used.", { details: { reason: "collection_has_entries", entry_count: n } });
  const at = tick(db);
  pushRevision(db, "collections", c.key, "cms.collections", "history", snapshotOf(c), "delete", at, MOCK_USER);
  c.deleted_at = at;
  c.updated_at = at;
  c.updated_by = MOCK_USER;
  return { data: null, etag: etagOf(c.updated_at) };
}

export function restoreCollection(db: MockDb, key: string, ifMatch: string | null) {
  need(db, "manage_schema", "POST", "/collections/{key}/restore");
  const c = findCollection(db, key);
  requireMatch(ifMatch, c);
  if (!isTrashed(c)) throw invalidState("not_trashed");
  if (db.collections.some((x) => x !== c && !isTrashed(x) && x.key === c.key)) throw duplicate([{ in: "entity", path: "/key", code: "duplicate" }]);
  c.deleted_at = null;
  c.updated_at = tick(db);
  c.updated_by = MOCK_USER;
  return { data: collectionDetail(db, c), etag: etagOf(c.updated_at) };
}

// The generic revisions routes call this for `collections` (05 17.6).
export function restoreCollectionRevision(db: MockDb, key: string, rev: { id: number; version: number; schema_version: number; snapshot: Record<string, unknown> }, note: string, ifMatch: string | null) {
  need(db, "manage_schema", "POST", "/collections/{key}/revisions/{revId}/restore");
  const c = findCollection(db, key);
  requireMatch(ifMatch, c);
  if (isTrashed(c)) throw invalidState("trashed");
  if (rev.schema_version > 1) throw invalidState("snapshot_incompatible");
  const snap = (rev.snapshot as { collection?: Record<string, unknown> }).collection;
  if (!snap) throw invalidState("snapshot_incompatible");
  const v = validateDefinition(db, {
    name: snap.name,
    description: snap.description,
    icon: snap.icon,
    is_active: snap.is_active,
    sort_order: snap.sort_order,
    title_field: snap.title_field,
    has_slug: snap.has_slug,
    json_schema: snap.json_schema,
    localized_schema: snap.localized_schema,
    ui_schema: snap.ui_schema,
  }, "patch", c);
  applyDefinition(db, c, v, "restore", note);
  return { data: { ...collectionDetail(db, c), restored_from: { revision_id: rev.id, version: rev.version } }, etag: etagOf(c.updated_at) };
}

// ---------------------------------------------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------------------------------------------
function mediaIds(value: unknown, path: string, out: Array<{ path: string; value: unknown }> = []) {
  if (Array.isArray(value)) value.forEach((v, i) => mediaIds(v, `${path}/${i}`, out));
  else if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === "media_id") out.push({ path: `${path}/media_id`, value: v });
      else mediaIds(v, `${path}/${k}`, out);
    }
  }
  return out;
}
const assetOf = (db: MockDb, id: number) => db.assets.find((x) => x.id === id && !x.deleted_at);

const engine = makeEngine<MockCollectionEntry, CollectionEntryDetail>({
  kind: "collection-entries",
  entityType: "cms.collection_entries",
  permission: "cms.collections",
  path: "/collections/{key}/entries/{id}",
  roots: (db) => db.collectionEntries,
  view: (db, root) => entryView(db, root, true) as CollectionEntryDetail,
  validate: (db, root) => validateForPublish(db, root),
  references: () => [],
  referencedWarning: "collection_entry_referenced",
  restoreConflicts: (db, root) => slugConflicts(db, root, root.live),
  // The snapshot is judged against the current schema by `restoreEntryRevision` (it needs the collection).
  snapshotRefs: () => [],
  childrenOf: (snap) => (snap as MockEntrySnapshot).translations,
});
export const entryEngine = engine;
const working = (db: MockDb, root: MockCollectionEntry) => engine.working(db, root) as MockEntrySnapshot;

function collectionOf(db: MockDb, root: MockCollectionEntry): MockCollection {
  return findCollection(db, root.collection_key);
}

function slugConflicts(db: MockDb, root: MockCollectionEntry, snap: MockEntrySnapshot): ApiFieldError[] {
  const out: ApiFieldError[] = [];
  for (const t of snap.translations) {
    if (!t.slug) continue;
    const clash = db.collectionEntries.some(
      (o) => o.id !== root.id && o.collection_key === root.collection_key && o.deleted_at === null && o.live.translations.some((x) => x.locale_code === t.locale_code && x.slug === t.slug)
    );
    if (clash) out.push({ in: "entity", path: `/translations/${t.locale_code}/slug`, code: "duplicate" });
  }
  return out;
}

function validateForPublish(db: MockDb, root: MockCollectionEntry): { blockers: PublishIssue[]; warnings: PublishIssue[] } {
  const snap = working(db, root);
  const c = collectionOf(db, root);
  const blockers: PublishIssue[] = [];
  const warnings: PublishIssue[] = [];
  const def = DEFAULT_LOCALE_CODE;
  const row = snap.translations.find((t) => t.locale_code === def);
  if (!row || blank(row.title)) blockers.push(issue(`/translations/${def}/title`, "empty_default_locale", { locale: def }));
  for (const t of snap.translations) {
    if (c.has_slug && t.is_enabled && blank(t.slug)) blockers.push(issue(`/translations/${t.locale_code}/slug`, "required", {}));
    if (!(MOCK_LOCALE_CODES as readonly string[]).includes(t.locale_code)) blockers.push(issue(`/translations/${t.locale_code}`, "unknown_reference", {}));
  }
  for (const i of checkEntryData(c.json_schema as JsonSchema, snap.entry.data, "publish")) blockers.push(issue(`/data${i.path}`, i.code, (i.params ?? {}) as PublishIssue["params"]));
  for (const t of snap.translations) {
    if (!t.is_enabled) continue;
    for (const i of checkEntryData(c.localized_schema as JsonSchema, t.data, "publish")) blockers.push(issue(`/translations/${t.locale_code}/data${i.path}`, i.code, (i.params ?? {}) as PublishIssue["params"]));
  }
  const media = [
    ...mediaIds(snap.entry.data, "/data"),
    ...snap.translations.flatMap((t) => mediaIds(t.data, `/translations/${t.locale_code}/data`)),
  ];
  for (const m of media) {
    if (m.value === null || m.value === undefined) continue;
    const asset = typeof m.value === "number" ? assetOf(db, m.value) : undefined;
    if (!asset) blockers.push(issue(m.path, "unknown_reference", { ref_type: "media_assets", ref_id: m.value as number }));
    else if (asset.status !== "ready") blockers.push(issue(m.path, "media_not_ready", { media_id: asset.id }));
    else if (blank(asset.translations[def]?.alt) && !asset.is_decorative) blockers.push(issue(m.path, "media_alt_missing", { media_id: asset.id, locale: def }));
  }
  for (const e of slugConflicts(db, root, snap)) blockers.push(issue(e.path, "duplicate", {}));
  for (const code of MOCK_ACTIVE_LOCALE_CODES) {
    if (code === def) continue;
    const t = snap.translations.find((x) => x.locale_code === code);
    if (!t || !t.is_enabled || blank(t.title)) warnings.push(issue(`/translations/${code}`, "translation_incomplete", { locale: code, missing: 1 }, false));
  }
  return { blockers, warnings };
}

function titleOf(snap: MockEntrySnapshot, locale: string): { title: string | null; locale: string | null; slug: string | null } {
  for (const code of [locale, DEFAULT_LOCALE_CODE, ...snap.translations.map((t) => t.locale_code)]) {
    const t = snap.translations.find((x) => x.locale_code === code && !blank(x.title));
    if (t) return { title: t.title, locale: t.locale_code, slug: t.slug };
  }
  return { title: null, locale: null, slug: null };
}

export function entryView(db: MockDb, root: MockCollectionEntry, detail: boolean, locale = DEFAULT_LOCALE_CODE): CollectionEntryListItem | CollectionEntryDetail {
  const snap = working(db, root);
  const c = collectionOf(db, root);
  const t = titleOf(snap, locale);
  const draft = engine.hasDraft(db, root) ? engine.draftRow(db, root) : undefined;
  const list: CollectionEntryListItem = {
    id: root.id,
    public_id: root.public_id,
    collection_key: root.collection_key,
    title: t.title,
    title_locale: t.locale,
    slug: t.slug,
    sort_order: snap.entry.sort_order,
    schema_version: snap.entry.schema_version,
    schema_stale: snap.entry.schema_version < c.schema_version,
    translation_status: Object.fromEntries(
      MOCK_ACTIVE_LOCALE_CODES.map((code) => {
        const row = snap.translations.find((x) => x.locale_code === code);
        return [code, { enabled: Boolean(row?.is_enabled), title: !blank(row?.title), slug: !blank(row?.slug) }];
      })
    ),
    draft: draft ? { revision_id: draft.id, version: draft.version, created_at: draft.created_at, created_by: draft.created_by } : null,
    status: root.status,
    lock_version: root.lock_version,
    has_unpublished_changes: engine.hasDraft(db, root),
    published_at: root.published_at,
    first_published_at: root.first_published_at,
    scheduled_at: scheduledAtOf(db, "collection-entries", root.id),
    unpublished_at: root.unpublished_at,
    created_by: root.created_by,
    updated_by: root.updated_by,
    created_at: root.created_at,
    updated_at: root.updated_at,
    deleted_at: root.deleted_at,
    purge_at: root.deleted_at ? micros(Date.parse(root.deleted_at) + TRASH_DAYS * 86_400_000, 0) : null,
  };
  if (!detail) return list;
  return {
    ...list,
    data: structuredClone(snap.entry.data),
    translations: Object.fromEntries(snap.translations.map((x) => [x.locale_code, { title: x.title, slug: x.slug, data: structuredClone(x.data), is_enabled: x.is_enabled }])),
    missing_locales: MOCK_ACTIVE_LOCALE_CODES.filter((code) => {
      const row = snap.translations.find((x) => x.locale_code === code);
      return !row || !row.is_enabled || blank(row.title);
    }),
    schedule: scheduleMember(db, "collection-entries", root.id),
  };
}

// The collection a route names; a trashed one hides its whole entries tree (17.1 C-2).
function openCollection(db: MockDb, key: string): MockCollection {
  const c = findCollection(db, key);
  if (isTrashed(c)) throw notFound();
  return c;
}
function entryOf(db: MockDb, key: string, id: string): MockCollectionEntry {
  openCollection(db, key);
  const e = db.collectionEntries.find((x) => String(x.id) === id && x.collection_key === key);
  if (!e) throw notFound();
  return e;
}

const ENTRY_SORTS = ["sort_order", "title", "updated_at", "created_at", "published_at", "status", "deleted_at"];
export function listEntries(db: MockDb, key: string, params: Params) {
  openCollection(db, key);
  rejectUnknown(params, ["page", "limit", "keyword", "locale", "status", "has_unpublished_changes", "trashed", "sort"]);
  const errors: ApiFieldError[] = [];
  const trashed = boolParam(params, "trashed") ?? false;
  const pending = boolParam(params, "has_unpublished_changes");
  const keyword = params.get("keyword")?.trim().toLowerCase();
  const locale = params.get("locale") ?? DEFAULT_LOCALE_CODE;
  if (!(MOCK_LOCALE_CODES as readonly string[]).includes(locale)) errors.push({ in: "query", path: "/locale", code: "unknown_reference" });
  const statuses = params.get("status")?.split(",").filter(Boolean);
  if (statuses && (statuses.length > 5 || statuses.some((s) => !STATUSES.includes(s)))) errors.push({ in: "query", path: "/status", code: "not_in_enum", params: { expected: STATUSES } });
  const sort = params.get("sort") ?? "sort_order";
  const m = /^(-?)([a-z_]+)$/.exec(sort);
  if (!m || !ENTRY_SORTS.includes(m[2])) errors.push({ in: "query", path: "/sort", code: "not_in_enum", params: { expected: ENTRY_SORTS } });
  if (keyword && [...keyword].length > 100) errors.push({ in: "query", path: "/keyword", code: "too_long", params: { max: 100 } });
  pageOf(params, 20);
  if (errors.length) throw validationFailed(errors);
  if (trashed) need(db, "delete", "GET", "/collections/{key}/entries?trashed=true");
  let rows = db.collectionEntries.filter((e) => e.collection_key === key && (e.deleted_at !== null) === trashed);
  // keyword and sort=title look at the saved rows only (05 17.8)
  if (keyword) rows = rows.filter((e) => e.live.translations.some((t) => t.title.toLowerCase().includes(keyword) || (t.slug ?? "").includes(keyword)));
  if (statuses?.length) rows = rows.filter((e) => statuses.includes(e.status));
  if (pending !== undefined) rows = rows.filter((e) => engine.hasDraft(db, e) === pending);
  const items = rows.map((e) => entryView(db, e, false, locale) as CollectionEntryListItem);
  const sorted = sortRows(items, sort, (r, f) => (f === "title" ? (r.title ?? "").toLowerCase() : ((r as unknown as Record<string, string | number | null>)[f] ?? "")), (r) => r.id);
  return paginate(sorted, params);
}

export function getEntry(db: MockDb, key: string, id: string) {
  const root = entryOf(db, key, id);
  return { data: entryView(db, root, true), etag: engine.etagOfRoot(root) };
}

type TransIn = { title?: unknown; slug?: unknown; data?: unknown; is_enabled?: unknown };
// Checks the body of a create / patch against the collection (05 17.8); returns the errors, never throws.
function checkEntryBody(db: MockDb, c: MockCollection, body: Record<string, unknown>, mode: "create" | "patch"): ApiFieldError[] {
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(body)) if (!["sort_order", "data", "translations"].includes(k)) errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  if (mode === "patch" && Object.keys(body).length === 0) errors.push({ in: "body", path: "", code: "min_properties" });
  if (body.sort_order !== undefined) {
    if (typeof body.sort_order !== "number" || !Number.isInteger(body.sort_order)) errors.push({ in: "body", path: "/sort_order", code: "invalid_type" });
    else if (body.sort_order < 0 || body.sort_order > MAX_SORT_ORDER) errors.push({ in: "body", path: "/sort_order", code: "out_of_range" });
  }
  const media: Array<{ path: string; value: unknown }> = [];
  if (body.data !== undefined) {
    if (!isObject(body.data)) errors.push({ in: "body", path: "/data", code: "invalid_type" });
    else {
      for (const i of checkEntryData(c.json_schema as JsonSchema, body.data, "draft")) errors.push({ in: "body", path: `/data${i.path}`, code: i.code, params: i.params as ApiFieldError["params"] });
      media.push(...mediaIds(body.data, "/data"));
    }
  }
  if (body.translations !== undefined) {
    if (!isObject(body.translations)) errors.push({ in: "body", path: "/translations", code: "invalid_type" });
    else {
      for (const [code, raw] of Object.entries(body.translations)) {
        const base = `/translations/${code}`;
        if (!(MOCK_LOCALE_CODES as readonly string[]).includes(code)) {
          errors.push({ in: "body", path: base, code: "unknown_reference" });
          continue;
        }
        if (raw === null && mode === "patch") {
          if (code === DEFAULT_LOCALE_CODE) errors.push({ in: "body", path: base, code: "required" });
          continue;
        }
        if (!isObject(raw)) {
          errors.push({ in: "body", path: base, code: "invalid_type" });
          continue;
        }
        const t = raw as TransIn;
        for (const k of Object.keys(raw)) if (!["title", "slug", "data", "is_enabled"].includes(k)) errors.push({ in: "body", path: `${base}/${k}`, code: "unknown_field" });
        if (t.title !== undefined || mode === "create") {
          if (typeof t.title !== "string" || t.title.trim() === "") errors.push({ in: "body", path: `${base}/title`, code: "required" });
          else if ([...t.title.trim()].length > MAX_ENTRY_TITLE) errors.push({ in: "body", path: `${base}/title`, code: "too_long", params: { max: MAX_ENTRY_TITLE } });
        }
        if (t.slug !== undefined && t.slug !== null && t.slug !== "") {
          if (!c.has_slug) errors.push({ in: "body", path: `${base}/slug`, code: "not_applicable" });
          else if (typeof t.slug !== "string" || !ENTRY_SLUG_RE.test(t.slug)) errors.push({ in: "body", path: `${base}/slug`, code: "pattern_mismatch" });
          else if (t.slug.length > MAX_ENTRY_SLUG) errors.push({ in: "body", path: `${base}/slug`, code: "too_long", params: { max: MAX_ENTRY_SLUG } });
        }
        if (t.is_enabled !== undefined && typeof t.is_enabled !== "boolean") errors.push({ in: "body", path: `${base}/is_enabled`, code: "invalid_type" });
        if (t.data !== undefined) {
          if (!isObject(t.data)) errors.push({ in: "body", path: `${base}/data`, code: "invalid_type" });
          else {
            for (const i of checkEntryData(c.localized_schema as JsonSchema, t.data, "draft")) errors.push({ in: "body", path: `${base}/data${i.path}`, code: i.code, params: i.params as ApiFieldError["params"] });
            media.push(...mediaIds(t.data, `${base}/data`));
          }
        }
      }
      if (mode === "create" && !isObject(body.translations[DEFAULT_LOCALE_CODE])) errors.push({ in: "body", path: `/translations/${DEFAULT_LOCALE_CODE}/title`, code: "required" });
    }
  } else if (mode === "create") errors.push({ in: "body", path: "/translations", code: "required" });
  for (const m of media) {
    if (m.value === null) continue;
    if (typeof m.value !== "number" || !Number.isInteger(m.value) || m.value < 1) errors.push({ in: "body", path: m.path, code: "invalid_type" });
    else if (!assetOf(db, m.value)) errors.push({ in: "body", path: m.path, code: "unknown_reference", params: { ref_type: "media_assets", ref_id: m.value } });
  }
  return errors;
}

const rowOf = (code: string, t: TransIn): MockEntryTranslation => ({
  locale_code: code,
  title: typeof t.title === "string" ? t.title.trim() : "",
  slug: typeof t.slug === "string" && t.slug !== "" ? t.slug : null,
  data: isObject(t.data) ? structuredClone(t.data) : {},
  is_enabled: t.is_enabled === undefined ? true : (t.is_enabled as boolean),
});
const sortedRows = (rows: MockEntryTranslation[]) => rows.slice().sort((a, b) => MOCK_LOCALE_CODES.indexOf(a.locale_code as never) - MOCK_LOCALE_CODES.indexOf(b.locale_code as never));

export function createEntry(db: MockDb, key: string, body: unknown) {
  const c = openCollection(db, key);
  need(db, "create", "POST", "/collections/{key}/entries");
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const errors = checkEntryBody(db, c, body, "create");
  if (errors.length) throw validationFailed(errors);
  const translations = Object.entries(body.translations as Record<string, TransIn>).map(([code, t]) => rowOf(code, t));
  const probe = { id: -1, collection_key: key } as MockCollectionEntry;
  const clash = slugConflicts(db, probe, { entry: { data: {}, schema_version: 1, sort_order: 0 }, translations });
  if (clash.length) throw duplicate(clash.map((e) => ({ ...e, in: "body" as const, code: "duplicate" })));
  const id = db.nextCollectionEntryId++;
  const stamp = tick(db);
  const root: MockCollectionEntry = {
    id,
    public_id: uuid("e0", id),
    key: String(id),
    collection_key: key,
    status: "draft",
    lock_version: 1,
    published_at: null,
    first_published_at: null,
    unpublished_at: null,
    created_by: MOCK_USER,
    updated_by: MOCK_USER,
    created_at: stamp,
    updated_at: stamp,
    deleted_at: null,
    live: {
      entry: { data: isObject(body.data) ? structuredClone(body.data) : {}, schema_version: c.schema_version, sort_order: typeof body.sort_order === "number" ? body.sort_order : 0 },
      translations: sortedRows(translations),
    },
  };
  db.collectionEntries.push(root);
  return { data: engine.writeResult(db, root), etag: engine.etagOfRoot(root) };
}

export function patchEntry(db: MockDb, key: string, id: string, body: unknown, ifMatch: string | null) {
  const c = openCollection(db, key);
  const root = entryOf(db, key, id);
  if (db.collectionRole === "viewer") need(db, "update", "PATCH", "/collections/{key}/entries/{id}");
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const translator = engine.translator(db);
  const canUpdate = allowedAction(db, "update");
  const canTranslate = allowedAction(db, "translate");
  if (!canUpdate && !canTranslate) throw forbidden("cms.collections:update PATCH /collections/{key}/entries/{id}");
  // 17.1 C-8: data, sort_order, is_enabled, adding / removing a language row = update; title / slug / data of a language row = update or translate.
  if (!canUpdate) {
    const denied = (what: string) => forbidden(`cms.collections:update (${what}) PATCH /collections/{key}/entries/{id}`);
    if (body.data !== undefined) throw denied("data");
    if (body.sort_order !== undefined) throw denied("sort_order");
    const before = working(db, root);
    for (const [code, raw] of Object.entries((isObject(body.translations) ? body.translations : {}) as Record<string, unknown>)) {
      if (raw === null || !before.translations.some((t) => t.locale_code === code)) throw denied("language row");
      if (isObject(raw) && raw.is_enabled !== undefined) throw denied("is_enabled");
    }
  }
  void translator;
  if (!ifMatch) throw preconditionRequired();
  if (ifMatch !== engine.etagOfRoot(root)) throw lockConflict();
  engine.trashedCheck(root);
  const errors = checkEntryBody(db, c, body, "patch");
  if (errors.length) throw validationFailed(errors);

  const before = working(db, root);
  const next: MockEntrySnapshot = structuredClone(before);
  if (typeof body.sort_order === "number") next.entry.sort_order = body.sort_order;
  if (isObject(body.data)) next.entry.data = structuredClone(body.data);
  for (const [code, raw] of Object.entries((isObject(body.translations) ? body.translations : {}) as Record<string, unknown>)) {
    if (raw === null) {
      next.translations = next.translations.filter((t) => t.locale_code !== code);
      continue;
    }
    const t = raw as TransIn;
    const row = next.translations.find((x) => x.locale_code === code);
    if (!row) next.translations.push(rowOf(code, t));
    else {
      if (typeof t.title === "string") row.title = t.title.trim();
      if (t.slug !== undefined) row.slug = typeof t.slug === "string" && t.slug !== "" ? t.slug : null;
      if (isObject(t.data)) row.data = structuredClone(t.data);
      if (typeof t.is_enabled === "boolean") row.is_enabled = t.is_enabled;
    }
  }
  next.translations = sortedRows(next.translations);
  if (JSON.stringify(next) === JSON.stringify(before)) return { data: engine.writeResult(db, root), etag: engine.etagOfRoot(root) };
  // A slug taken by another entry's LIVE row is refused at save, whatever the status (the backend does it for a published entry's draft too, which
  // 05 17.8 does not say); a draft that collides LATER (the other entry published its address after) is caught at publish.
  const clash = slugConflicts(db, root, next);
  if (clash.length) throw duplicate(clash.map((e) => ({ ...e, in: "body" as const, path: e.path, code: "duplicate" })));
  next.entry.schema_version = c.schema_version;
  const { snapshot, stamp } = engine.beginWrite(db, root);
  Object.assign(snapshot, next);
  engine.commitWrite(root, stamp);
  return { data: engine.writeResult(db, root), etag: engine.etagOfRoot(root) };
}

// ---- commands: every one first checks that the id belongs to the collection of the route -------------------------------------
const guarded = <A extends unknown[], R>(right: Right, method: string, suffix: string, fn: (db: MockDb, id: string, ...rest: A) => R) =>
  (db: MockDb, key: string, id: string, ...rest: A): R => {
    entryOf(db, key, id);
    need(db, right, method, `/collections/{key}/entries/{id}${suffix}`);
    return fn(db, id, ...rest);
  };
export const deleteEntry = guarded("delete", "DELETE", "", (db, id, params: Params, ifMatch: string | null) => engine.remove(db, id, params, ifMatch));
// From the trash an entry is judged against the CURRENT schemas first (backend 0c541f6, D2): 422 `in: "entity"` with the path.
export const restoreEntry = guarded("delete", "POST", "/restore", (db, id, ifMatch: string | null) => {
  const root = db.collectionEntries.find((e) => String(e.id) === id)!;
  const c = collectionOf(db, root);
  const errors = entryProblems(root.live, { json_schema: c.json_schema, localized_schema: c.localized_schema, has_slug: c.has_slug }, "draft").map((p) => ({ in: "entity" as const, path: p.path, code: p.code }));
  if (root.deleted_at !== null && errors.length > 0 && ifMatch === engine.etagOfRoot(root)) throw validationFailed(errors);
  return engine.restoreFromTrash(db, id, ifMatch);
});
// D1 (05 17.x): schedule / unschedule. The rights are `cms.collections:schedule` AND `:publish` (BR-11): the `workflowRole` and the collection role decide.
export const scheduleEntry = guarded("publish", "POST", "/schedule", (db, id, body: unknown, ifMatch: string | null) => engine.d1.schedule(db, id, body, ifMatch));
export const unscheduleEntry = guarded("publish", "DELETE", "/schedule", (db, id, ifMatch: string | null) => engine.d1.unschedule(db, id, ifMatch));
export const fireEntrySchedule = guarded("read", "POST", "", (db, id) => engine.d1.fire(db, id));
export const failEntrySchedule = guarded("read", "POST", "", (db, id, lastError?: string) => engine.d1.fail3(db, id, lastError));
export const makeEntryScheduleOverdue = guarded("read", "POST", "", (db, id) => engine.d1.makeOverdue(db, id));
export const unpublishEntry = guarded("unpublish", "POST", "/unpublish", (db, id, params: Params, ifMatch: string | null) => engine.unpublish(db, id, params, ifMatch));
export const discardEntryDraft = guarded("update", "POST", "/discard-draft", (db, id, ifMatch: string | null) => engine.discardDraft(db, id, ifMatch));
export const listEntryRevisions = (db: MockDb, key: string, id: string, params: Params) => {
  entryOf(db, key, id);
  return engine.listRevisions(db, id, params);
};
export const getEntryRevision = (db: MockDb, key: string, id: string, revId: string) => {
  entryOf(db, key, id);
  return engine.getRevision(db, id, revId);
};

export function publishEntry(db: MockDb, key: string, id: string, params: Params, body: unknown, ifMatch: string | null) {
  const root = entryOf(db, key, id);
  need(db, "publish", "POST", "/collections/{key}/entries/{id}/publish");
  const result = engine.publish(db, id, params, body, ifMatch);
  if (result.etag !== undefined) {
    const c = collectionOf(db, root);
    root.live.entry.schema_version = c.schema_version;
    return { ...result, data: { ...(result.data as object), schema_version: c.schema_version, schema_stale: false } };
  }
  return result;
}

export function restoreEntryRevision(db: MockDb, key: string, id: string, revId: string, body: unknown, ifMatch: string | null) {
  const root = entryOf(db, key, id);
  need(db, "update", "POST", "/collections/{key}/entries/{id}/revisions/{revId}/restore");
  // The snapshot is judged against the CURRENT schema (draft mode), languages and media (05 17.10): all or nothing, `in: "entity"`.
  const rev = engine.revList(db, root).find((r) => String(r.id) === revId);
  if (rev && rev.kind !== "draft") {
    const c = collectionOf(db, root);
    const snap = rev.snapshot as unknown as MockEntrySnapshot;
    const errors: ApiFieldError[] = [];
    for (const p of entryProblems(snap, { json_schema: c.json_schema, localized_schema: c.localized_schema, has_slug: c.has_slug }, "draft")) errors.push({ in: "entity", path: p.path, code: p.code });
    for (const m of [...mediaIds(snap.entry.data, "/data"), ...snap.translations.flatMap((t) => mediaIds(t.data, `/translations/${t.locale_code}/data`))]) {
      if (typeof m.value === "number" && !assetOf(db, m.value)) errors.push({ in: "entity", path: m.path, code: "unknown_reference" });
    }
    if (errors.length) throw validationFailed(errors);
  }
  return engine.restoreRevision(db, id, revId, body, ifMatch);
}

export const touchEntryAsSomeoneElse = (db: MockDb, id: number) => engine.touchAsSomeoneElse(db, id);

// ---------------------------------------------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------------------------------------------
function seedEntry(id: number, status: MockCollectionEntry["status"], translations: MockEntryTranslation[], data: Record<string, unknown>, sort: number, rest: Partial<MockCollectionEntry> = {}): MockCollectionEntry {
  return {
    id,
    public_id: uuid("e0", id),
    key: String(id),
    collection_key: "team",
    status,
    lock_version: 1,
    published_at: status === "published" ? SEED_AT : null,
    first_published_at: status === "published" ? SEED_AT : null,
    unpublished_at: null,
    created_by: SOMCHAI,
    updated_by: SOMCHAI,
    created_at: SEED_AT,
    updated_at: SEED_AT,
    deleted_at: null,
    live: { entry: { data, schema_version: 1, sort_order: sort }, translations },
    ...rest,
  };
}
const tr = (locale_code: string, title: string, slug: string | null, data: Record<string, unknown>, is_enabled = true): MockEntryTranslation => ({ locale_code, title, slug, data, is_enabled });
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

// INVENTED: a "team" collection with a shared part (year, photo, start date, active) and a localized part (role, biography); a second collection
// without entries (can be deleted); a trashed one. Entries: 1 published, 2 draft, 3 published with a pending draft whose English slug equals
// entry 1's (the duplicate-slug blocker), 4 in the trash.
export function seedCollections(db: MockDb) {
  const team: MockCollection = {
    id: 1,
    public_id: uuid("c0", 1),
    key: "team",
    name: "Team members",
    description: "The people shown on the About page.",
    icon: "users",
    is_active: true,
    sort_order: 10,
    title_field: "title",
    has_slug: true,
    json_schema: {
      type: "object",
      additionalProperties: false,
      required: ["year"],
      properties: {
        year: { type: "integer", minimum: 1990, maximum: 2100, title: "Joined in" },
        photo: { type: "object", properties: { media_id: { type: "integer" } }, additionalProperties: false, title: "Photo" },
        start_date: { type: "string", format: "date", title: "Start date" },
        active: { type: "boolean", title: "Active" },
      },
    },
    localized_schema: {
      type: "object",
      additionalProperties: false,
      required: ["role"],
      properties: {
        role: { type: "string", maxLength: 120, title: "Role" },
        bio: { type: "object", "x-richtext": "lite", title: "Biography" },
      },
    },
    ui_schema: { "ui:order": ["year", "role", "photo", "bio", "start_date", "active"], photo: { "ui:widget": "media-picker" }, start_date: { "ui:widget": "date" } },
    schema_version: 1,
    created_by: SOMCHAI,
    updated_by: SOMCHAI,
    created_at: SEED_AT,
    updated_at: SEED_AT,
    deleted_at: null,
  };
  const events: MockCollection = {
    ...team,
    id: 2,
    public_id: uuid("c0", 2),
    key: "events",
    name: "Events",
    description: "",
    icon: null,
    sort_order: 20,
    json_schema: { type: "object", additionalProperties: false, properties: { starts_at: { type: "string", format: "date-time", title: "Starts at" } } },
    localized_schema: EMPTY_SCHEMA() as Record<string, unknown>,
    ui_schema: { "ui:order": ["starts_at"], starts_at: { "ui:widget": "date-time" } },
  };
  const archive: MockCollection = {
    ...events,
    id: 3,
    public_id: uuid("c0", 3),
    key: "archive",
    name: "Archive",
    sort_order: 30,
    deleted_at: micros(Date.UTC(2026, 10, 3, 4, 0, 0), 300),
    updated_at: micros(Date.UTC(2026, 10, 3, 4, 0, 0), 300),
  };
  db.collections = [team, events, archive];
  db.nextCollectionId = 4;
  const somsak = seedEntry(1, "published", [tr("la", "Somsak", "somsak", { role: "Guide", bio: doc("Leads the northern trips.") }), tr("en", "Somsak", "somsak", { role: "Guide" })], { year: 2019, active: true }, 10);
  const noy = seedEntry(2, "draft", [tr("la", "Noy", "noy", { role: "Cook" })], { year: 2022 }, 20);
  const kham = seedEntry(3, "published", [tr("la", "Kham", "kham", { role: "Driver" }), tr("en", "Kham", "kham", { role: "Driver" })], { year: 2021 }, 30);
  const old = seedEntry(4, "archived", [tr("la", "Old member", "old-member", { role: "Guide" })], { year: 2012 }, 40, { deleted_at: micros(Date.UTC(2026, 10, 3, 3, 0, 0), 200) });
  db.collectionEntries = [somsak, noy, kham, old];
  db.nextCollectionEntryId = 5;
  // Kham has a pending draft: its English slug is now Somsak's.
  const draft = structuredClone(kham.live);
  draft.translations[1].slug = "somsak";
  draft.entry.data = { year: 2021, active: false };
  pushRevision(db, "collection-entries", 3, "cms.collection_entries", "draft", draft as unknown as Record<string, unknown>, null, micros(Date.UTC(2026, 10, 3, 5, 0, 0), 400), MOCK_USER);
  kham.lock_version = 2;
  kham.updated_at = micros(Date.UTC(2026, 10, 3, 5, 0, 0), 417);
  kham.updated_by = MOCK_USER;
  // History: one earlier version of Somsak and of the team definition (INVENTED).
  pushRevision(db, "collection-entries", 1, "cms.collection_entries", "history", { entry: { data: { year: 2018 }, schema_version: 1, sort_order: 10 }, translations: [{ locale_code: "la", title: "Somsak V.", slug: "somsak", data: { role: "Helper" }, is_enabled: true }] }, null, micros(Date.UTC(2026, 10, 2, 12, 0, 0), 300), SOMCHAI);
  const before = snapshotOf({ ...team, description: "People of the About page." });
  pushRevision(db, "collections", "team", "cms.collections", "history", before, null, micros(Date.UTC(2026, 10, 2, 12, 0, 0), 300), SOMCHAI);
}
