// In-memory model of the CMS endpoints of the media library, revisions and cache purge (doc/05 sections 11.6 -
// 11.8; shapes: doc/api/openapi-admin.yaml). The backends are written in parallel with the UI, so MSW (tests),
// the dev playground and the browser mock (`NEXT_PUBLIC_API_MOCKING=true`) all talk to THIS model through
// `handlers.ts`. It is deliberately strict - the rules the real API enforces are enforced here, so a UI that
// passes against it does not rely on leniency: unknown query parameters / fields are 422 `unknown_field`, a write
// without `If-Match` is 428, a stale one is 409 `CONFLICT_LOCK_VERSION`, a used asset can not be deleted
// (`MEDIA_IN_USE`), a restore checks the snapshot. Not a copy of the backend: just the contract.
import { PURGE_TAG_PATTERN } from "@/lib/cache-tags";
import {
  CLOCK_START,
  DEFAULT_LOCALE_CODE,
  MOCK_LOCALE_CODES,
  MOCK_USER,
  MockHttpError,
  etagOf,
  invalidState,
  fail,
  keyOf,
  lockConflict,
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
  type StoredRevision,
} from "@/mocks/mock-core";
import { MENU_NEXT_ITEM_ID, restoreMenu, seedMenuRevisions, seedMenus } from "@/mocks/mock-menus";
import { seedAlbumRevisions, seedAlbums } from "@/mocks/mock-albums";
import { seedFaqGroups, seedFaqRevisions } from "@/mocks/mock-faq";
import { seedPageRevisions, seedPages } from "@/mocks/mock-pages";
import { seedPreviewLinks } from "@/mocks/mock-preview";
import { SEED_SETTINGS_UPDATED, restoreSettings, seedSettings, seedSettingsRevisions } from "@/mocks/mock-settings";
import { seedPostRevisions, seedPosts } from "@/mocks/mock-posts";
import { restoreTaxonomy, seedTaxonomy, seedTaxonomyRevisions } from "@/mocks/mock-taxonomy";
import { restoreUiString, seedUiStringRevisions, seedUiStrings, uiStringKnown } from "@/mocks/mock-ui-strings";
import { SEED_MEDIA } from "@/mocks/media-seed";
import type { ApiFieldError } from "@/types/api";
import type {
  MediaAsset,
  MediaAssetDetail,
  MediaAssetTranslation,
  MediaFolder,
  MediaUsage,
  UserRef,
} from "@/types/media";
import type { RevisionSummary } from "@/types/revisions";
import type { CachePurgeResult } from "@/types/system";

// The plumbing lives in `mock-core.ts`; these names stay importable from here.
export {
  DEFAULT_LOCALE_CODE,
  MOCK_LOCALE_CODES,
  MOCK_USER,
  MockHttpError,
  etagOf,
  notFound,
  validationFailed,
  type MockDb,
};

// A flat tile with the file's name as a data: URI (the admin CSP allows `img-src data:`): no network, no portal.
export function tileUrl(id: number, label: string, width = 320, height = 240): string {
  const hue = (id * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="hsl(${hue} 30% 78%)"/><circle cx="${Math.round(width * 0.68)}" cy="${Math.round(height * 0.32)}" r="${Math.round(height * 0.12)}" fill="hsl(${hue} 40% 92%)"/><path d="M0 ${height} L${Math.round(width * 0.35)} ${Math.round(height * 0.55)} L${Math.round(width * 0.6)} ${Math.round(height * 0.8)} L${Math.round(width * 0.8)} ${Math.round(height * 0.6)} L${width} ${height} Z" fill="hsl(${hue} 30% 55%)"/><text x="12" y="24" font-family="sans-serif" font-size="14" fill="#222">#${id} ${label.slice(0, 22)}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const FOLDER_DEFS: Array<{ id: number; name: string; parent: number | null; match: (key: string) => boolean }> = [
  { id: 1, name: "Home", parent: null, match: (k) => k.startsWith("static/images/site/home/") },
  { id: 2, name: "Our Path", parent: null, match: (k) => k.startsWith("static/images/site/our-path/") },
  { id: 3, name: "Blog", parent: null, match: (k) => k.startsWith("static/images/site/blog/") },
  { id: 4, name: "Gallery", parent: null, match: (k) => k.startsWith("static/images/site/gallery/") },
  { id: 5, name: "Brand", parent: null, match: () => false },
  { id: 6, name: "Logos", parent: 5, match: (k) => k.endsWith(".svg") },
];

// Pages / album / settings the seeded assets are used by (shape of `GET /media/assets/{id}/usages`).
function seedUsages(): Record<number, MediaUsage[]> {
  const sec = (n: number) => `0192d3a4-7c1e-7b52-9d0a-3f5e2a1b4c${String(n).padStart(2, "0")}`;
  const page = (id: number, title: string, n: number, field = "background/media_id"): MediaUsage => ({
    entity_type: "cms.page",
    id,
    title,
    field: `/sections/${sec(n)}/props/${field}`,
    status: "published",
    in_draft_only: false,
  });
  return {
    1: [page(1, "Home", 1)],
    2: [page(1, "Home", 2, "images/0/media_id")],
    3: [page(1, "Home", 2, "images/1/media_id")],
    4: [page(1, "Home", 2, "images/2/media_id")],
    10: [page(2, "Our Path", 4)],
    15: [
      page(3, "Blog", 5),
      { entity_type: "cms.post", id: 1, title: "Music night under the stars", field: "/hero_media_id", status: "published", in_draft_only: false },
      { entity_type: "cms.page", id: 6, title: "Spring campaign (draft)", field: `/sections/${sec(9)}/props/background/media_id`, status: "draft", in_draft_only: true },
    ],
    18: [{ entity_type: "cms.album", id: 1, title: "Forest photo story", field: "/items/0/media_id", status: "published", in_draft_only: false }],
    19: [{ entity_type: "cms.album", id: 1, title: "Forest photo story", field: "/items/1/media_id", status: "published", in_draft_only: false }],
    23: [{ entity_type: "cms.site_settings", id: 1, title: "brand", field: "/settings/brand.logo_light", status: null, in_draft_only: false }],
  };
}

function seedAsset(row: (typeof SEED_MEDIA)[number], index: number): MediaAssetDetail {
  const filename = row.storage_key.split("/").pop() ?? String(row.media_id);
  const folderDef = FOLDER_DEFS.slice().reverse().find((f) => f.match(row.storage_key));
  // One seed run wrote all 24 rows: the same `created_at`; `updated_at` differs in the microseconds only.
  const createdAt = micros(Date.UTC(2026, 9, 26, 9, 0, 0), 120);
  const stamp = micros(Date.UTC(2026, 9, 26, 9, 0, 0), 120 + index);
  const usages = seedUsages()[row.media_id] ?? [];
  return {
    id: row.media_id,
    public_id: `0192d3a4-7c1e-7b52-9d0a-${String(row.media_id).padStart(12, "0")}`,
    folder_id: folderDef?.id ?? null,
    kind: row.kind,
    status: "ready",
    error_message: null,
    source: "static",
    original_filename: filename,
    mime_type: row.mime_type,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    duration_ms: null,
    focal: null,
    is_decorative: false,
    dominant_color: null,
    blurhash: null,
    checksum_sha256: row.checksum_sha256,
    url: tileUrl(row.media_id, filename, 320, Math.max(120, Math.round((320 * row.height) / row.width))),
    translations: row.alt
      ? { la: { alt: row.alt.la, caption: null, credit: null }, en: { alt: row.alt.en, caption: null, credit: null } }
      : {},
    usage_count: usages.length,
    created_by: null,
    updated_by: null,
    created_at: createdAt,
    updated_at: stamp,
    deleted_at: null,
    purge_at: null,
    folder: null,
    variants: [],
  };
}

function assetSnapshot(a: MediaAssetDetail): Record<string, unknown> {
  return {
    asset: { folder_id: a.folder_id, is_decorative: a.is_decorative, focal_x: a.focal?.x ?? null, focal_y: a.focal?.y ?? null },
    translations: Object.entries(a.translations).map(([locale_code, t]) => ({
      locale_code,
      alt: t.alt ?? "",
      caption: t.caption ?? null,
      credit: t.credit ?? null,
    })),
  };
}

export function createMockDb(): MockDb {
  const db: MockDb = {
    clock: CLOCK_START,
    assets: SEED_MEDIA.map(seedAsset),
    folders: [],
    usages: seedUsages(),
    revisions: {},
    entities: {},
    purges: { tags: 0, all: 0 },
    nextRevisionId: 9000,
    nextFolderId: 100,
    pages: [],
    nextPageId: 11,
    nextSectionId: 301,
    albums: [],
    // T1.5.6: seeded below (after the pages); the ids continue after the seeds.
    nextAlbumId: 6,
    nextAlbumItemId: 16,
    faqGroups: [],
    nextFaqGroupId: 5,
    nextFaqItemId: 11,
    idempotency: {},
    posts: [],
    nextPostId: 9,
    nextPostMediaId: 1,
    postRole: "editor",
    menus: seedMenus(),
    nextMenuItemId: MENU_NEXT_ITEM_ID,
    translateOnly: [],
    settings: seedSettings(),
    settingsVersion: {},
    settingsUpdatedAt: { ...SEED_SETTINGS_UPDATED },
    uiRows: [],
    nextUiRowId: 1,
    manifests: [],
    bundleSyncs: 0,
    categories: [],
    tags: [],
    nextCategoryId: 1,
    nextTagId: 1,
    previewLinks: [],
    nextPreviewLinkId: 1,
    previewIssued: [],
    previewUnconfigured: false,
  };
  const stamp = micros(Date.UTC(2026, 9, 26, 9, 0, 0), 900);
  db.folders = FOLDER_DEFS.map((f) => ({
    id: f.id,
    public_id: `0192d3a4-7c1e-7b52-9d0a-f${String(f.id).padStart(11, "0")}`,
    parent_id: f.parent,
    name: f.name,
    sort_order: f.id,
    depth: 1,
    path: f.name,
    asset_count: 0,
    child_count: 0,
    etag: `"${stamp}"`,
    created_by: null,
    updated_by: null,
    created_at: stamp,
    updated_at: stamp,
  }));
  recomputeFolders(db);
  db.pages = seedPages(db);
  db.posts = seedPosts(db);
  db.albums = seedAlbums();
  db.faqGroups = seedFaqGroups();
  seedUiStrings(db);
  seedTaxonomy(db);
  seedRevisions(db);
  seedPageRevisions(db);
  seedPostRevisions(db);
  seedAlbumRevisions(db);
  seedFaqRevisions(db);
  seedMenuRevisions(db);
  seedSettingsRevisions(db);
  seedUiStringRevisions(db);
  seedTaxonomyRevisions(db);
  seedPreviewLinks(db);
  return db;
}

function recomputeFolders(db: MockDb) {
  const byId = new Map(db.folders.map((f) => [f.id, f]));
  for (const f of db.folders) {
    const chain: string[] = [];
    let cur: MediaFolder | undefined = f;
    let depth = 0;
    while (cur) {
      chain.unshift(cur.name);
      depth += 1;
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    f.path = chain.join("/");
    f.depth = depth;
    f.asset_count = db.assets.filter((a) => a.folder_id === f.id && !a.deleted_at).length;
    f.child_count = db.folders.filter((c) => c.parent_id === f.id).length;
    f.etag = `"${f.updated_at}"`;
  }
  db.folders.sort((a, b) => a.path.localeCompare(b.path) || a.sort_order - b.sort_order);
  for (const a of db.assets) {
    const f = a.folder_id ? byId.get(a.folder_id) : undefined;
    a.folder = f ? { id: f.id, name: f.name, path: f.path } : null;
  }
}

// A little history for the entities the playground and the tests open.
function seedRevisions(db: MockDb) {
  const who = (id: number, name: string): UserRef => ({ id, name });
  const base = Date.UTC(2026, 9, 20, 8, 0, 0);

  // media asset #2: three writes (before-images). v1 = the seeded state without any alt text.
  const a2 = db.assets.find((a) => a.id === 2)!;
  const snap = (folder: number | null, focal: [number, number] | null, alts: Array<[string, string]>) => ({
    asset: { folder_id: folder, is_decorative: false, focal_x: focal?.[0] ?? null, focal_y: focal?.[1] ?? null },
    translations: alts.map(([locale_code, alt]) => ({ locale_code, alt, caption: null, credit: null })),
  });
  const seeded = snap(a2.folder_id, null, [["la", a2.translations.la?.alt ?? ""], ["en", a2.translations.en?.alt ?? ""]]);
  pushRevision(db, "media/assets", 2, "media.assets", "history", snap(a2.folder_id, null, []), null, micros(base), who(4, "Somchai Vongsa"));
  pushRevision(db, "media/assets", 2, "media.assets", "history", snap(a2.folder_id, null, [["la", seeded.translations[0].alt], ["en", "Two climbers on a glacier"]]), null, micros(base + 3_600_000), who(6, "Noy Keomany"));
  pushRevision(db, "media/assets", 2, "media.assets", "restore", snap(null, [0.4, 0.3], [["la", seeded.translations[0].alt], ["en", seeded.translations[1].alt]]), "restore of v1", micros(base + 7_200_000), who(4, "Somchai Vongsa"));
  // a snapshot saved by a newer schema: restoring it is refused (`snapshot_incompatible`)
  pushRevision(db, "media/assets", 2, "media.assets", "history", { future: true }, null, micros(base + 9_000_000), null, 99);
}

// ---------------------------------------------------------------------------------------------------------------
// Singleton + reset (tests call `resetMockDb()` in `beforeEach`).
// ---------------------------------------------------------------------------------------------------------------
let current: MockDb | null = null;
export const getMockDb = (): MockDb => (current ??= createMockDb());
export const resetMockDb = (): MockDb => (current = createMockDb());

// ---------------------------------------------------------------------------------------------------------------
// Media assets
// ---------------------------------------------------------------------------------------------------------------
const LIST_PARAMS = [
  "page", "limit", "keyword", "ids", "folder_id", "include_subfolders", "kind", "mime", "status", "uploaded_by",
  "from", "to", "unused", "missing_alt", "trashed", "sort",
] as const;

function defaultAlt(a: MediaAsset): string {
  return a.translations[DEFAULT_LOCALE_CODE]?.alt ?? "";
}

function toListRow(a: MediaAssetDetail): MediaAsset {
  // The list carries the common fields only (`folder` / `variants` belong to the detail).
  const { folder: _folder, variants: _variants, ...row } = a;
  void _folder;
  void _variants;
  return row;
}

export function listAssets(db: MockDb, params: Params) {
  rejectUnknown(params, LIST_PARAMS);
  const ids = params.get("ids");
  if (ids !== null) {
    if (!/^[0-9]+(,[0-9]+)*$/.test(ids) || ids.split(",").length > 50) {
      throw validationFailed([{ in: "query", path: "/ids", code: "invalid_format" }]);
    }
    const other = [...params.keys()].filter((k) => !["ids", "page", "limit"].includes(k));
    if (other.length) throw validationFailed(other.map((k) => ({ in: "query" as const, path: `/${k}`, code: "unknown_field" })));
    const wanted = ids.split(",").map(Number);
    return paginate(db.assets.filter((a) => wanted.includes(a.id) && !a.deleted_at).map(toListRow), params);
  }
  const keyword = params.get("keyword")?.trim().toLowerCase();
  const kinds = params.get("kind")?.split(",").filter(Boolean);
  const mimes = params.get("mime")?.split(",").filter(Boolean);
  const statuses = params.get("status")?.split(",").filter(Boolean);
  const folderParam = params.get("folder_id");
  const subfolders = params.get("include_subfolders") === "true";
  const trashed = params.get("trashed") === "true";
  const unused = params.get("unused") === "true";
  const missingAlt = params.get("missing_alt") === "true";
  const folderIds = (() => {
    if (!folderParam) return null;
    if (folderParam === "root") return [null];
    const id = Number(folderParam);
    if (!Number.isInteger(id)) throw validationFailed([{ in: "query", path: "/folder_id", code: "invalid_format" }]);
    const out: Array<number | null> = [id];
    if (subfolders) {
      for (let i = 0; i < out.length; i++) for (const f of db.folders) if (f.parent_id === out[i]) out.push(f.id);
    }
    return out;
  })();

  let rows = db.assets.filter((a) => (trashed ? Boolean(a.deleted_at) : !a.deleted_at));
  if (keyword) {
    rows = rows.filter(
      (a) =>
        a.original_filename.toLowerCase().includes(keyword) ||
        Object.values(a.translations).some((t) =>
          [t.alt, t.caption, t.credit].some((v) => typeof v === "string" && v.toLowerCase().includes(keyword))
        )
    );
  }
  if (kinds?.length) rows = rows.filter((a) => kinds.includes(a.kind));
  if (mimes?.length) {
    rows = rows.filter((a) => mimes.some((m) => (m.endsWith("/*") ? a.mime_type.startsWith(m.slice(0, -1)) : a.mime_type === m)));
  }
  if (statuses?.length) rows = rows.filter((a) => statuses.includes(a.status));
  if (folderIds) rows = rows.filter((a) => folderIds.includes(a.folder_id));
  if (unused) rows = rows.filter((a) => a.usage_count === 0);
  if (missingAlt) rows = rows.filter((a) => !a.is_decorative && !defaultAlt(a).trim());

  const sort = params.get("sort") ?? (trashed ? "-deleted_at" : "-created_at");
  const m = /^(-?)(created_at|original_filename|bytes|updated_at|deleted_at)$/.exec(sort);
  if (!m) throw validationFailed([{ in: "query", path: "/sort", code: "not_in_enum" }]);
  const dir = m[1] ? -1 : 1;
  const field = m[2] as "created_at" | "original_filename" | "bytes" | "updated_at" | "deleted_at";
  rows = [...rows].sort((a, b) => {
    const av = a[field] ?? "";
    const bv = b[field] ?? "";
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return cmp * dir || a.id - b.id;
  });
  return paginate(rows.map(toListRow), params);
}

function findAsset(db: MockDb, id: string): MediaAssetDetail {
  const asset = db.assets.find((a) => String(a.id) === id);
  if (!asset) throw notFound();
  return asset;
}

export function getAsset(db: MockDb, id: string) {
  const asset = findAsset(db, id);
  return { asset, etag: etagOf(asset.updated_at) };
}

const PATCH_FIELDS = ["folder_id", "is_decorative", "focal", "translations"] as const;
const MAX_LEN = { alt: 250, caption: 500, credit: 200 } as const;

export function patchAsset(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
  const asset = findAsset(db, id);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw fail(400, "BAD_REQUEST", "Malformed body.");
  const input = body as Record<string, unknown>;
  const errors: ApiFieldError[] = [];
  for (const key of Object.keys(input)) {
    if (!(PATCH_FIELDS as readonly string[]).includes(key)) errors.push({ in: "body", path: `/${key}`, code: "unknown_field" });
  }
  if (Object.keys(input).length === 0) errors.push({ in: "body", path: "", code: "min_properties" });
  if (errors.length) throw validationFailed(errors);
  requireIfMatch(ifMatch, etagOf(asset.updated_at));
  if (asset.deleted_at) throw invalidState("trashed");

  if ("folder_id" in input && input.folder_id !== null) {
    if (typeof input.folder_id !== "number" || !db.folders.some((f) => f.id === input.folder_id)) {
      errors.push({ in: "body", path: "/folder_id", code: "unknown_reference" });
    }
  }
  if ("focal" in input && input.focal !== null) {
    const f = input.focal as { x?: unknown; y?: unknown };
    for (const axis of ["x", "y"] as const) {
      const v = f?.[axis];
      if (typeof v !== "number" || v < 0 || v > 1 || Math.round(v * 1000) / 1000 !== v) {
        errors.push({ in: "body", path: `/focal/${axis}`, code: "out_of_range" });
      }
    }
  }
  const translations = input.translations as Record<string, MediaAssetTranslation> | undefined;
  if (translations) {
    for (const [locale, t] of Object.entries(translations)) {
      if (!(MOCK_LOCALE_CODES as readonly string[]).includes(locale)) {
        errors.push({ in: "body", path: `/translations/${locale}`, code: "unknown_reference" });
        continue;
      }
      for (const [field, max] of Object.entries(MAX_LEN)) {
        const v = (t as Record<string, unknown>)[field];
        if (typeof v === "string" && [...v].length > max) {
          errors.push({ in: "body", path: `/translations/${locale}/${field}`, code: "too_long", params: { max } });
        }
      }
    }
  }
  if (errors.length) throw validationFailed(errors);

  // apply to a copy; no real change = 200 with the same ETag (no revision, no audit)
  const before = assetSnapshot(asset);
  const next: MediaAssetDetail = structuredClone(asset);
  if ("folder_id" in input) next.folder_id = input.folder_id as number | null;
  if ("is_decorative" in input) next.is_decorative = Boolean(input.is_decorative);
  if ("focal" in input) next.focal = input.focal as MediaAsset["focal"];
  if (translations) {
    for (const [locale, t] of Object.entries(translations)) {
      const cur = next.translations[locale] ?? { alt: "", caption: null, credit: null };
      const merged: MediaAssetTranslation = { ...cur };
      if ("alt" in t) merged.alt = t.alt ?? "";
      if ("caption" in t) merged.caption = t.caption ? t.caption : null;
      if ("credit" in t) merged.credit = t.credit ? t.credit : null;
      next.translations[locale] = merged;
    }
  }
  const warnings = [] as NonNullable<MediaAsset["warnings"]>;
  if (!next.is_decorative && !defaultAlt(next).trim() && next.usage_count > 0) {
    warnings.push({ path: "/translations/la/alt", code: "alt_missing_default_locale", message: "The default-language alt text is empty." });
  }
  if (JSON.stringify(assetSnapshot(next)) === JSON.stringify(before)) {
    return { asset: { ...asset, warnings }, etag: etagOf(asset.updated_at) };
  }
  const stamp = tick(db);
  pushRevision(db, "media/assets", asset.id, "media.assets", "history", before, null, stamp, MOCK_USER);
  next.updated_at = stamp;
  next.updated_by = MOCK_USER;
  Object.assign(asset, next);
  recomputeFolders(db);
  return { asset: { ...asset, warnings }, etag: etagOf(asset.updated_at) };
}

export function deleteAsset(db: MockDb, id: string, ifMatch: string | null) {
  const asset = findAsset(db, id);
  requireIfMatch(ifMatch, etagOf(asset.updated_at));
  if (asset.deleted_at) return;
  const usages = db.usages[asset.id] ?? [];
  if (usages.length > 0) {
    throw fail(409, "MEDIA_IN_USE", `Cannot delete: the image is used in ${usages.length} place(s).`, {
      details: {
        usages: usages.slice(0, 50).map(({ entity_type, id: uid, title, field }) => ({ entity_type, id: uid, title, field })),
        total_usages: usages.length,
      },
    });
  }
  const now = tick(db);
  asset.deleted_at = now;
  asset.purge_at = new Date(Date.parse(now) + 30 * 86_400_000).toISOString();
  asset.updated_at = now;
  asset.updated_by = MOCK_USER;
  recomputeFolders(db);
}

export function restoreAsset(db: MockDb, id: string, ifMatch: string | null) {
  const asset = findAsset(db, id);
  requireIfMatch(ifMatch, etagOf(asset.updated_at));
  if (!asset.deleted_at) throw invalidState("not_trashed");
  asset.deleted_at = null;
  asset.purge_at = null;
  if (asset.folder_id && !db.folders.some((f) => f.id === asset.folder_id)) asset.folder_id = null;
  asset.updated_at = tick(db);
  asset.updated_by = MOCK_USER;
  recomputeFolders(db);
  return { asset, etag: etagOf(asset.updated_at) };
}

export function listUsages(db: MockDb, id: string, params: Params) {
  rejectUnknown(params, ["page", "limit"]);
  const asset = findAsset(db, id);
  return paginate(db.usages[asset.id] ?? [], params, 50);
}

// ---------------------------------------------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------------------------------------------
const FOLDER_NAME = /^[^/\\]+$/;

export function listFolders(db: MockDb) {
  recomputeFolders(db);
  return db.folders;
}

function validateFolderName(db: MockDb, name: unknown, parentId: number | null, selfId?: number): ApiFieldError[] {
  if (typeof name !== "string" || name.trim().length < 1) return [{ in: "body", path: "/name", code: "required" }];
  const trimmed = name.trim();
  if (trimmed.length > 120) return [{ in: "body", path: "/name", code: "too_long", params: { max: 120 } }];
  if (!FOLDER_NAME.test(trimmed)) return [{ in: "body", path: "/name", code: "pattern_mismatch" }];
  const twin = db.folders.find(
    (f) => f.id !== selfId && f.parent_id === parentId && f.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (twin) throw fail(409, "CONFLICT_DUPLICATE", "A folder with this name already exists.", { errors: [{ in: "body", path: "/name", code: "duplicate" }] });
  return [];
}

export function createFolder(db: MockDb, body: unknown) {
  const input = (body ?? {}) as Record<string, unknown>;
  const errors: ApiFieldError[] = [];
  for (const key of Object.keys(input)) {
    if (!["name", "parent_id", "sort_order"].includes(key)) errors.push({ in: "body", path: `/${key}`, code: "unknown_field" });
  }
  const parentId = (input.parent_id ?? null) as number | null;
  let parent: MediaFolder | undefined;
  if (parentId !== null) {
    parent = db.folders.find((f) => f.id === parentId);
    if (!parent) errors.push({ in: "body", path: "/parent_id", code: "unknown_reference" });
    else if (parent.depth >= 4) errors.push({ in: "body", path: "/parent_id", code: "max_depth_exceeded", params: { max_depth: 4 } });
  }
  errors.push(...validateFolderName(db, input.name, parentId));
  if (errors.length) throw validationFailed(errors);
  const stamp = tick(db);
  const folder: MediaFolder = {
    id: db.nextFolderId++,
    public_id: `0192d3a4-7c1e-7b52-9d0a-f${String(db.nextFolderId).padStart(11, "0")}`,
    parent_id: parentId,
    name: (input.name as string).trim(),
    sort_order: (input.sort_order as number | undefined) ?? 0,
    depth: 1,
    path: "",
    asset_count: 0,
    child_count: 0,
    etag: `"${stamp}"`,
    created_by: MOCK_USER,
    updated_by: MOCK_USER,
    created_at: stamp,
    updated_at: stamp,
  };
  db.folders.push(folder);
  recomputeFolders(db);
  return folder;
}

export function patchFolder(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
  const folder = db.folders.find((f) => String(f.id) === id);
  if (!folder) throw notFound();
  const input = (body ?? {}) as Record<string, unknown>;
  const errors: ApiFieldError[] = [];
  for (const key of Object.keys(input)) {
    if (!["name", "parent_id", "sort_order"].includes(key)) errors.push({ in: "body", path: `/${key}`, code: "unknown_field" });
  }
  if (Object.keys(input).length === 0) errors.push({ in: "body", path: "", code: "min_properties" });
  if (errors.length) throw validationFailed(errors);
  if (ifMatch && ifMatch !== folder.etag) throw lockConflict();
  const parentId = "parent_id" in input ? (input.parent_id as number | null) : folder.parent_id;
  if (parentId !== null) {
    let cur: MediaFolder | undefined = db.folders.find((f) => f.id === parentId);
    if (!cur) throw validationFailed([{ in: "body", path: "/parent_id", code: "unknown_reference" }]);
    for (let guard = 0; cur && guard < 10; guard++) {
      if (cur.id === folder.id) throw validationFailed([{ in: "body", path: "/parent_id", code: "cycle_detected" }]);
      cur = cur.parent_id ? db.folders.find((f) => f.id === cur!.parent_id) : undefined;
    }
  }
  if ("name" in input) {
    const nameErrors = validateFolderName(db, input.name, parentId, folder.id);
    if (nameErrors.length) throw validationFailed(nameErrors);
    folder.name = (input.name as string).trim();
  }
  folder.parent_id = parentId;
  if ("sort_order" in input) folder.sort_order = input.sort_order as number;
  folder.updated_at = tick(db);
  folder.updated_by = MOCK_USER;
  recomputeFolders(db);
  return folder;
}

export function deleteFolder(db: MockDb, id: string, ifMatch: string | null) {
  const folder = db.folders.find((f) => String(f.id) === id);
  if (!folder) throw notFound();
  if (ifMatch && ifMatch !== folder.etag) throw lockConflict();
  recomputeFolders(db);
  if (folder.asset_count > 0 || folder.child_count > 0) {
    throw invalidState("folder_not_empty", { asset_count: folder.asset_count, child_count: folder.child_count });
  }
  db.folders = db.folders.filter((f) => f.id !== folder.id);
}

// ---------------------------------------------------------------------------------------------------------------
// Revisions
// ---------------------------------------------------------------------------------------------------------------
function revisionList(db: MockDb, resource: string, id: string) {
  const list = db.revisions[keyOf(resource, id)];
  if (!list) {
    // an entity that exists (asset) without history yet
    if (resource === "media/assets") {
      findAsset(db, id);
      return [];
    }
    if (revisionEntityExists(db, resource, id)) return [];
    throw notFound();
  }
  return list;
}

// Does the entity a revision endpoint hangs off exist? Trashed categories / tags / assets still do (their history is
// readable, 05 11.7 item 1). A unit-test or playground id that only has an entry in `db.entities` counts as well.
function revisionEntityExists(db: MockDb, resource: string, id: string): boolean {
  switch (resource) {
    case "menus":
      return db.menus.some((m) => m.key === id);
    case "settings":
      return ["brand", "contact", "footer", "site", "seo"].includes(id);
    case "ui-strings":
      return uiStringKnown(db, id);
    case "categories":
      return db.categories.some((c) => String(c.id) === id);
    case "tags":
      return db.tags.some((t) => String(t.id) === id);
    default:
      return Boolean(db.entities[keyOf(resource, id)]);
  }
}

const toSummary = ({ entity: _e, snapshot: _s, ...summary }: StoredRevision): RevisionSummary => {
  void _e;
  void _s;
  return summary;
};

export function listRevisions(db: MockDb, resource: string, id: string, params: Params) {
  rejectUnknown(params, ["page", "limit", "kind", "include_preview", "sort"]);
  const list = revisionList(db, resource, id);
  const errors: ApiFieldError[] = [];
  const kinds = params.get("kind")?.split(",").filter(Boolean);
  if (kinds?.some((k) => k !== "history" && k !== "restore")) errors.push({ in: "query", path: "/kind", code: "not_in_enum" });
  const sort = params.get("sort") ?? "-version";
  if (sort !== "-version" && sort !== "version") errors.push({ in: "query", path: "/sort", code: "not_in_enum" });
  if (errors.length) throw validationFailed(errors);
  let rows = list.slice();
  if (kinds?.length) rows = rows.filter((r) => kinds.includes(r.kind));
  // `include_preview` is accepted and has no effect on save-live
  rows.sort((a, b) => (sort === "version" ? a.version - b.version : b.version - a.version));
  return paginate(rows.map(toSummary), params);
}

export function getRevision(db: MockDb, resource: string, id: string, revId: string) {
  const rev = revisionList(db, resource, id).find((r) => String(r.id) === revId);
  if (!rev) throw notFound();
  return rev;
}

function snapshotRefs(db: MockDb, snapshot: Record<string, unknown>): ApiFieldError[] {
  const asset = snapshot.asset as { folder_id?: number | null } | undefined;
  if (asset && typeof asset.folder_id === "number" && !db.folders.some((f) => f.id === asset.folder_id)) {
    return [{ in: "entity", path: "/asset/folder_id", code: "unknown_reference" }];
  }
  return [];
}

export function restoreRevision(db: MockDb, resource: string, id: string, revId: string, body: unknown, ifMatch: string | null) {
  const list = revisionList(db, resource, id);
  const rev = list.find((r) => String(r.id) === revId);
  if (!rev) throw notFound();
  const changeNote = (body as { change_note?: unknown } | null | undefined)?.change_note;
  if (changeNote !== undefined && (typeof changeNote !== "string" || [...changeNote].length > 200)) {
    throw validationFailed([{ in: "body", path: "/change_note", code: "too_long", params: { max: 200 } }]);
  }
  const restoredFrom = { revision_id: rev.id, version: rev.version };
  const note = (typeof changeNote === "string" && changeNote) || `restore of v${rev.version}`;

  if (resource === "media/assets") {
    const asset = findAsset(db, id);
    requireIfMatch(ifMatch, etagOf(asset.updated_at));
    if (asset.deleted_at) throw invalidState("trashed");
    if (rev.schema_version > 1) throw invalidState("snapshot_incompatible");
    const refs = snapshotRefs(db, rev.snapshot);
    if (refs.length) throw validationFailed(refs);
    const before = assetSnapshot(asset);
    if (JSON.stringify(before) === JSON.stringify(rev.snapshot)) {
      return { data: { ...asset, restored_from: restoredFrom }, etag: etagOf(asset.updated_at) };
    }
    const stamp = tick(db);
    pushRevision(db, "media/assets", asset.id, "media.assets", "restore", before, note, stamp, MOCK_USER);
    const snap = rev.snapshot as {
      asset: { folder_id: number | null; is_decorative: boolean; focal_x: number | null; focal_y: number | null };
      translations: Array<{ locale_code: string; alt: string; caption: string | null; credit: string | null }>;
    };
    asset.folder_id = snap.asset.folder_id;
    asset.is_decorative = snap.asset.is_decorative;
    asset.focal = snap.asset.focal_x === null || snap.asset.focal_y === null ? null : { x: snap.asset.focal_x, y: snap.asset.focal_y };
    asset.translations = Object.fromEntries(
      snap.translations.map((t) => [t.locale_code, { alt: t.alt, caption: t.caption, credit: t.credit }])
    );
    asset.updated_at = stamp;
    asset.updated_by = MOCK_USER;
    recomputeFolders(db);
    return { data: { ...asset, restored_from: restoredFrom }, etag: etagOf(asset.updated_at) };
  }

  // The five save-live entities have their own model: the snapshot is applied to the real rows (and checked).
  const found = { id: rev.id, version: rev.version, schema_version: rev.schema_version, snapshot: rev.snapshot };
  if (resource === "menus") return restoreMenu(db, id, found, note, ifMatch);
  if (resource === "settings") return restoreSettings(db, id, found, note, ifMatch);
  if (resource === "ui-strings") return restoreUiString(db, id, found, note, ifMatch);
  if (resource === "categories" || resource === "tags") return restoreTaxonomy(db, resource, id, found, note, ifMatch);

  // Anything else (an id only a test or the playground invents): a stub entity with an ETag.
  const entity = db.entities[keyOf(resource, id)] ?? (db.entities[keyOf(resource, id)] = { etag: etagOf(tick(db)), body: { key: id } });
  requireIfMatch(ifMatch, entity.etag);
  if (rev.schema_version > 1) throw invalidState("snapshot_incompatible");
  const stamp = tick(db);
  pushRevision(db, resource, id, rev.entity.type, "restore", rev.snapshot, note, stamp, MOCK_USER);
  entity.etag = etagOf(stamp);
  entity.body = { ...rev.snapshot };
  return { data: { ...entity.body, restored_from: restoredFrom }, etag: entity.etag };
}

export function getEntity(db: MockDb, resource: string, id: string) {
  const entity = db.entities[keyOf(resource, id)];
  if (!entity) throw notFound();
  return entity;
}

// ---------------------------------------------------------------------------------------------------------------
// Cache purge (doc/05 11.8)
// ---------------------------------------------------------------------------------------------------------------
export const PURGE_LIMITS = { tags: 30, all: 3 } as const;

export function purgeCache(db: MockDb, body: unknown): CachePurgeResult {
  const input = (body ?? {}) as Record<string, unknown>;
  const errors: ApiFieldError[] = [];
  for (const key of Object.keys(input)) {
    if (!["scope", "tags", "reason"].includes(key)) errors.push({ in: "body", path: `/${key}`, code: "unknown_field" });
  }
  const scope = input.scope;
  if (scope !== "tags" && scope !== "all") errors.push({ in: "body", path: "/scope", code: scope === undefined ? "required" : "not_in_enum" });
  if (typeof input.reason === "string" && [...input.reason].length > 200) {
    errors.push({ in: "body", path: "/reason", code: "too_long", params: { max: 200 } });
  }
  let tags: string[] = [];
  if (scope === "tags") {
    const raw = input.tags;
    if (!Array.isArray(raw) || raw.length === 0) errors.push({ in: "body", path: "/tags", code: "required" });
    else {
      if (raw.length > 50) errors.push({ in: "body", path: "/tags", code: "too_many_items", params: { max: 50 } });
      raw.forEach((t, i) => {
        if (typeof t !== "string" || !PURGE_TAG_PATTERN.test(t)) errors.push({ in: "body", path: `/tags/${i}`, code: "pattern_mismatch" });
      });
      if (new Set(raw).size !== raw.length) errors.push({ in: "body", path: "/tags", code: "duplicate_items" });
      tags = raw as string[];
    }
  } else if (scope === "all" && "tags" in input) {
    errors.push({ in: "body", path: "/tags", code: "unknown_field" });
  }
  if (errors.length) throw validationFailed(errors);

  const kind = scope as "tags" | "all";
  if (db.purges[kind] >= PURGE_LIMITS[kind]) {
    throw fail(429, "RATE_LIMITED", "Too many requests. Please try again later.", {}, { "Retry-After": "1800" });
  }
  db.purges[kind] += 1;
  let queued = tags;
  if (kind === "tags") {
    const paired = new Set(tags);
    for (const t of tags) {
      if (t.startsWith("page:")) paired.add("pages");
      if (t.startsWith("post:")) paired.add("posts:list");
      if (t.startsWith("album:")) paired.add("albums:list");
    }
    queued = [...paired].sort();
  } else {
    queued = ["*"];
  }
  return { event_id: 90_000 + db.purges.tags + db.purges.all, scope: kind, tags: queued, status: "queued", queued_at: tick(db) };
}
