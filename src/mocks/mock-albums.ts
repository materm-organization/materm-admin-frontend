// In-memory model of the albums endpoints (doc/05 section 13.4, doc/api/openapi-admin.yaml: listAlbums, createAlbum, getAlbum,
// updateAlbum, deleteAlbum, restoreAlbum, list/create/update/delete AlbumItem(s), reorder, publish / unpublish / discard-draft and the
// revisions), strict like the backend: an unknown query parameter or body field is a 422, no `If-Match` is 428, a stale one 409
// `CONFLICT_LOCK_VERSION`, `INVALID_STATE` carries `details.reason`, a refused publish is `PUBLISH_BLOCKED` with JSON pointers
// (`/items/<public_id>/media_id`), a delete of an album or of a picture a section uses is 409 `ENTITY_REFERENCED` that nothing confirms
// (BR-19), `unpublish` of a used album needs `confirm_references=true`, 200 pictures at most (50 per request).
//
// An album is stored like a post: the REAL rows (`live`, written while it is not published) and, for a published album with pending
// edits, a `draft` revision with the working copy. The publish engine is shared with the FAQ model (`mock-faq-album-engine.ts`).
//
// Seeded: albums 1 and 2 are the two the pages model always had (1 published, 2 an unpublished one the "spring" page names; the
// pictures are the 24 seeded media rows). INVENTED: albums 3 - 5 and every caption.
import {
  ALBUM_KEY_PATTERN,
  LAYOUT_HINT_PATTERN,
  MAX_ALBUM_DESCRIPTION,
  MAX_ALBUM_ITEMS,
  MAX_ALBUM_TITLE,
  MAX_CAPTION_DESCRIPTION,
  MAX_CAPTION_TITLE,
  MAX_ITEMS_PER_REQUEST,
  MAX_ITEM_ALT,
  charCount,
} from "@/lib/albums";
import {
  DEFAULT_LOCALE_CODE,
  MOCK_ACTIVE_LOCALE_CODES,
  MOCK_LOCALE_CODES,
  MOCK_USER,
  boolParam,
  duplicate,
  micros,
  notFound,
  paginate,
  pushRevision,
  rejectUnknown,
  tick,
  validationFailed,
  type MockAlbum,
  type MockAlbumItem,
  type MockAlbumSnapshot,
  type MockDb,
  type Params,
} from "@/mocks/mock-core";
import { scheduleMember, scheduledAtOf } from "@/mocks/mock-review-schedule";
import { blank, entityReferenced, findReferences, isObject, issue, makeEngine, TRASH_DAYS, type Reference } from "@/mocks/mock-faq-album-engine";
import type { AlbumDetail, AlbumItem, AlbumListItem } from "@/types/albums";
import type { ApiFieldError } from "@/types/api";
import type { PublishIssue } from "@/types/publishing";
import type { UserRef } from "@/types/media";

const SEED_AT = micros(Date.UTC(2026, 9, 26, 9, 0, 0), 180);
const SOMCHAI: UserRef = { id: 4, name: "Somchai Vongsa" };
const albumPublicId = (id: number) => `0192d3a4-7c1e-7b52-9d0a-3f5e2a1c7a${String(id).padStart(2, "0")}`;
const itemPublicId = (id: number) => `0192d3a4-7c1e-7b52-9d0a-3f5e2a1c8b${String(id).padStart(2, "0")}`;
const STATUSES = ["draft", "in_review", "scheduled", "published", "archived"];
const SORTS = ["key", "title", "updated_at", "status"];

// ---------------------------------------------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------------------------------------------
type ItemSeed = { id: number; media: number; la?: string; en?: string; alt?: string; hint?: string };
function item(seed: ItemSeed, index: number): MockAlbumItem {
  const translations: MockAlbumItem["translations"] = [];
  if (seed.la || seed.alt) translations.push({ locale_code: "la", caption_title: seed.la ?? null, caption_description: null, alt: seed.alt ?? null });
  if (seed.en) translations.push({ locale_code: "en", caption_title: seed.en, caption_description: null, alt: null });
  return { id: seed.id, public_id: itemPublicId(seed.id), media_id: seed.media, sort_order: index, layout_hint: seed.hint ?? null, translations };
}
function album(id: number, key: string, status: MockAlbum["status"], titles: Record<string, string>, items: ItemSeed[], rest: Partial<MockAlbum> = {}, cover: number | null = null): MockAlbum {
  return {
    id,
    public_id: albumPublicId(id),
    key,
    status,
    lock_version: 1,
    published_at: status === "published" ? SEED_AT : null,
    first_published_at: status === "published" ? SEED_AT : null,
    unpublished_at: null,
    created_by: null,
    updated_by: null,
    created_at: SEED_AT,
    updated_at: SEED_AT,
    deleted_at: null,
    live: {
      album: { cover_media_id: cover },
      translations: Object.entries(titles).map(([locale_code, title]) => ({ locale_code, title, description: null })),
      items: items.map(item),
    },
    ...rest,
  };
}

export function seedAlbums(): MockAlbum[] {
  const forest = album(
    1,
    "forest-photo-story",
    "published",
    { la: "Forest photo story", en: "Forest photo story" },
    [
      { id: 1, media: 18, la: "Beneath the canopy", en: "Beneath the canopy" },
      { id: 2, media: 19, la: "A small unfolding fern", en: "A small unfolding fern" },
      { id: 3, media: 20, la: "Water over stone" },
      { id: 4, media: 21, la: "A softer path", hint: "wide" },
      { id: 5, media: 22, la: "Where the light comes through", en: "Where the light comes through" },
    ],
    {},
    18
  );
  forest.live.translations[0].description = "Five photographs from a morning walk under the forest canopy.";
  // INVENTED. 2: a draft that cannot be published - the first picture has no alt text anywhere (media 1 has none) - and the "spring"
  // page (6) names it, so deleting it is refused. The English title is missing (a warning).
  const rivers = album(2, "spring-rivers", "draft", { la: "Spring rivers (draft)" }, [
    { id: 6, media: 1, la: "The first thaw" },
    { id: 7, media: 14, la: "Jungle stream", alt: "Jungle stream flowing over rocks" },
  ]);
  // 3: ready to publish, nothing used yet.
  const summit = album(3, "summit-week", "draft", { la: "Summit week", en: "Summit week" }, [
    { id: 8, media: 2, la: "Two on the ice", en: "Two on the ice" },
    { id: 9, media: 3, la: "Ridge at sunset", en: "Ridge at sunset" },
    { id: 10, media: 4, la: "The wall", en: "The wall" },
  ], {}, 2);
  // 4: in the trash.
  const old = album(4, "old-trips", "archived", { la: "Old trips" }, [{ id: 11, media: 5, la: "Lake" }, { id: 12, media: 6, la: "Ridge" }], {
    deleted_at: micros(Date.UTC(2026, 9, 20, 9, 0, 0), 190),
    unpublished_at: micros(Date.UTC(2026, 9, 20, 9, 0, 0), 190),
    first_published_at: SEED_AT,
    created_by: SOMCHAI,
    updated_by: SOMCHAI,
  });
  // 5: published, with a pending draft (a third picture and a new title: see `seedAlbumRevisions`).
  const camp = album(5, "camp-life", "published", { la: "Camp life", en: "Camp life" }, [
    { id: 13, media: 7, la: "Misty trail", en: "Misty trail" },
    { id: 14, media: 8, la: "The orange pack" },
  ], { created_by: SOMCHAI, updated_by: SOMCHAI });
  return [forest, rivers, summit, old, camp];
}

// The history the screens open: a draft on album 5 and two older versions of album 1.
export function seedAlbumRevisions(db: MockDb) {
  const who = (id: number, name: string): UserRef => ({ id, name });
  const base = Date.UTC(2026, 9, 27, 3, 0, 0);
  for (const a of db.albums.filter((x) => x.status === "published")) {
    pushRevision(db, "albums", a.id, "cms.albums", "published", structuredClone(a.live), null, a.published_at ?? SEED_AT, a.created_by ?? who(4, "Somchai Vongsa"));
  }
  const forest = db.albums[0];
  const older = structuredClone(forest.live);
  older.items = older.items.slice(0, 3);
  pushRevision(db, "albums", 1, "cms.albums", "history", older, "autosave", micros(base - 3 * 86_400_000), who(4, "Somchai Vongsa"));
  const camp = db.albums.find((x) => x.id === 5)!;
  const draft = structuredClone(camp.live);
  draft.translations[0].title = "Camp life (autumn)";
  draft.items.push(item({ id: 15, media: 9, la: "Waterfall", en: "Waterfall" }, 2));
  pushRevision(db, "albums", 5, "cms.albums", "draft", draft, null, micros(base + 3_600_000), who(6, "Noy Keomany"));
  camp.lock_version = 2;
  camp.updated_at = micros(base + 3_600_000, 417);
  camp.updated_by = who(6, "Noy Keomany");
}

// ---------------------------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------------------------
const engine = makeEngine<MockAlbum, AlbumDetail>({
  kind: "albums",
  entityType: "cms.albums",
  permission: "cms.galleries",
  path: "/albums/{id}",
  roots: (db) => db.albums,
  view: (db, root) => albumDetail(db, root),
  validate: (db, root) => validateAlbumForPublish(db, root),
  references: (db, root) => findReferences(db, "album_id", root.id),
  referencedWarning: "album_referenced",
  snapshotRefs: (db, snap) => {
    const s = snap as MockAlbumSnapshot;
    const errors: ApiFieldError[] = [];
    const ok = (id: number | null) => id === null || db.assets.some((x) => x.id === id && !x.deleted_at);
    if (!ok(s.album.cover_media_id)) errors.push({ in: "entity", path: "/album/cover_media_id", code: "unknown_reference" });
    s.items.forEach((it, i) => {
      if (!ok(it.media_id)) errors.push({ in: "entity", path: `/items/${i}/media_id`, code: "unknown_reference" });
    });
    return errors;
  },
  droppedReferences: (db, root, snap) => {
    const keep = new Set((snap as MockAlbumSnapshot).items.map((i) => i.id));
    const draft = db.revisions[`albums/${root.id}`]?.find((r) => r.kind === "draft");
    const now = (draft?.snapshot as unknown as MockAlbumSnapshot | undefined) ?? root.live;
    return now.items.filter((i) => !keep.has(i.id)).flatMap((i) => findReferences(db, "album_item_id", i.id));
  },
  childrenOf: (snap) => (snap as MockAlbumSnapshot).items,
});

export const albumEngine = engine;
const working = (db: MockDb, root: MockAlbum) => engine.working(db, root) as MockAlbumSnapshot;
export const albumWorking = working;
export const albumIsTrashed = (root: MockAlbum) => root.deleted_at !== null;

function mediaRef(db: MockDb, id: number | null) {
  if (id === null) return null;
  const asset = db.assets.find((x) => x.id === id);
  return asset
    ? { id: asset.id, status: asset.status, original_filename: asset.original_filename, mime_type: asset.mime_type, width: asset.width, height: asset.height, url: asset.url }
    : { id, status: "ready" };
}

function titleOf(snap: MockAlbumSnapshot, locale: string): { title: string | null; locale: string | null } {
  for (const code of [locale, DEFAULT_LOCALE_CODE, ...snap.translations.map((t) => t.locale_code)]) {
    const t = snap.translations.find((x) => x.locale_code === code && !blank(x.title));
    if (t) return { title: t.title, locale: t.locale_code };
  }
  return { title: null, locale: null };
}

export const albumTitle = (root: MockAlbum, locale = DEFAULT_LOCALE_CODE) => titleOf(root.live, locale).title ?? `#${root.id}`;

export function albumListItem(db: MockDb, root: MockAlbum, locale = DEFAULT_LOCALE_CODE): AlbumListItem {
  const snap = working(db, root);
  const t = titleOf(snap, locale);
  const draft = engine.hasDraft(db, root) ? engine.draftRow(db, root) : undefined;
  const trashed = albumIsTrashed(root);
  const usage = findReferences(db, "album_id", root.id).filter((r) => r.kind === "section_props").length;
  return {
    id: root.id,
    public_id: root.public_id,
    key: root.key,
    title: t.title,
    title_locale: t.locale,
    cover_media: mediaRef(db, snap.album.cover_media_id),
    item_count: snap.items.length,
    usage_count: usage,
    translation_status: Object.fromEntries(
      MOCK_ACTIVE_LOCALE_CODES.map((code) => {
        const row = snap.translations.find((x) => x.locale_code === code);
        return [code, { enabled: Boolean(row), title: !blank(row?.title), description: !blank(row?.description) }];
      })
    ),
    draft: draft ? { revision_id: draft.id, version: draft.version, created_at: draft.created_at, created_by: draft.created_by } : null,
    status: root.status,
    lock_version: root.lock_version,
    has_unpublished_changes: engine.hasDraft(db, root),
    published_at: root.published_at,
    first_published_at: root.first_published_at,
    scheduled_at: scheduledAtOf(db, "albums", root.id),
    unpublished_at: root.unpublished_at,
    created_by: root.created_by,
    updated_by: root.updated_by,
    created_at: root.created_at,
    updated_at: root.updated_at,
    deleted_at: root.deleted_at,
    purge_at: trashed ? micros(Date.parse(root.deleted_at!) + TRASH_DAYS * 86_400_000, 0) : null,
  };
}

export function albumDetail(db: MockDb, root: MockAlbum, locale = DEFAULT_LOCALE_CODE): AlbumDetail {
  const snap = working(db, root);
  return {
    ...albumListItem(db, root, locale),
    cover_media_id: snap.album.cover_media_id,
    translations: Object.fromEntries(snap.translations.map((t) => [t.locale_code, { title: t.title, description: t.description }])),
    missing_locales: MOCK_ACTIVE_LOCALE_CODES.filter((c) => blank(snap.translations.find((t) => t.locale_code === c)?.title)),
    schedule: scheduleMember(db, "albums", root.id),
  };
}

export function albumItemView(db: MockDb, it: MockAlbumItem): AlbumItem {
  const refs = findReferences(db, "album_item_id", it.id);
  return {
    id: it.id,
    public_id: it.public_id,
    media_id: it.media_id,
    media: mediaRef(db, it.media_id)!,
    sort_order: it.sort_order,
    layout_hint: it.layout_hint,
    translations: Object.fromEntries(it.translations.map((t) => [t.locale_code, { caption_title: t.caption_title, caption_description: t.caption_description, alt: t.alt }])),
    in_use: refs.length > 0,
    usage_count: refs.filter((r) => r.kind === "section_props").length,
  };
}

const sortedItems = (snap: MockAlbumSnapshot) => snap.items.slice().sort((x, y) => x.sort_order - y.sort_order);
const orderOf = (snap: MockAlbumSnapshot) => sortedItems(snap).map((i) => ({ id: i.id, sort_order: i.sort_order }));
const renumber = (snap: MockAlbumSnapshot) => {
  snap.items = sortedItems(snap);
  snap.items.forEach((i, n) => (i.sort_order = n));
};

// ---------------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------------
export function listAlbums(db: MockDb, params: Params) {
  rejectUnknown(params, ["page", "limit", "keyword", "locale", "status", "has_unpublished_changes", "trashed", "sort"]);
  const errors: ApiFieldError[] = [];
  const trashed = boolParam(params, "trashed") ?? false;
  const pending = boolParam(params, "has_unpublished_changes");
  const keyword = params.get("keyword")?.trim().toLowerCase();
  if (keyword && charCount(keyword) > 100) errors.push({ in: "query", path: "/keyword", code: "too_long", params: { max: 100 } });
  const locale = params.get("locale") ?? DEFAULT_LOCALE_CODE;
  if (!(MOCK_LOCALE_CODES as readonly string[]).includes(locale)) errors.push({ in: "query", path: "/locale", code: "unknown_reference" });
  const statuses = params.get("status")?.split(",").filter(Boolean);
  if (statuses && (statuses.length > 5 || statuses.some((s) => !STATUSES.includes(s)))) errors.push({ in: "query", path: "/status", code: "not_in_enum", params: { expected: STATUSES } });
  const sort = params.get("sort") ?? "key";
  const m = /^(-?)([a-z_]+)$/.exec(sort);
  if (!m || !SORTS.includes(m[2])) errors.push({ in: "query", path: "/sort", code: "not_in_enum", params: { expected: SORTS } });
  if (errors.length) throw validationFailed(errors);
  if (trashed && engine.translator(db)) throw engine.deny("delete", "GET", "/albums?trashed=true");

  let rows = db.albums.filter((r) => albumIsTrashed(r) === trashed);
  if (keyword) rows = rows.filter((r) => r.key.includes(keyword) || working(db, r).translations.some((t) => t.title.toLowerCase().includes(keyword)));
  if (statuses?.length) rows = rows.filter((r) => statuses.includes(r.status));
  if (pending !== undefined) rows = rows.filter((r) => engine.hasDraft(db, r) === pending);
  const items = rows.map((r) => albumListItem(db, r, locale));
  const dir = m![1] ? -1 : 1;
  const field = m![2];
  items.sort((x, y) => {
    const xv = field === "title" ? (x.title ?? "").toLowerCase() : String((x as unknown as Record<string, unknown>)[field] ?? "");
    const yv = field === "title" ? (y.title ?? "").toLowerCase() : String((y as unknown as Record<string, unknown>)[field] ?? "");
    return xv.localeCompare(yv) * dir || x.id - y.id;
  });
  return paginate(items, params);
}

export function getAlbum(db: MockDb, id: string, params?: Params) {
  if (params) rejectUnknown(params, ["locale"]);
  const root = engine.find(db, id);
  return { data: albumDetail(db, root, params?.get("locale") ?? DEFAULT_LOCALE_CODE), etag: engine.etagOfRoot(root) };
}

export function listAlbumItems(db: MockDb, id: string) {
  const root = engine.find(db, id);
  return { data: sortedItems(working(db, root)).map((i) => albumItemView(db, i)), etag: engine.etagOfRoot(root) };
}

// ---------------------------------------------------------------------------------------------------------------
// Body checks
// ---------------------------------------------------------------------------------------------------------------
function textLimit(value: unknown, max: number, path: string, errors: ApiFieldError[], opts: { nullable?: boolean; required?: boolean } = {}): string | null | undefined {
  if (value === null) {
    if (opts.required || !opts.nullable) errors.push({ in: "body", path, code: opts.required ? "required" : "invalid_type" });
    return opts.nullable ? null : undefined;
  }
  if (typeof value !== "string") {
    errors.push({ in: "body", path, code: "invalid_type" });
    return undefined;
  }
  if (opts.required && value.trim() === "") errors.push({ in: "body", path, code: "required" });
  else if (charCount(value) > max) errors.push({ in: "body", path, code: "too_long", params: { max } });
  return value;
}

const knownLocale = (code: string) => (MOCK_LOCALE_CODES as readonly string[]).includes(code);
const mediaOk = (db: MockDb, id: number) => db.assets.some((x) => x.id === id && !x.deleted_at);
const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;

function checkAlbumTranslation(code: string, t: unknown, errors: ApiFieldError[], mode: "create" | "patch", exists: boolean) {
  const base = `/translations/${code}`;
  if (!knownLocale(code)) {
    errors.push({ in: "body", path: base, code: "unknown_reference", params: { ref_type: "locales", ref_id: code } });
    return;
  }
  if (t === null && mode === "patch") return;
  if (!isObject(t)) {
    errors.push({ in: "body", path: base, code: "invalid_type" });
    return;
  }
  for (const k of Object.keys(t)) if (k !== "title" && k !== "description") errors.push({ in: "body", path: `${base}/${k}`, code: "unknown_field" });
  if ("title" in t) textLimit(t.title, MAX_ALBUM_TITLE, `${base}/title`, errors, { required: true });
  else if (mode === "create" || !exists) errors.push({ in: "body", path: `${base}/title`, code: "required" });
  if ("description" in t && t.description !== null) textLimit(t.description, MAX_ALBUM_DESCRIPTION, `${base}/description`, errors, { nullable: true });
}

// ---------------------------------------------------------------------------------------------------------------
// Create / PATCH
// ---------------------------------------------------------------------------------------------------------------
export function createAlbum(db: MockDb, body: unknown) {
  if (engine.translator(db)) throw engine.deny("create", "POST", "/albums");
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(body)) if (!["key", "translations", "cover_media_id"].includes(k)) errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  if (typeof body.key !== "string") errors.push({ in: "body", path: "/key", code: body.key === undefined ? "required" : "invalid_type" });
  else if (!ALBUM_KEY_PATTERN.test(body.key)) errors.push({ in: "body", path: "/key", code: "pattern_mismatch" });
  if (!isObject(body.translations)) errors.push({ in: "body", path: "/translations", code: body.translations === undefined ? "required" : "invalid_type" });
  else {
    for (const [code, t] of Object.entries(body.translations)) checkAlbumTranslation(code, t, errors, "create", false);
    if (!isObject(body.translations[DEFAULT_LOCALE_CODE])) errors.push({ in: "body", path: `/translations/${DEFAULT_LOCALE_CODE}/title`, code: "required" });
  }
  if (body.cover_media_id !== undefined && body.cover_media_id !== null) {
    if (!isId(body.cover_media_id)) errors.push({ in: "body", path: "/cover_media_id", code: "invalid_type" });
    else if (!mediaOk(db, body.cover_media_id)) errors.push({ in: "body", path: "/cover_media_id", code: "unknown_reference", params: { ref_type: "media_assets", ref_id: body.cover_media_id } });
  }
  if (errors.length) throw validationFailed(errors);
  if (db.albums.some((r) => !r.deleted_at && r.key === body.key)) throw duplicate([{ in: "body", path: "/key", code: "duplicate" }]);

  const id = db.nextAlbumId++;
  const stamp = tick(db);
  const translations = body.translations as Record<string, Record<string, unknown>>;
  const root: MockAlbum = {
    id,
    public_id: albumPublicId(id),
    key: body.key as string,
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
      album: { cover_media_id: (body.cover_media_id as number | null | undefined) ?? null },
      translations: Object.entries(translations)
        .sort(([x], [y]) => MOCK_LOCALE_CODES.indexOf(x as never) - MOCK_LOCALE_CODES.indexOf(y as never))
        .map(([locale_code, t]) => ({ locale_code, title: (t.title as string).trim(), description: blank(t.description as string | null | undefined) ? null : (t.description as string) })),
      items: [],
    },
  };
  db.albums.push(root);
  return { data: engine.writeResult(db, root), etag: engine.etagOfRoot(root) };
}

export function patchAlbum(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
  const root = engine.find(db, id);
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(body)) {
    if (k === "key") errors.push({ in: "body", path: "/key", code: "immutable" });
    else if (!["translations", "cover_media_id"].includes(k)) errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  }
  if (Object.keys(body).length === 0) errors.push({ in: "body", path: "", code: "min_properties" });
  const current = working(db, root);
  if (body.translations !== undefined) {
    if (!isObject(body.translations)) errors.push({ in: "body", path: "/translations", code: "invalid_type" });
    else for (const [code, t] of Object.entries(body.translations)) checkAlbumTranslation(code, t, errors, "patch", current.translations.some((x) => x.locale_code === code));
  }
  if (body.cover_media_id !== undefined && body.cover_media_id !== null) {
    if (!isId(body.cover_media_id)) errors.push({ in: "body", path: "/cover_media_id", code: "invalid_type" });
    else if (!mediaOk(db, body.cover_media_id)) errors.push({ in: "body", path: "/cover_media_id", code: "unknown_reference", params: { ref_type: "media_assets", ref_id: body.cover_media_id } });
  }
  if (errors.length) throw validationFailed(errors);

  // 05 13.4.2: a translate-only writer edits the texts of existing language rows (every language); the cover and adding / removing a row need `update`.
  if (engine.translator(db)) {
    if (body.cover_media_id !== undefined && body.cover_media_id !== current.album.cover_media_id) throw engine.deny("update", "PATCH", "/albums/{id} (cover_media_id)");
    for (const [code, t] of Object.entries((body.translations ?? {}) as Record<string, unknown>)) {
      if (t === null || !current.translations.some((x) => x.locale_code === code)) throw engine.deny("update", "PATCH", `/albums/{id} (translations/${code})`);
    }
  }
  engine.requireMatch(ifMatch, root);
  engine.trashedCheck(root);

  // Nothing would change: the same ETag, nothing written.
  const next = structuredClone(current);
  if (body.cover_media_id !== undefined) next.album.cover_media_id = body.cover_media_id as number | null;
  for (const [code, t] of Object.entries((body.translations ?? {}) as Record<string, Record<string, unknown> | null>)) {
    const at = next.translations.findIndex((x) => x.locale_code === code);
    if (t === null) {
      if (at >= 0) next.translations.splice(at, 1);
      continue;
    }
    const row = at >= 0 ? next.translations[at] : { locale_code: code, title: "", description: null };
    if ("title" in t) row.title = (t.title as string).trim();
    if ("description" in t) row.description = blank(t.description as string | null) ? null : (t.description as string);
    if (at < 0) next.translations.push(row);
  }
  next.translations.sort((x, y) => MOCK_LOCALE_CODES.indexOf(x.locale_code as never) - MOCK_LOCALE_CODES.indexOf(y.locale_code as never));
  if (JSON.stringify(next) === JSON.stringify(current)) return { data: engine.writeResult(db, root), etag: engine.etagOfRoot(root) };

  const { snapshot, stamp } = engine.beginWrite(db, root);
  Object.assign(snapshot, { album: next.album, translations: next.translations });
  engine.commitWrite(root, stamp);
  return { data: engine.writeResult(db, root), etag: engine.etagOfRoot(root) };
}

// ---------------------------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------------------------
function checkItemTranslations(value: unknown, base: string, errors: ApiFieldError[], mode: "create" | "patch") {
  if (!isObject(value)) {
    errors.push({ in: "body", path: base, code: "invalid_type" });
    return;
  }
  for (const [code, t] of Object.entries(value)) {
    const path = `${base}/${code}`;
    if (!knownLocale(code)) {
      errors.push({ in: "body", path, code: "unknown_reference", params: { ref_type: "locales", ref_id: code } });
      continue;
    }
    if (t === null && mode === "patch") continue;
    if (!isObject(t)) {
      errors.push({ in: "body", path, code: "invalid_type" });
      continue;
    }
    for (const [k, v] of Object.entries(t)) {
      const limit = k === "caption_title" ? MAX_CAPTION_TITLE : k === "caption_description" ? MAX_CAPTION_DESCRIPTION : k === "alt" ? MAX_ITEM_ALT : 0;
      if (!limit) errors.push({ in: "body", path: `${path}/${k}`, code: "unknown_field" });
      else if (v !== null) textLimit(v, limit, `${path}/${k}`, errors);
    }
  }
}

const cleanText = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

function mergeItemTranslation(old: MockAlbumItem["translations"][number] | undefined, code: string, t: Record<string, unknown>): MockAlbumItem["translations"][number] {
  const row = old ? { ...old } : { locale_code: code, caption_title: null, caption_description: null, alt: null };
  for (const k of ["caption_title", "caption_description", "alt"] as const) if (k in t) row[k] = cleanText(t[k]);
  return row;
}

export function createAlbumItems(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
  const root = engine.find(db, id);
  if (engine.translator(db)) throw engine.deny("create", "POST", "/albums/{id}/items");
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(body)) if (k !== "items" && k !== "position") errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  const current = working(db, root);
  const inputs = Array.isArray(body.items) ? (body.items as unknown[]) : null;
  if (!inputs) errors.push({ in: "body", path: "/items", code: body.items === undefined ? "required" : "invalid_type" });
  else if (inputs.length < 1) errors.push({ in: "body", path: "/items", code: "required" });
  else if (inputs.length > MAX_ITEMS_PER_REQUEST) errors.push({ in: "body", path: "/items", code: "limit_exceeded", params: { max: MAX_ITEMS_PER_REQUEST } });
  else if (current.items.length + inputs.length > MAX_ALBUM_ITEMS) {
    errors.push({ in: "body", path: "/items", code: "limit_exceeded", params: { max: MAX_ALBUM_ITEMS, remaining: Math.max(0, MAX_ALBUM_ITEMS - current.items.length) } });
  } else {
    inputs.forEach((raw, i) => {
      const base = `/items/${i}`;
      if (!isObject(raw)) {
        errors.push({ in: "body", path: base, code: "invalid_type" });
        return;
      }
      for (const k of Object.keys(raw)) if (!["media_id", "layout_hint", "translations"].includes(k)) errors.push({ in: "body", path: `${base}/${k}`, code: "unknown_field" });
      if (raw.media_id === undefined) errors.push({ in: "body", path: `${base}/media_id`, code: "required" });
      else if (!isId(raw.media_id)) errors.push({ in: "body", path: `${base}/media_id`, code: "invalid_type" });
      else if (!mediaOk(db, raw.media_id)) errors.push({ in: "body", path: `${base}/media_id`, code: "unknown_reference", params: { ref_type: "media_assets", ref_id: raw.media_id } });
      if (raw.layout_hint !== undefined && raw.layout_hint !== null && !(typeof raw.layout_hint === "string" && LAYOUT_HINT_PATTERN.test(raw.layout_hint))) errors.push({ in: "body", path: `${base}/layout_hint`, code: "pattern_mismatch" });
      if (raw.translations !== undefined) checkItemTranslations(raw.translations, `${base}/translations`, errors, "create");
    });
  }
  let position = current.items.length;
  if (body.position !== undefined) {
    if (typeof body.position !== "number" || !Number.isInteger(body.position) || body.position < 0) errors.push({ in: "body", path: "/position", code: "invalid_type" });
    else if (body.position > current.items.length) errors.push({ in: "body", path: "/position", code: "out_of_range", params: { max: current.items.length } });
    else position = body.position;
  }
  if (errors.length) throw validationFailed(errors);
  engine.requireMatch(ifMatch, root);
  engine.trashedCheck(root);

  const { snapshot, stamp } = engine.beginWrite(db, root);
  const snap = snapshot as MockAlbumSnapshot;
  const created: MockAlbumItem[] = (inputs as Array<Record<string, unknown>>).map((raw) => {
    const newId = db.nextAlbumItemId++;
    const translations = Object.entries((raw.translations ?? {}) as Record<string, Record<string, unknown>>).map(([code, t]) => mergeItemTranslation(undefined, code, t));
    return { id: newId, public_id: itemPublicId(newId), media_id: raw.media_id as number, sort_order: 0, layout_hint: (raw.layout_hint as string | null | undefined) ?? null, translations };
  });
  const ordered = sortedItems(snap);
  ordered.splice(position, 0, ...created);
  snap.items = ordered;
  renumber(snap);
  engine.commitWrite(root, stamp);
  return {
    data: { items: created.map((c) => albumItemView(db, c)), order: orderOf(snap), aggregate: engine.stampOf(db, root), warnings: [] },
    etag: engine.etagOfRoot(root),
  };
}

function findItem(snap: MockAlbumSnapshot, itemId: string): MockAlbumItem {
  const it = snap.items.find((i) => String(i.id) === itemId);
  if (!it) throw notFound();
  return it;
}

export function patchAlbumItem(db: MockDb, id: string, itemId: string, body: unknown, ifMatch: string | null) {
  const root = engine.find(db, id);
  const current = working(db, root);
  const old = findItem(current, itemId);
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(body)) if (!["media_id", "layout_hint", "translations"].includes(k)) errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  if (Object.keys(body).length === 0) errors.push({ in: "body", path: "", code: "min_properties" });
  if (body.media_id !== undefined) {
    if (!isId(body.media_id)) errors.push({ in: "body", path: "/media_id", code: "invalid_type" });
    else if (!mediaOk(db, body.media_id)) errors.push({ in: "body", path: "/media_id", code: "unknown_reference", params: { ref_type: "media_assets", ref_id: body.media_id } });
  }
  if (body.layout_hint !== undefined && body.layout_hint !== null && !(typeof body.layout_hint === "string" && LAYOUT_HINT_PATTERN.test(body.layout_hint))) errors.push({ in: "body", path: "/layout_hint", code: "pattern_mismatch" });
  if (body.translations !== undefined) checkItemTranslations(body.translations, "/translations", errors, "patch");
  if (errors.length) throw validationFailed(errors);
  // 05 13.4.2: the picture and the layout hint are `update`; the three texts of every language are `update` or `translate`.
  if (engine.translator(db)) {
    if ((body.media_id !== undefined && body.media_id !== old.media_id) || (body.layout_hint !== undefined && body.layout_hint !== old.layout_hint)) throw engine.deny("update", "PATCH", "/albums/{id}/items/{itemId}");
  }
  engine.requireMatch(ifMatch, root);
  engine.trashedCheck(root);

  const next: MockAlbumItem = structuredClone(old);
  if (body.media_id !== undefined) next.media_id = body.media_id as number;
  if (body.layout_hint !== undefined) next.layout_hint = (body.layout_hint as string | null) ?? null;
  for (const [code, t] of Object.entries((body.translations ?? {}) as Record<string, Record<string, unknown> | null>)) {
    const at = next.translations.findIndex((x) => x.locale_code === code);
    if (t === null) {
      if (at >= 0) next.translations.splice(at, 1);
      continue;
    }
    const row = mergeItemTranslation(at >= 0 ? next.translations[at] : undefined, code, t);
    if (at >= 0) next.translations[at] = row;
    else next.translations.push(row);
  }
  next.translations.sort((x, y) => MOCK_LOCALE_CODES.indexOf(x.locale_code as never) - MOCK_LOCALE_CODES.indexOf(y.locale_code as never));
  if (JSON.stringify(next) === JSON.stringify(old)) return { data: { item: albumItemView(db, old), aggregate: engine.stampOf(db, root), warnings: [] }, etag: engine.etagOfRoot(root) };

  const { snapshot, stamp } = engine.beginWrite(db, root);
  const snap = snapshot as MockAlbumSnapshot;
  snap.items[snap.items.findIndex((i) => i.id === old.id)] = next;
  engine.commitWrite(root, stamp);
  return { data: { item: albumItemView(db, next), aggregate: engine.stampOf(db, root), warnings: [] }, etag: engine.etagOfRoot(root) };
}

export function deleteAlbumItem(db: MockDb, id: string, itemId: string, ifMatch: string | null) {
  const root = engine.find(db, id);
  const old = findItem(working(db, root), itemId);
  if (engine.translator(db)) throw engine.deny("delete", "DELETE", "/albums/{id}/items/{itemId}");
  engine.requireMatch(ifMatch, root);
  engine.trashedCheck(root);
  // A `photo_story` slot uses the picture (live or draft): refused, nothing confirms it (PT-8).
  const refs = findReferences(db, "album_item_id", old.id);
  if (refs.length > 0) throw entityReferenced(refs);
  const { snapshot, stamp } = engine.beginWrite(db, root);
  const snap = snapshot as MockAlbumSnapshot;
  snap.items = snap.items.filter((i) => i.id !== old.id);
  renumber(snap);
  engine.commitWrite(root, stamp);
  return { data: { order: orderOf(snap), aggregate: engine.stampOf(db, root), warnings: [] }, etag: engine.etagOfRoot(root) };
}

export function reorderAlbumItems(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
  const root = engine.find(db, id);
  if (engine.translator(db)) throw engine.deny("update", "PUT", "/albums/{id}/items/order");
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(body)) if (k !== "items") errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  const current = working(db, root);
  const given = Array.isArray(body.items) ? (body.items as unknown[]) : null;
  const ids: number[] = [];
  if (!given) errors.push({ in: "body", path: "/items", code: body.items === undefined ? "required" : "invalid_type" });
  else {
    const seen = new Set<number>();
    given.forEach((entry, i) => {
      if (!isObject(entry) || !isId(entry.id)) {
        errors.push({ in: "body", path: `/items/${i}/id`, code: "invalid_type" });
        return;
      }
      if (seen.has(entry.id)) errors.push({ in: "body", path: `/items/${i}/id`, code: "duplicate" });
      else if (!current.items.some((it) => it.id === entry.id)) errors.push({ in: "body", path: `/items/${i}/id`, code: "unknown_reference" });
      seen.add(entry.id);
      ids.push(entry.id);
    });
    const missing = current.items.filter((it) => !seen.has(it.id)).map((it) => it.id);
    if (errors.length === 0 && missing.length > 0) errors.push({ in: "body", path: "/items", code: "required", params: { missing: missing.map(String) } });
  }
  if (errors.length) throw validationFailed(errors);
  engine.requireMatch(ifMatch, root);
  engine.trashedCheck(root);
  const same = ids.every((v, i) => sortedItems(current)[i].id === v);
  if (same) return { data: { order: orderOf(current), aggregate: engine.stampOf(db, root) }, etag: engine.etagOfRoot(root) };
  const { snapshot, stamp } = engine.beginWrite(db, root);
  const snap = snapshot as MockAlbumSnapshot;
  snap.items.forEach((it) => (it.sort_order = ids.indexOf(it.id)));
  renumber(snap);
  engine.commitWrite(root, stamp);
  return { data: { order: orderOf(snap), aggregate: engine.stampOf(db, root) }, etag: engine.etagOfRoot(root) };
}

// ---------------------------------------------------------------------------------------------------------------
// Publish rules (05 13.4.7)
// ---------------------------------------------------------------------------------------------------------------
export function validateAlbumForPublish(db: MockDb, root: MockAlbum): { blockers: PublishIssue[]; warnings: PublishIssue[] } {
  const snap = working(db, root);
  const blockers: PublishIssue[] = [];
  const warnings: PublishIssue[] = [];
  const def = DEFAULT_LOCALE_CODE;
  const assetOf = (id: number) => db.assets.find((x) => x.id === id && !x.deleted_at);
  if (blank(snap.translations.find((t) => t.locale_code === def)?.title)) blockers.push(issue(`/translations/${def}/title`, "empty_default_locale", { locale: def }));
  const checkMedia = (mediaId: number, path: string, extra: PublishIssue["params"], itemAlt: string | null) => {
    const asset = assetOf(mediaId);
    if (!asset) blockers.push(issue(path, "unknown_reference", { ...extra, ref_type: "media_assets", ref_id: mediaId }));
    else if (asset.status !== "ready") blockers.push(issue(path, "media_not_ready", { ...extra, media_id: mediaId }));
    else if (blank(itemAlt) && blank(asset.translations[def]?.alt) && !asset.is_decorative) blockers.push(issue(path, "media_alt_missing", { ...extra, media_id: mediaId, locale: def }));
  };
  if (snap.album.cover_media_id !== null) checkMedia(snap.album.cover_media_id, "/cover_media_id", {}, null);
  sortedItems(snap).forEach((it, index) => {
    checkMedia(it.media_id, `/items/${it.public_id}/media_id`, { item_id: it.id, item_index: index }, it.translations.find((t) => t.locale_code === def)?.alt ?? null);
  });
  if (snap.items.length === 0) warnings.push(issue("/items", "album_empty", {}, false));
  for (const code of MOCK_ACTIVE_LOCALE_CODES) {
    if (code === def) continue;
    if (blank(snap.translations.find((t) => t.locale_code === code)?.title)) warnings.push(issue(`/translations/${code}`, "translation_incomplete", { locale: code, missing: 1 }, false));
  }
  return { blockers, warnings };
}

// ---------------------------------------------------------------------------------------------------------------
// Commands that are the engine's
// ---------------------------------------------------------------------------------------------------------------
export const deleteAlbum = engine.remove;
export const restoreAlbum = engine.restoreFromTrash;
export const publishAlbum = engine.publish;
export const unpublishAlbum = engine.unpublish;
export const discardAlbumDraft = engine.discardDraft;
// D1: schedule / unschedule (no review workflow for albums) and the helpers of the tests.
export const scheduleAlbum = engine.d1.schedule;
export const unscheduleAlbum = engine.d1.unschedule;
export const fireAlbumSchedule = engine.d1.fire;
export const failAlbumSchedule = engine.d1.fail3;
export const makeAlbumScheduleOverdue = engine.d1.makeOverdue;
export const listAlbumRevisions = engine.listRevisions;
export const getAlbumRevision = engine.getRevision;
export const restoreAlbumRevision = engine.restoreRevision;
export const touchAlbumAsSomeoneElse = engine.touchAsSomeoneElse;

export const albumsSummary = (db: MockDb) =>
  db.albums.map((a) => ({ id: a.id, key: a.key, status: a.status, lock_version: a.lock_version, deleted_at: a.deleted_at, items: working(db, a).items.length }));

// The picker of a `photo_story` section lists published and draft albums that are not in the trash (`GET /albums?keyword=`).
export const albumReferences = (db: MockDb, albumId: number): Reference[] => findReferences(db, "album_id", albumId);

// A click-through / test helper: make the first `photo_story` of a page name a picture of an album (`album_item_id`), so the picture
// is "used in a photo story" and its delete is refused.
export function referenceAlbumItemFromPage(db: MockDb, pageId: number, itemId: number): void {
  const page = db.pages.find((p) => p.id === pageId);
  if (!page) throw notFound();
  const section = page.live.sections.find((s) => s.section_type === "photo_story");
  if (!section) throw notFound();
  const props = section.props as { rows?: Array<{ slots?: Array<Record<string, unknown>> }> };
  props.rows = [...(props.rows ?? []), { slots: [{ album_item_id: itemId }] }];
}

