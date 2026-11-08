// SCR-22 shared sections (doc/05 section 18): publishable roots (ETag = `"<lock_version>"`) on the publish engine of `mock-faq-album-engine.ts`.
// Strict like the backend: unknown field / query key = 422, no `If-Match` = 428, stale = 409, the field rules of 18.3, immutable type (SS-13),
// DELETE = 409 `ENTITY_REFERENCED` `shared_section_in_use` while any page (the trash included) or page draft names it (SS-3), unpublish always
// succeeds with the warning `shared_section_referenced` (SS-4), usages (18.7), `placeable_on_page` (SS-7), revisions.
//
// Roles (`db.sharedSectionRole`, 05 18.15): `admin` and `editor` = everything of this part; `viewer` (also `author`) = read only.
// `db.translateOnly` containing "shared-sections" = a translator (read + translate: only text under `x-localized`, SS-8).
import { computeCompleteness } from "@/components/schema-form/completeness";
import { SECTION_TYPE_FIXTURES } from "@/components/schema-form/fixtures";
import pageGallery from "@/components/schema-form/fixtures/examples/page.gallery.json";
import pageHome from "@/components/schema-form/fixtures/examples/page.home.json";
import pageOurPath from "@/components/schema-form/fixtures/examples/page.our-path.json";
import {
  DEFAULT_LOCALE_CODE,
  MOCK_ACTIVE_LOCALE_CODES,
  MOCK_USER,
  boolParam,
  forbidden,
  invalidState,
  micros,
  notFound,
  paginate,
  pushRevision,
  rejectUnknown,
  tick,
  validationFailed,
  type MockDb,
  type MockSharedSection,
  type MockSharedSnapshot,
  type Params,
} from "@/mocks/mock-core";
import { TRASH_DAYS, isObject, issue, makeEngine, type Reference } from "@/mocks/mock-faq-album-engine";
import { draftRowOf as pageDraftRow, listItemOf as pageListItem, propsErrors, sharedPlacement, translatableViolation } from "@/mocks/mock-pages";
import { sharedHasDraft, sharedWorking } from "@/mocks/mock-shared-core";
import { parseMicros } from "@/mocks/mock-time";
import type { ApiFieldError } from "@/types/api";
import type { SaveLiveWarning } from "@/types/media";
import type { PublishIssue } from "@/types/publishing";
import type { SharedSection, SharedSectionListItem, SharedSectionReference, SharedSectionUsages, SharedUnpublishWarningParams, SharedUsagePage } from "@/types/shared-sections";

// Before the mock clock starts (`CLOCK_START`, 2026-10-27), so the published seeds are live.
const SEED_AT = micros(Date.UTC(2026, 9, 26, 9, 30, 0), 330);
const STATUSES = ["draft", "in_review", "scheduled", "published", "archived"];
const SORTS = ["updated_at", "name", "created_at", "published_at", "status", "deleted_at"];
const MAX_NAME = 120;
const MAX_REFERENCES = 50;
const MAX_USAGE_PAGES = 200;
const MAX_PROPS_BYTES = 262144;
const SOMCHAI = { id: 4, name: "Somchai Vongsa" };
const uuid = (id: number) => `0192e1f0-3c2a-7d11-8b5e-6a0c1d2e3f${String(id).padStart(2, "0")}`;

// ---------------------------------------------------------------------------------------------------------------
// Rights
// ---------------------------------------------------------------------------------------------------------------
type Right = "read" | "create" | "update" | "delete" | "publish" | "unpublish" | "translate";
function allowedAction(db: MockDb, right: Right): boolean {
  if (right === "read") return true;
  if (db.sharedSectionRole === "viewer") return false;
  if (db.translateOnly.includes("shared-sections")) return right === "translate";
  return true;
}
function need(db: MockDb, right: Right, method: string, path: string): void {
  if (!allowedAction(db, right)) throw forbidden(`cms.sections:${right} ${method} ${path}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Who references a shared section (18.6, 18.7)
// ---------------------------------------------------------------------------------------------------------------
const defaultTitle = (snap: { translations: Array<{ locale_code: string; title: string }> }) => snap.translations.find((t) => t.locale_code === DEFAULT_LOCALE_CODE)?.title ?? null;

// The rows 1 + 2 of 18.6: every page's real rows (trash included) and every page draft snapshot.
export function referencesOf(db: MockDb, id: number): SharedSectionReference[] {
  const out: SharedSectionReference[] = [];
  for (const page of db.pages.slice().sort((a, b) => a.id - b.id)) {
    const base = { entity_type: "cms.page", id: page.id, page_status: page.status, page_trashed: page.deleted_at !== null };
    for (const s of page.live.sections.filter((x) => x.shared_section_id === id)) {
      out.push({ ...base, title: defaultTitle(page.live), field: `/sections/${s.public_id}/shared_section_id`, kind: "section_ref", in_draft: false, section_id: s.id, is_visible: s.is_visible });
    }
    const draft = pageDraftRow(db, page)?.snapshot as unknown as typeof page.live | undefined;
    for (const s of draft?.sections.filter((x) => x.shared_section_id === id) ?? []) {
      out.push({ ...base, title: defaultTitle(draft!), field: `/sections/${s.public_id}/shared_section_id`, kind: "draft_section_ref", in_draft: true, section_id: s.id, is_visible: s.is_visible });
    }
  }
  return out;
}

export function usagesOf(db: MockDb, id: number, includeTrashed = true): SharedSectionUsages {
  const pages: SharedUsagePage[] = [];
  for (const page of db.pages.slice().sort((a, b) => a.id - b.id)) {
    if (!includeTrashed && page.deleted_at) continue;
    const sections: SharedUsagePage["sections"] = [];
    for (const s of page.live.sections.filter((x) => x.shared_section_id === id)) sections.push({ section_id: s.id, public_id: s.public_id, where: "live", is_visible: s.is_visible, sort_order: s.sort_order });
    const draft = pageDraftRow(db, page)?.snapshot as unknown as typeof page.live | undefined;
    for (const s of draft?.sections.filter((x) => x.shared_section_id === id) ?? []) sections.push({ section_id: s.id, public_id: s.public_id, where: "draft", is_visible: s.is_visible, sort_order: s.sort_order });
    if (sections.length === 0) continue;
    const item = pageListItem(db, page);
    const live = page.status === "published" && !page.deleted_at && parseMicros(page.published_at ?? "9999-01-01T00:00:00.000+07:00") <= db.clock && (page.unpublished_at === null || parseMicros(page.unpublished_at) > db.clock);
    pages.push({
      page_id: page.id,
      title: item.title,
      path: page.live.page.path,
      template: page.live.page.template,
      status: page.status,
      has_unpublished_changes: item.has_unpublished_changes,
      deleted_at: page.deleted_at,
      live_on_site: live && sections.some((x) => x.where === "live" && x.is_visible),
      sections,
    });
  }
  return { shared_section_id: id, total_pages: pages.length, truncated: pages.length > MAX_USAGE_PAGES, pages: pages.slice(0, MAX_USAGE_PAGES) };
}

// SS-15: pages outside the trash / in the trash that name it in a real row or a draft.
function counts(db: MockDb, id: number): { used_in_pages: number; used_in_trashed_pages: number } {
  const u = usagesOf(db, id);
  return { used_in_pages: u.pages.filter((p) => !p.deleted_at).length, used_in_trashed_pages: u.pages.filter((p) => p.deleted_at).length };
}

// ---------------------------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------------------------
const typeOf = (root: MockSharedSection) => SECTION_TYPE_FIXTURES[root.section_type];

function sectionTypeLite(root: MockSharedSection) {
  const type = typeOf(root);
  return {
    id: 100 + Object.keys(SECTION_TYPE_FIXTURES).indexOf(root.section_type) + 1,
    key: root.section_type,
    version: root.section_version,
    name: type?.name ?? root.section_type,
    is_active: Boolean(type) && type.is_active !== false,
    code_registered: Boolean(type),
  };
}

function view(db: MockDb, root: MockSharedSection, detail: boolean): SharedSectionListItem | SharedSection {
  const snap = sharedWorking(db, root);
  const type = typeOf(root);
  const draft = sharedHasDraft(db, root) ? engine.draftRow(db, root) : undefined;
  const completeness = type ? computeCompleteness(type.json_schema, snap.props, [...MOCK_ACTIVE_LOCALE_CODES]) : {};
  const list: SharedSectionListItem = {
    id: root.id,
    public_id: root.public_id,
    name: snap.name,
    section_type: sectionTypeLite(root),
    variant: snap.variant,
    effective_variant: snap.variant ?? type?.variants?.[0] ?? null,
    props_bytes: JSON.stringify(snap.props).length,
    unsupported: !type,
    translation_status: Object.fromEntries(MOCK_ACTIVE_LOCALE_CODES.map((c) => [c, { missing: completeness[c]?.missing.length ?? 0 }])),
    ...counts(db, root.id),
    draft: draft ? { revision_id: draft.id, version: draft.version, created_at: draft.created_at, created_by: draft.created_by } : null,
    status: root.status,
    lock_version: root.lock_version,
    has_unpublished_changes: sharedHasDraft(db, root),
    published_at: root.published_at,
    first_published_at: root.first_published_at,
    scheduled_at: null,
    unpublished_at: root.unpublished_at,
    created_by: root.created_by,
    updated_by: root.updated_by,
    created_at: root.created_at,
    updated_at: root.updated_at,
    deleted_at: root.deleted_at,
    purge_at: root.deleted_at ? micros(Date.parse(root.deleted_at) + TRASH_DAYS * 86_400_000, 0) : null,
  };
  return detail ? { ...list, props: structuredClone(snap.props) } : list;
}

// ---------------------------------------------------------------------------------------------------------------
// The publish rules of 18.8.2
// ---------------------------------------------------------------------------------------------------------------
function walk(value: unknown, key: string, pointer: string, visit: (v: unknown, pointer: string) => void) {
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, key, `${pointer}/${i}`, visit));
  else if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === key) visit(v, `${pointer}/${k}`);
      else walk(v, key, `${pointer}/${k}`, visit);
    }
  }
}

// References inside the props: a missing / trashed thing is `unknown_reference`; `published` is asked for albums only (a page link only warns).
function refIssues(db: MockDb, props: Record<string, unknown>, base: string): { blockers: PublishIssue[]; warnings: PublishIssue[] } {
  const blockers: PublishIssue[] = [];
  const warnings: PublishIssue[] = [];
  walk(props, "media_id", base, (v, pointer) => {
    if (typeof v === "number" && !db.assets.some((a) => a.id === v && !a.deleted_at)) blockers.push(issue(pointer, "unknown_reference", { ref_type: "media_assets", ref_id: v }));
  });
  walk(props, "page_id", base, (v, pointer) => {
    if (typeof v !== "number") return;
    const target = db.pages.find((p) => p.id === v);
    if (!target || target.deleted_at) blockers.push(issue(pointer, "unknown_reference", { ref_type: "pages", ref_id: v }));
    else if (target.status !== "published") warnings.push(issue(pointer, "link_page_not_published", { ref_id: v }, false));
  });
  walk(props, "album_id", base, (v, pointer) => {
    if (typeof v !== "number") return;
    const album = db.albums.find((a) => a.id === v && !a.deleted_at);
    if (!album) blockers.push(issue(pointer, "unknown_reference", { ref_type: "albums", ref_id: v }));
    else if (album.status !== "published") blockers.push(issue(pointer, "reference_not_published", { ref_type: "albums", ref_id: v }));
  });
  return { blockers, warnings };
}

function validateForPublish(db: MockDb, root: MockSharedSection): { blockers: PublishIssue[]; warnings: PublishIssue[] } {
  const snap = sharedWorking(db, root);
  const type = typeOf(root);
  const blockers: PublishIssue[] = [];
  const warnings: PublishIssue[] = [];
  if (!type) blockers.push(issue("/section_type", "section_type_unknown", { section_key: root.section_type }));
  else if (type.is_active === false) blockers.push(issue("/section_type", "section_type_inactive", { section_key: root.section_type }));
  if (type && snap.variant !== null && !type.variants.includes(snap.variant)) blockers.push(issue("/variant", "not_in_enum", { expected: type.variants }));
  if (type) {
    const result = computeCompleteness(type.json_schema, snap.props, [...MOCK_ACTIVE_LOCALE_CODES]);
    for (const leaf of result[DEFAULT_LOCALE_CODE]?.missing ?? []) blockers.push(issue(`/props${leaf.path}`, "empty_default_locale", { locale: DEFAULT_LOCALE_CODE }));
    for (const code of MOCK_ACTIVE_LOCALE_CODES) {
      const missing = result[code]?.missing.length ?? 0;
      if (code !== DEFAULT_LOCALE_CODE && missing > 0) warnings.push(issue("/props", "translation_incomplete", { locale: code, missing }, false));
    }
  }
  const refs = refIssues(db, snap.props, "/props");
  blockers.push(...refs.blockers);
  warnings.push(...refs.warnings);
  return { blockers, warnings };
}

// ---------------------------------------------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------------------------------------------
function unpublishWarnings(db: MockDb, root: MockSharedSection): SaveLiveWarning[] {
  const refs = referencesOf(db, root.id);
  if (refs.length === 0) return [];
  const usages = usagesOf(db, root.id);
  const liveOnSite = usages.pages.filter((p) => p.live_on_site);
  const blocked = db.pages.filter((page) => {
    if (page.deleted_at) return false;
    const snap = (pageDraftRow(db, page)?.snapshot as unknown as typeof page.live | undefined) ?? page.live;
    return snap.sections.some((s) => s.shared_section_id === root.id && s.is_visible);
  }).length;
  const params: SharedUnpublishWarningParams = {
    total_references: refs.length,
    live_pages: liveOnSite.slice(0, MAX_REFERENCES).map((p) => ({ id: p.page_id, title: p.title, path: p.path })),
    live_pages_total: liveOnSite.length,
    pages_blocked_on_publish: blocked,
    truncated: liveOnSite.length > MAX_REFERENCES,
  };
  return [{ path: "", code: "shared_section_referenced", message: "The section leaves the website pages and those pages can not be published until it is published again, hidden, deleted or detached.", params: params as unknown as SaveLiveWarning["params"] }];
}

const engine = makeEngine<MockSharedSection, SharedSection>({
  kind: "shared-sections",
  entityType: "cms.shared_sections",
  permission: "cms.sections",
  path: "/shared-sections/{id}",
  roots: (db) => db.sharedSections,
  view: (db, root) => view(db, root, true) as SharedSection,
  validate: (db, root) => validateForPublish(db, root),
  references: (db, root) => referencesOf(db, root.id) as unknown as Reference[],
  referencedReason: "shared_section_in_use",
  referencedWarning: "shared_section_referenced",
  unpublishWarnings,
  // No unique key to collide with (SS-14).
  restoreConflicts: () => [],
  snapshotRefs: (db, snapshot) => refIssues(db, (snapshot as MockSharedSnapshot).props, "/props").blockers.map((b) => ({ in: "entity" as const, path: b.path, code: b.code, params: b.params as ApiFieldError["params"] })),
  childrenOf: () => [],
});
export const sharedEngine = engine;

const openRoot = (db: MockDb, id: string) => engine.find(db, id);

// ---------------------------------------------------------------------------------------------------------------
// List / get
// ---------------------------------------------------------------------------------------------------------------
export function listSharedSections(db: MockDb, params: Params) {
  rejectUnknown(params, ["page", "limit", "keyword", "section_type", "status", "has_unpublished_changes", "in_use", "placeable_on_page", "trashed", "sort"]);
  const errors: ApiFieldError[] = [];
  const keyword = params.get("keyword")?.trim().toLowerCase();
  if (keyword && [...keyword].length > 100) errors.push({ in: "query", path: "/keyword", code: "too_long", params: { max: 100 } });
  const types = params.get("section_type")?.split(",").filter(Boolean);
  if (types && (types.length > 12 || types.some((k) => !SECTION_TYPE_FIXTURES[k]))) errors.push({ in: "query", path: "/section_type", code: "unknown_reference" });
  const statuses = params.get("status")?.split(",").filter(Boolean);
  if (statuses && (statuses.length > 5 || statuses.some((x) => !STATUSES.includes(x)))) errors.push({ in: "query", path: "/status", code: "not_in_enum", params: { expected: STATUSES } });
  const sort = params.get("sort") ?? "-updated_at";
  const m = /^(-?)([a-z_]+)$/.exec(sort);
  if (!m || !SORTS.includes(m[2])) errors.push({ in: "query", path: "/sort", code: "not_in_enum", params: { expected: SORTS } });
  const pending = boolParam(params, "has_unpublished_changes");
  const inUse = boolParam(params, "in_use");
  const trashed = boolParam(params, "trashed") ?? false;
  const placeableRaw = params.get("placeable_on_page");
  let placeable: (typeof db.pages)[number] | undefined;
  if (placeableRaw !== null) {
    placeable = /^[1-9]\d*$/.test(placeableRaw) ? db.pages.find((p) => String(p.id) === placeableRaw && !p.deleted_at) : undefined;
    if (!placeable) errors.push({ in: "query", path: "/placeable_on_page", code: "unknown_reference", params: { ref_type: "pages" } });
  }
  if (errors.length) throw validationFailed(errors);
  if (trashed) need(db, "delete", "GET", "/shared-sections?trashed=true");

  let rows = db.sharedSections.filter((r) => (r.deleted_at !== null) === trashed);
  if (keyword) rows = rows.filter((r) => r.live.name.toLowerCase().includes(keyword));
  if (types?.length) rows = rows.filter((r) => types.includes(r.section_type));
  if (statuses?.length) rows = rows.filter((r) => statuses.includes(r.status));
  if (pending !== undefined) rows = rows.filter((r) => sharedHasDraft(db, r) === pending);
  if (inUse !== undefined) rows = rows.filter((r) => { const c = counts(db, r.id); return c.used_in_pages + c.used_in_trashed_pages > 0 === inUse; });
  if (placeable) {
    rows = rows.filter((r) => {
      const type = typeOf(r);
      const place = sharedPlacement(placeable!.live.page.template, r.section_type);
      return Boolean(type) && type.is_active !== false && (type.allowed_scopes ?? []).includes("page") && place.allowed && !place.requiredSlot;
    });
  }
  const dir = m![1] ? -1 : 1;
  const field = m![2];
  const items = rows.map((r) => view(db, r, false));
  items.sort((x, y) => {
    const a = (x as unknown as Record<string, string | null>)[field] ?? "";
    const b = (y as unknown as Record<string, string | null>)[field] ?? "";
    return String(a).localeCompare(String(b)) * dir || x.id - y.id;
  });
  return paginate(items, params);
}

export function getSharedSection(db: MockDb, id: string) {
  const root = openRoot(db, id);
  // A row in the trash: a caller without `delete` gets a 404 (10.3).
  if (root.deleted_at && !allowedAction(db, "delete")) throw notFound();
  return { data: view(db, root, true) as SharedSection, etag: engine.etagOfRoot(root) };
}

export function getUsages(db: MockDb, id: string, params: Params) {
  rejectUnknown(params, ["include_trashed"]);
  const root = openRoot(db, id);
  if (root.deleted_at && !allowedAction(db, "delete")) throw notFound();
  return { data: usagesOf(db, root.id, boolParam(params, "include_trashed") ?? true) };
}

// ---------------------------------------------------------------------------------------------------------------
// Create / patch
// ---------------------------------------------------------------------------------------------------------------
function nameErrors(name: unknown, required: boolean): ApiFieldError[] {
  if (name === undefined) return required ? [{ in: "body", path: "/name", code: "required" }] : [];
  if (typeof name !== "string") return [{ in: "body", path: "/name", code: "invalid_type" }];
  const len = [...name.trim()].length;
  if (len < 1) return [{ in: "body", path: "/name", code: "too_short", params: { min: 1 } }];
  if (len > MAX_NAME) return [{ in: "body", path: "/name", code: "too_long", params: { max: MAX_NAME } }];
  return [];
}

export function createSharedSection(db: MockDb, body: unknown) {
  need(db, "create", "POST", "/shared-sections");
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(body)) if (!["name", "section_type_key", "variant", "props"].includes(k)) errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  errors.push(...nameErrors(body.name, true));
  const key = body.section_type_key;
  const type = typeof key === "string" ? SECTION_TYPE_FIXTURES[key] : undefined;
  if (key === undefined) errors.push({ in: "body", path: "/section_type_key", code: "required" });
  else if (typeof key !== "string") errors.push({ in: "body", path: "/section_type_key", code: "invalid_type" });
  else if (!type) errors.push({ in: "body", path: "/section_type_key", code: "unknown_reference" });
  else if (type.is_active === false) errors.push({ in: "body", path: "/section_type_key", code: "section_type_inactive" });
  else if (!(type.allowed_scopes ?? []).includes("shared")) errors.push({ in: "body", path: "/section_type_key", code: "not_in_enum", params: { expected: type.allowed_scopes ?? [] } });
  if (type && body.variant !== undefined && body.variant !== null && (typeof body.variant !== "string" || !type.variants.includes(body.variant))) errors.push({ in: "body", path: "/variant", code: "not_in_enum", params: { expected: type.variants } });
  if (body.props !== undefined && !isObject(body.props)) errors.push({ in: "body", path: "/props", code: "invalid_type", params: { expected: "object" } });
  else if (type && isObject(body.props)) errors.push(...propsErrors(db, type.key, body.props));
  if (errors.length) throw validationFailed(errors);

  const id = db.nextSharedSectionId++;
  const stamp = tick(db);
  const root: MockSharedSection = {
    id,
    public_id: uuid(id),
    key: String(id),
    section_type: type!.key,
    section_version: type!.version,
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
      name: (body.name as string).trim(),
      section_type: type!.key,
      section_version: type!.version,
      variant: (body.variant as string | null | undefined) ?? null,
      props: structuredClone((isObject(body.props) ? body.props : type!.default_props) as Record<string, unknown>),
    },
  };
  db.sharedSections.push(root);
  return { data: engine.writeResult(db, root), etag: engine.etagOfRoot(root), location: `/api/v1/shared-sections/${id}` };
}

export function patchSharedSection(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
  const root = openRoot(db, id);
  if (root.deleted_at && !allowedAction(db, "delete")) throw notFound();
  if (!allowedAction(db, "update") && !allowedAction(db, "translate")) need(db, "update", "PATCH", "/shared-sections/{id}");
  engine.requireMatch(ifMatch, root);
  engine.trashedCheck(root);
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const type = typeOf(root);
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(body)) {
    if (k === "section_type_key" || k === "section_version") errors.push({ in: "body", path: `/${k}`, code: "immutable" });
    else if (!["name", "variant", "props"].includes(k)) errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  }
  if (Object.keys(body).length === 0) errors.push({ in: "body", path: "", code: "min_properties" });
  errors.push(...nameErrors(body.name, false));
  if (body.variant !== undefined && body.variant !== null && (typeof body.variant !== "string" || !type?.variants.includes(body.variant))) errors.push({ in: "body", path: "/variant", code: "not_in_enum", params: { expected: type?.variants ?? [] } });
  if (body.props !== undefined) {
    if (!isObject(body.props)) errors.push({ in: "body", path: "/props", code: "invalid_type", params: { expected: "object" } });
    else if (JSON.stringify(body.props).length > MAX_PROPS_BYTES) errors.push({ in: "body", path: "/props", code: "too_long", params: { unit: "bytes", max: MAX_PROPS_BYTES } });
    else if (type) errors.push(...propsErrors(db, type.key, body.props));
  }
  if (errors.length) throw validationFailed(errors);

  const current = sharedWorking(db, root);
  // Rights per field (18.3): `name`, `variant` need `update`; `props` needs `update` or `translate` (a translator: only `x-localized` text).
  const canUpdate = allowedAction(db, "update");
  if (!canUpdate) {
    if (body.name !== undefined && body.name !== current.name) throw forbidden("cms.sections:update /name");
    if (body.variant !== undefined && body.variant !== current.variant) throw forbidden("cms.sections:update /variant");
    if (isObject(body.props)) {
      const bad = translatableViolation(root.section_type, current.props, body.props);
      if (bad) throw forbidden(`cms.sections:update ${bad}`);
    }
  }
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const same =
    (name === undefined || name === current.name) &&
    (body.variant === undefined || body.variant === current.variant) &&
    (body.props === undefined || JSON.stringify(body.props) === JSON.stringify(current.props));
  if (same) return { data: engine.writeResult(db, root), etag: engine.etagOfRoot(root) };

  const { snapshot, stamp } = engine.beginWrite(db, root);
  const s = snapshot as MockSharedSnapshot;
  if (name !== undefined) s.name = name;
  if (body.variant !== undefined) s.variant = body.variant as string | null;
  if (body.props !== undefined) s.props = structuredClone(body.props) as Record<string, unknown>;
  engine.commitWrite(root, stamp);
  return { data: engine.writeResult(db, root), etag: engine.etagOfRoot(root) };
}

// ---------------------------------------------------------------------------------------------------------------
// Delete / restore / commands / revisions
// ---------------------------------------------------------------------------------------------------------------
export function deleteSharedSection(db: MockDb, id: string, params: Params, ifMatch: string | null) {
  need(db, "delete", "DELETE", "/shared-sections/{id}");
  return engine.remove(db, id, params, ifMatch);
}
export function restoreSharedSection(db: MockDb, id: string, ifMatch: string | null) {
  need(db, "delete", "POST", "/shared-sections/{id}/restore");
  return engine.restoreFromTrash(db, id, ifMatch);
}
export function publishSharedSection(db: MockDb, id: string, params: Params, body: unknown, ifMatch: string | null) {
  need(db, "publish", "POST", "/shared-sections/{id}/publish");
  return engine.publish(db, id, params, body, ifMatch);
}
export function unpublishSharedSection(db: MockDb, id: string, params: Params, ifMatch: string | null) {
  need(db, "unpublish", "POST", "/shared-sections/{id}/unpublish");
  return engine.unpublish(db, id, params, ifMatch);
}
export function discardSharedDraft(db: MockDb, id: string, ifMatch: string | null) {
  need(db, "update", "POST", "/shared-sections/{id}/discard-draft");
  return engine.discardDraft(db, id, ifMatch);
}
export const listSharedRevisions = (db: MockDb, id: string, params: Params) => engine.listRevisions(db, id, params);
export const getSharedRevision = (db: MockDb, id: string, revId: string) => engine.getRevision(db, id, revId);

// 18.8.4: the snapshot must be of the row's type and version (409 `snapshot_incompatible`), its variant must still exist (422), the engine checks the references.
export function restoreSharedRevision(db: MockDb, id: string, revId: string, body: unknown, ifMatch: string | null) {
  need(db, "update", "POST", "/shared-sections/{id}/revisions/{revId}/restore");
  const root = openRoot(db, id);
  const rev = engine.revList(db, root).find((r) => String(r.id) === revId);
  if (!rev) throw notFound();
  engine.requireMatch(ifMatch, root);
  const snap = rev.snapshot as unknown as MockSharedSnapshot;
  if (snap.section_type !== root.section_type || snap.section_version !== root.section_version) throw invalidState("snapshot_incompatible");
  const type = typeOf(root);
  if (snap.variant !== null && !type?.variants.includes(snap.variant)) throw validationFailed([{ in: "entity", path: "/variant", code: "not_in_enum", params: { expected: type?.variants ?? [] } }]);
  return engine.restoreRevision(db, id, revId, body, ifMatch);
}

// ---------------------------------------------------------------------------------------------------------------
// Seed: unreferenced on purpose (the seeded pages keep their sections); tests and the click-through place them from the "Shared" tab.
// ---------------------------------------------------------------------------------------------------------------
type Seed = { id: number; name: string; type: string; variant: string | null; props: Record<string, unknown>; status: MockSharedSection["status"]; trashed?: boolean };
const sectionProps = (page: { sections: Array<{ section_type: string; props: unknown }> }, type: string) => structuredClone(page.sections.find((s) => s.section_type === type)!.props) as Record<string, unknown>;

export function seedSharedSections(db: MockDb) {
  const seeds: Seed[] = [
    { id: 1, name: "Gallery teaser", type: "gallery_cards", variant: "home", props: sectionProps(pageHome as never, "gallery_cards"), status: "published" },
    { id: 2, name: "Our promise (text)", type: "intro_text", variant: null, props: sectionProps(pageGallery as never, "intro_text"), status: "draft" },
    { id: 3, name: "Forest photo story", type: "photo_story", variant: null, props: sectionProps(pageGallery as never, "photo_story"), status: "published" },
    { id: 4, name: "Old banner", type: "intro_heading", variant: null, props: sectionProps(pageOurPath as never, "intro_heading"), status: "archived", trashed: true },
  ];
  for (const seed of seeds) {
    const type = SECTION_TYPE_FIXTURES[seed.type];
    const live: MockSharedSnapshot = { name: seed.name, section_type: seed.type, section_version: type.version, variant: seed.variant, props: seed.props };
    const published = seed.status === "published" || seed.trashed;
    const root: MockSharedSection = {
      id: seed.id,
      public_id: uuid(seed.id),
      key: String(seed.id),
      section_type: seed.type,
      section_version: type.version,
      status: seed.status,
      lock_version: 1,
      published_at: published ? SEED_AT : null,
      first_published_at: published ? SEED_AT : null,
      unpublished_at: seed.trashed ? micros(Date.UTC(2026, 9, 26, 12, 0, 0), 330) : null,
      created_by: SOMCHAI,
      updated_by: SOMCHAI,
      created_at: SEED_AT,
      updated_at: SEED_AT,
      deleted_at: seed.trashed ? micros(Date.UTC(2026, 9, 26, 12, 0, 0), 330) : null,
      live,
    };
    db.sharedSections.push(root);
    if (published) pushRevision(db, "shared-sections", root.id, "cms.shared_sections", "published", structuredClone(live) as unknown as Record<string, unknown>, null, SEED_AT, SOMCHAI);
  }
  // 3 has a pending draft: another title of the photo story.
  const story = db.sharedSections.find((r) => r.id === 3)!;
  const draft = structuredClone(story.live);
  draft.props = { ...draft.props, accessible_heading: { la: "The forest photo story (revised)", en: "The forest photo story (revised)" } };
  pushRevision(db, "shared-sections", story.id, "cms.shared_sections", "draft", draft as unknown as Record<string, unknown>, null, micros(Date.UTC(2026, 9, 26, 13, 0, 0), 330), SOMCHAI);
  story.lock_version = 2;
  db.nextSharedSectionId = 5;
}

// Used by the mock tests: a draft edit made by somebody else (the next write with the old ETag is a 409).
export const touchSharedAsSomeoneElse = (db: MockDb, id: number) => engine.touchAsSomeoneElse(db, id);
