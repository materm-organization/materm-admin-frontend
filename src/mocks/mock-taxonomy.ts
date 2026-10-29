// In-memory model of the categories and tags endpoints (doc/05 section 11.5; shapes: doc/api/openapi-admin.yaml
// Category, Tag, Create/Update requests). Seeded with the five categories of the admin backend seed
// (`0050_reference_content.sql`: music, camping, outdoor, avenger, hiking; slug = key; the Lao name is the English
// copy). INVENTED: the tags (the seed has none), the posts that make the "in use" rules visible (post 1 is the real
// seeded one), and one trashed tag.
// Soft delete with the 30-day trash, `If-Match` mandatory on PATCH / DELETE / restore, unique key / slug, the in-use
// guard of BR-19 (`ENTITY_REFERENCED`), the translate-only rule of 11.1.3.
import {
  DEFAULT_LOCALE_CODE,
  MOCK_LOCALE_CODES,
  MOCK_USER,
  badRequest,
  boolParam,
  duplicate,
  etagOf,
  fail,
  forbidden,
  invalidState,
  micros,
  notFound,
  paginate,
  pushRevision,
  rejectUnknown,
  requireIfMatch,
  tick,
  validationFailed,
  type MockDb,
  type Params,
} from "@/mocks/mock-core";
import { postsUsing } from "@/mocks/mock-posts";
import type { ApiFieldError } from "@/types/api";
import type { SaveLiveWarning } from "@/types/media";
import type { Category, CategoryTranslation, Tag, TagTranslation, TaxonomyKind } from "@/types/taxonomy";

const SEED_AT = micros(Date.UTC(2026, 9, 26, 9, 0, 0), 160);
const CATEGORY_KEY = /^[a-z][a-z0-9_-]{0,39}$/;
const TAG_KEY = /^[a-z0-9][a-z0-9_-]{0,59}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TRASH_DAYS = 30;

export function seedTaxonomy(db: MockDb) {
  const names: Array<[string, string]> = [["music", "Music"], ["camping", "Camping"], ["outdoor", "Outdoor"], ["avenger", "Avenger"], ["hiking", "Hiking"]];
  db.categories = names.map(([key, name], i) => ({
    id: i + 1,
    public_id: `0192d3a4-7c1e-7b52-9d0a-0000000000c${i + 1}`,
    key,
    sort_order: i + 1,
    is_active: true,
    translations: { la: { name, slug: key, description: null }, en: { name, slug: key, description: null } },
    post_count: 0,
    published_post_count: 0,
    created_by: null,
    updated_by: null,
    created_at: SEED_AT,
    updated_at: SEED_AT,
    deleted_at: null,
    purge_at: null,
  }));
  const tag = (id: number, key: string, name: string, extra: Partial<Tag> = {}): Tag => ({
    id,
    public_id: `0192d3a4-7c1e-7b52-9d0a-0000000000d${id}`,
    key,
    translations: { la: { name, slug: key }, en: { name, slug: key } },
    post_count: 0,
    published_post_count: 0,
    created_by: MOCK_USER,
    updated_by: MOCK_USER,
    created_at: micros(Date.UTC(2026, 9, 24, 9, 0, 0), 100 + id),
    updated_at: micros(Date.UTC(2026, 9, 24, 9, 0, 0), 100 + id),
    deleted_at: null,
    purge_at: null,
    ...extra,
  });
  db.tags = [
    tag(1, "trail", "Trail"),
    tag(2, "night-sky", "Night sky"),
    tag(3, "family", "Family"),
    tag(4, "old-gear", "Old gear", {
      deleted_at: micros(Date.UTC(2026, 9, 20, 9, 0, 0), 100),
      purge_at: micros(Date.UTC(2026, 10, 19, 9, 0, 0), 100),
      updated_at: micros(Date.UTC(2026, 9, 20, 9, 0, 0), 100),
    }),
  ];
  db.nextCategoryId = 6;
  db.nextTagId = 5;
}

// ---------------------------------------------------------------------------------------------------------------
// Derived counts
// ---------------------------------------------------------------------------------------------------------------
// The posts model (`mock-posts.ts`) is the source: a post in the trash counts for nothing.
function counts(db: MockDb, kind: TaxonomyKind, id: number) {
  const posts = postsUsing(db, kind, id);
  return { post_count: posts.length, published_post_count: posts.filter((p) => p.published).length };
}

function viewCategory(db: MockDb, c: Category, warnings?: SaveLiveWarning[]): Category {
  return { ...structuredClone(c), ...counts(db, "categories", c.id), ...(warnings ? { warnings } : {}) };
}
function viewTag(db: MockDb, t: Tag, warnings?: SaveLiveWarning[]): Tag {
  return { ...structuredClone(t), ...counts(db, "tags", t.id), ...(warnings ? { warnings } : {}) };
}
const viewOf = (db: MockDb, kind: TaxonomyKind, row: Category | Tag, warnings?: SaveLiveWarning[]) =>
  kind === "categories" ? viewCategory(db, row as Category, warnings) : viewTag(db, row as Tag, warnings);

function store(db: MockDb, kind: TaxonomyKind): Array<Category | Tag> {
  return kind === "categories" ? db.categories : db.tags;
}

function findRow(db: MockDb, kind: TaxonomyKind, id: string): Category | Tag {
  const row = store(db, kind).find((r) => String(r.id) === id);
  if (!row) throw notFound();
  return row;
}

// ---------------------------------------------------------------------------------------------------------------
// Snapshots (05 11.7 item 3)
// ---------------------------------------------------------------------------------------------------------------
export function taxonomySnapshot(kind: TaxonomyKind, row: Category | Tag): Record<string, unknown> {
  const translations = Object.entries(row.translations).map(([locale_code, t]) =>
    kind === "categories"
      ? { locale_code, name: t.name, slug: t.slug ?? row.key, description: (t as CategoryTranslation).description ?? null }
      : { locale_code, name: t.name, slug: t.slug ?? row.key }
  );
  if (kind === "categories") {
    const c = row as Category;
    return { category: { key: c.key, sort_order: c.sort_order, is_active: c.is_active }, translations };
  }
  return { tag: { key: row.key }, translations };
}

// ---------------------------------------------------------------------------------------------------------------
// GET list / detail
// ---------------------------------------------------------------------------------------------------------------
export function listTaxonomy(db: MockDb, kind: TaxonomyKind, params: Params) {
  rejectUnknown(params, kind === "categories" ? ["page", "limit", "keyword", "trashed", "is_active", "sort"] : ["page", "limit", "keyword", "trashed", "unused", "sort"]);
  const trashed = boolParam(params, "trashed") ?? false;
  const isActive = kind === "categories" ? boolParam(params, "is_active") : undefined;
  const unused = kind === "tags" ? boolParam(params, "unused") : undefined;
  const keyword = params.get("keyword");
  const errors: ApiFieldError[] = [];
  if (keyword !== null && [...keyword].length > 100) errors.push({ in: "query", path: "/keyword", code: "too_long", params: { max: 100 } });
  const allowed = kind === "categories"
    ? ["sort_order", "key", "name", "created_at", "updated_at", "deleted_at"]
    : ["key", "name", "post_count", "created_at", "updated_at", "deleted_at"];
  const sort = params.get("sort") ?? (trashed ? "-deleted_at" : kind === "categories" ? "sort_order" : "key");
  const m = /^(-?)([a-z_]+)$/.exec(sort);
  if (!m || !allowed.includes(m[2])) errors.push({ in: "query", path: "/sort", code: "not_in_enum" });
  if (errors.length) throw validationFailed(errors);

  const kw = keyword?.trim().toLowerCase();
  let rows = store(db, kind).filter((r) => Boolean(r.deleted_at) === trashed).map((r) => viewOf(db, kind, r));
  if (kw) rows = rows.filter((r) => r.key.includes(kw) || Object.values(r.translations).some((t) => t.name.toLowerCase().includes(kw)));
  if (isActive !== undefined) rows = rows.filter((r) => (r as Category).is_active === isActive);
  if (unused === true) rows = rows.filter((r) => r.post_count === 0);
  const dir = m![1] ? -1 : 1;
  const field = m![2];
  const valueOf = (r: Category | Tag): string | number => {
    if (field === "name") return r.translations[DEFAULT_LOCALE_CODE]?.name ?? "";
    return ((r as unknown as Record<string, unknown>)[field] as string | number | null) ?? "";
  };
  rows.sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return cmp * dir || a.id - b.id;
  });
  return paginate(rows, params);
}

export function getTaxonomyRow(db: MockDb, kind: TaxonomyKind, id: string) {
  const row = findRow(db, kind, id);
  return { data: viewOf(db, kind, row), etag: etagOf(row.updated_at) };
}

// ---------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

function checkTranslations(kind: TaxonomyKind, translations: unknown, errors: ApiFieldError[], mode: "create" | "patch") {
  if (!isObject(translations)) {
    errors.push({ in: "body", path: "/translations", code: translations === undefined ? "required" : "invalid_type" });
    return;
  }
  if (mode === "create" && Object.keys(translations).length === 0) errors.push({ in: "body", path: "/translations", code: "too_short", params: { min: 1 } });
  for (const [code, t] of Object.entries(translations)) {
    const base = `/translations/${code}`;
    if (!(MOCK_LOCALE_CODES as readonly string[]).includes(code)) {
      errors.push({ in: "body", path: base, code: "unknown_reference" });
      continue;
    }
    if (t === null) {
      if (mode === "create") errors.push({ in: "body", path: base, code: "invalid_type" });
      else if (code === DEFAULT_LOCALE_CODE) errors.push({ in: "body", path: base, code: "required" });
      continue;
    }
    if (!isObject(t)) {
      errors.push({ in: "body", path: base, code: "invalid_type" });
      continue;
    }
    const allowed = kind === "categories" ? ["name", "slug", "description"] : ["name", "slug"];
    for (const f of Object.keys(t)) if (!allowed.includes(f)) errors.push({ in: "body", path: `${base}/${f}`, code: "unknown_field" });
    const name = t.name;
    if (typeof name !== "string" || name.trim() === "") errors.push({ in: "body", path: `${base}/name`, code: name === undefined ? "required" : "too_short", params: { min: 1 } });
    else if ([...name.trim()].length > 60) errors.push({ in: "body", path: `${base}/name`, code: "too_long", params: { max: 60 } });
    if (t.slug !== undefined && t.slug !== null && t.slug !== "") {
      if (typeof t.slug !== "string" || !SLUG.test(t.slug)) errors.push({ in: "body", path: `${base}/slug`, code: "pattern_mismatch" });
      else if (t.slug.length > 100) errors.push({ in: "body", path: `${base}/slug`, code: "too_long", params: { max: 100 } });
    }
    if (kind === "categories" && t.description !== undefined && t.description !== null && (typeof t.description !== "string" || [...t.description].length > 300)) {
      errors.push({ in: "body", path: `${base}/description`, code: "too_long", params: { max: 300 } });
    }
  }
  if (mode === "create" && isObject(translations) && !isObject(translations[DEFAULT_LOCALE_CODE])) {
    errors.push({ in: "body", path: `/translations/${DEFAULT_LOCALE_CODE}/name`, code: "required" });
  }
}

function slugFor(key: string, t: { slug?: string | null }): string {
  return t.slug ? t.slug : key.replace(/_/g, "-");
}

// A unique violation on `key` or on (locale, slug) among rows that are not in the trash.
function conflicts(db: MockDb, kind: TaxonomyKind, row: { id?: number; key: string; translations: Record<string, { slug?: string | null }> }, checkKey: boolean): ApiFieldError[] {
  const errors: ApiFieldError[] = [];
  const others = store(db, kind).filter((r) => !r.deleted_at && r.id !== row.id);
  if (checkKey && others.some((r) => r.key === row.key)) errors.push({ in: "body", path: "/key", code: "duplicate" });
  for (const [locale, t] of Object.entries(row.translations)) {
    const slug = slugFor(row.key, t);
    if (others.some((r) => r.translations[locale] && slugFor(r.key, r.translations[locale]) === slug)) {
      errors.push({ in: "body", path: `/translations/${locale}/slug`, code: "duplicate" });
    }
  }
  return errors;
}

function normaliseTranslation(kind: TaxonomyKind, key: string, t: Record<string, unknown>): CategoryTranslation | TagTranslation {
  const out: CategoryTranslation = { name: String(t.name).trim(), slug: slugFor(key, t as { slug?: string | null }) };
  if (kind === "categories") out.description = typeof t.description === "string" && t.description.trim() ? t.description.trim() : null;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------------------------------------------
export function createTaxonomy(db: MockDb, kind: TaxonomyKind, body: unknown) {
  if (!isObject(body)) throw badRequest();
  const allowed = kind === "categories" ? ["key", "sort_order", "is_active", "translations"] : ["key", "translations"];
  const structural = Object.keys(body).filter((k) => !allowed.includes(k)).map((k) => ({ in: "body" as const, path: `/${k}`, code: "unknown_field" }));
  if (structural.length) throw validationFailed(structural);
  if (db.translateOnly.includes("categories")) throw forbidden("create");

  const errors: ApiFieldError[] = [];
  const key = body.key;
  const pattern = kind === "categories" ? CATEGORY_KEY : TAG_KEY;
  if (typeof key !== "string") errors.push({ in: "body", path: "/key", code: key === undefined ? "required" : "invalid_type" });
  else if (!pattern.test(key)) errors.push({ in: "body", path: "/key", code: "pattern_mismatch" });
  if (kind === "categories") {
    if ("sort_order" in body && (typeof body.sort_order !== "number" || !Number.isInteger(body.sort_order) || body.sort_order < 0 || body.sort_order > 10000)) {
      errors.push({ in: "body", path: "/sort_order", code: "out_of_range" });
    }
    if ("is_active" in body && typeof body.is_active !== "boolean") errors.push({ in: "body", path: "/is_active", code: "invalid_type" });
  }
  checkTranslations(kind, body.translations, errors, "create");
  if (errors.length) throw validationFailed(errors);

  const k = key as string;
  const translations = Object.fromEntries(
    Object.entries(body.translations as Record<string, Record<string, unknown>>).map(([code, t]) => [code, normaliseTranslation(kind, k, t)])
  );
  const clash = conflicts(db, kind, { key: k, translations }, true);
  if (clash.length) throw duplicate(clash);

  const at = tick(db);
  const common = {
    public_id: `0192d3a4-7c1e-7b52-9d0a-${String(kind === "categories" ? db.nextCategoryId : db.nextTagId).padStart(12, "0")}`,
    key: k,
    post_count: 0,
    published_post_count: 0,
    created_by: MOCK_USER,
    updated_by: MOCK_USER,
    created_at: at,
    updated_at: at,
    deleted_at: null,
    purge_at: null,
  };
  let row: Category | Tag;
  if (kind === "categories") {
    const max = db.categories.reduce((m, c) => Math.max(m, c.sort_order), 0);
    row = {
      ...common,
      id: db.nextCategoryId++,
      sort_order: typeof body.sort_order === "number" ? body.sort_order : max + 1,
      is_active: typeof body.is_active === "boolean" ? body.is_active : true,
      translations: translations as Category["translations"],
    };
    db.categories.push(row);
  } else {
    row = { ...common, id: db.nextTagId++, translations: translations as Tag["translations"] };
    db.tags.push(row);
  }
  return { data: viewOf(db, kind, row), etag: etagOf(row.updated_at) };
}

// ---------------------------------------------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------------------------------------------
export function patchTaxonomy(db: MockDb, kind: TaxonomyKind, id: string, body: unknown, ifMatch: string | null) {
  const row = findRow(db, kind, id);
  if (!isObject(body)) throw badRequest();
  const allowed = kind === "categories" ? ["sort_order", "is_active", "translations"] : ["translations"];
  const structural: ApiFieldError[] = [];
  for (const k of Object.keys(body)) {
    if (k === "key") structural.push({ in: "body", path: "/key", code: "immutable" });
    else if (!allowed.includes(k)) structural.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  }
  if (Object.keys(body).length === 0) structural.push({ in: "body", path: "", code: "min_properties" });
  if (structural.length) throw validationFailed(structural);
  requireIfMatch(ifMatch, etagOf(row.updated_at));
  if (row.deleted_at) throw invalidState("trashed");

  const errors: ApiFieldError[] = [];
  if (kind === "categories") {
    if ("sort_order" in body && (typeof body.sort_order !== "number" || !Number.isInteger(body.sort_order) || body.sort_order < 0 || body.sort_order > 10000)) {
      errors.push({ in: "body", path: "/sort_order", code: "out_of_range" });
    }
    if ("is_active" in body && typeof body.is_active !== "boolean") errors.push({ in: "body", path: "/is_active", code: "invalid_type" });
  }
  if ("translations" in body) checkTranslations(kind, body.translations, errors, "patch");
  if (errors.length) throw validationFailed(errors);

  const next = structuredClone(row);
  if (kind === "categories") {
    if ("sort_order" in body) (next as Category).sort_order = body.sort_order as number;
    if ("is_active" in body) (next as Category).is_active = body.is_active as boolean;
  }
  if (isObject(body.translations)) {
    for (const [code, t] of Object.entries(body.translations as Record<string, Record<string, unknown> | null>)) {
      if (t === null) delete next.translations[code];
      else {
        const merged = { ...(next.translations[code] ?? {}), ...t };
        // A slug that was not sent stays; one that was sent empty falls back to the key.
        if (t.slug === undefined && next.translations[code]?.slug) merged.slug = next.translations[code].slug;
        next.translations[code] = normaliseTranslation(kind, row.key, merged as Record<string, unknown>) as never;
      }
    }
  }

  const same = JSON.stringify(taxonomySnapshot(kind, next)) === JSON.stringify(taxonomySnapshot(kind, row));
  if (db.translateOnly.includes("categories") && !same) {
    const bad = (() => {
      if (kind === "categories") {
        if ((next as Category).sort_order !== (row as Category).sort_order) return "/sort_order";
        if ((next as Category).is_active !== (row as Category).is_active) return "/is_active";
      }
      const defSlugBefore = row.translations[DEFAULT_LOCALE_CODE]?.slug;
      const defSlugAfter = next.translations[DEFAULT_LOCALE_CODE]?.slug;
      return defSlugBefore !== defSlugAfter ? `/translations/${DEFAULT_LOCALE_CODE}/slug` : null;
    })();
    if (bad) throw forbidden(bad);
  }
  if (same) return { data: viewOf(db, kind, row), etag: etagOf(row.updated_at) };

  const clash = conflicts(db, kind, next, false);
  if (clash.length) throw duplicate(clash);

  const warnings: SaveLiveWarning[] = [];
  if (kind === "categories" && (next as Category).is_active === false && (row as Category).is_active) {
    const published = counts(db, "categories", row.id).published_post_count;
    if (published > 0) warnings.push({ path: "/is_active", code: "category_in_use", message: "Published posts still use this category.", params: { published_post_count: published } });
  }
  const at = tick(db);
  pushRevision(db, kind, row.id, kind === "categories" ? "cms.categories" : "cms.tags", "history", taxonomySnapshot(kind, row), null, at, MOCK_USER);
  Object.assign(row, next, { updated_at: at, updated_by: MOCK_USER });
  return { data: viewOf(db, kind, row, warnings), etag: etagOf(row.updated_at) };
}

// ---------------------------------------------------------------------------------------------------------------
// DELETE / restore
// ---------------------------------------------------------------------------------------------------------------
export function deleteTaxonomy(db: MockDb, kind: TaxonomyKind, id: string, ifMatch: string | null) {
  const row = findRow(db, kind, id);
  requireIfMatch(ifMatch, etagOf(row.updated_at));
  if (db.translateOnly.includes("categories")) throw forbidden("delete");
  if (row.deleted_at) return;
  const refs = postsUsing(db, kind, row.id)
    .filter((p) => p.published)
    .map((p) => ({ entity_type: "cms.post", id: p.id, title: p.title, field: kind === "categories" ? "/category_id" : "/tag_ids" }));
  if (refs.length) {
    throw fail(409, "ENTITY_REFERENCED", `Cannot delete: ${refs.length} published post(s) use it.`, {
      details: { references: refs.slice(0, 50), total_references: refs.length, ...(kind === "categories" ? { suggestion: "set_inactive" } : {}) },
    });
  }
  const at = tick(db);
  row.deleted_at = at;
  row.purge_at = new Date(Date.parse(at) + TRASH_DAYS * 86_400_000).toISOString();
  row.updated_at = at;
  row.updated_by = MOCK_USER;
}

export function restoreTaxonomyRow(db: MockDb, kind: TaxonomyKind, id: string, ifMatch: string | null) {
  const row = findRow(db, kind, id);
  requireIfMatch(ifMatch, etagOf(row.updated_at));
  if (db.translateOnly.includes("categories")) throw forbidden("delete");
  if (!row.deleted_at) throw invalidState("not_trashed");
  const clash = conflicts(db, kind, row, true);
  if (clash.length) throw duplicate(clash);
  row.deleted_at = null;
  row.purge_at = null;
  row.updated_at = tick(db);
  row.updated_by = MOCK_USER;
  return { data: viewOf(db, kind, row), etag: etagOf(row.updated_at) };
}

// ---------------------------------------------------------------------------------------------------------------
// Revisions
// ---------------------------------------------------------------------------------------------------------------
type SnapTranslation = { locale_code: string; name: string; slug: string; description?: string | null };

export function restoreTaxonomy(db: MockDb, kind: TaxonomyKind, id: string, rev: { id: number; version: number; schema_version: number; snapshot: Record<string, unknown> }, note: string, ifMatch: string | null) {
  const row = findRow(db, kind, id);
  requireIfMatch(ifMatch, etagOf(row.updated_at));
  if (row.deleted_at) throw invalidState("trashed");
  if (rev.schema_version > 1) throw invalidState("snapshot_incompatible");
  const snap = rev.snapshot as { category?: { sort_order: number; is_active: boolean }; translations?: SnapTranslation[] };
  const list = snap.translations ?? [];
  const errors: ApiFieldError[] = [];
  for (const t of list) {
    if (!(MOCK_LOCALE_CODES as readonly string[]).includes(t.locale_code)) errors.push({ in: "entity", path: `/translations/${t.locale_code}`, code: "unknown_reference" });
  }
  if (errors.length) throw validationFailed(errors);

  const restoredFrom = { revision_id: rev.id, version: rev.version };
  const next = structuredClone(row);
  next.translations = Object.fromEntries(
    list.map((t) => [t.locale_code, kind === "categories" ? { name: t.name, slug: t.slug, description: t.description ?? null } : { name: t.name, slug: t.slug }])
  ) as never;
  if (kind === "categories" && snap.category) {
    (next as Category).sort_order = snap.category.sort_order;
    (next as Category).is_active = snap.category.is_active;
  }
  if (JSON.stringify(taxonomySnapshot(kind, next)) === JSON.stringify(taxonomySnapshot(kind, row))) {
    return { data: { ...viewOf(db, kind, row), restored_from: restoredFrom }, etag: etagOf(row.updated_at) };
  }
  const clash = conflicts(db, kind, next, false);
  if (clash.length) throw duplicate(clash);
  const at = tick(db);
  pushRevision(db, kind, row.id, kind === "categories" ? "cms.categories" : "cms.tags", "restore", taxonomySnapshot(kind, row), note, at, MOCK_USER);
  Object.assign(row, next, { updated_at: at, updated_by: MOCK_USER });
  return { data: { ...viewOf(db, kind, row), restored_from: restoredFrom }, etag: etagOf(row.updated_at) };
}

// Two earlier versions of the `music` category (the state BEFORE two edits). INVENTED history.
export function seedTaxonomyRevisions(db: MockDb) {
  const base = Date.UTC(2026, 9, 20, 8, 0, 0);
  const music = db.categories[0];
  const withName = (la: string, en: string, active = true) => ({
    category: { key: "music", sort_order: 1, is_active: active },
    translations: [
      { locale_code: "la", name: la, slug: "music", description: null },
      { locale_code: "en", name: en, slug: "music", description: null },
    ],
  });
  pushRevision(db, "categories", music.id, "cms.categories", "history", withName("Musics", "Musics"), null, micros(base + 1_000_000), { id: 4, name: "Somchai Vongsa" });
  pushRevision(db, "categories", music.id, "cms.categories", "history", withName("Music", "Music nights"), "renamed", micros(base + 2_000_000), { id: 6, name: "Noy Keomany" });
  const trail = db.tags[0];
  pushRevision(db, "tags", trail.id, "cms.tags", "history", { tag: { key: "trail" }, translations: [{ locale_code: "la", name: "Trails", slug: "trail" }, { locale_code: "en", name: "Trails", slug: "trail" }] }, null, micros(base + 3_000_000), { id: 6, name: "Noy Keomany" });
}
