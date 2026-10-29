// In-memory model of the FAQ-group endpoints (doc/05 section 13.5, doc/api/openapi-admin.yaml: listFaqGroups, createFaqGroup, getFaqGroup,
// updateFaqGroup, deleteFaqGroup, restoreFaqGroup, list/create/update/delete FaqItem, reorder, publish / unpublish / discard-draft and
// the revisions), strict like the backend (see `mock-albums.ts`): both texts of a language row (`question` <= 200, `answer` = rich text
// profile `lite`), the default language needs both, a group a `faq` section names by `group_key` can not be deleted (409
// `ENTITY_REFERENCED`, nothing confirms it), 100 questions at most [proposal in 05 13.5.4], hidden questions are skipped by the publish rules.
//
// Seeded: groups `contact` (published) and `booking` (draft) are the two keys the section fixtures name; INVENTED: everything else.
import { MAX_FAQ_ITEMS, MAX_FAQ_NAME, MAX_QUESTION, FAQ_KEY_PATTERN, charCount, docHasText } from "@/lib/faq";
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
  type MockDb,
  type MockFaqGroup,
  type MockFaqItem,
  type MockFaqSnapshot,
  type Params,
} from "@/mocks/mock-core";
import { blank, entityReferenced, findReferences, isObject, issue, makeEngine, TRASH_DAYS } from "@/mocks/mock-faq-album-engine";
import type { ApiFieldError } from "@/types/api";
import type { FaqGroupListItem, FaqItem } from "@/types/faq";
import type { UserRef } from "@/types/media";
import type { PublishIssue } from "@/types/publishing";

const SEED_AT = micros(Date.UTC(2026, 9, 26, 9, 0, 0), 185);
const SOMCHAI: UserRef = { id: 4, name: "Somchai Vongsa" };
const groupPublicId = (id: number) => `0192d3a4-7c1e-7b52-9d0a-3f5e2a1d7a${String(id).padStart(2, "0")}`;
const itemPublicId = (id: number) => `0192d3a4-7c1e-7b52-9d0a-3f5e2a1d8b${String(id).padStart(2, "0")}`;
const STATUSES = ["draft", "in_review", "scheduled", "published", "archived"];
const SORTS = ["key", "name", "updated_at", "status"];

const doc = (...paragraphs: string[]) => ({ type: "doc", content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) });
const emptyDoc = () => ({ type: "doc", content: [] });

// ---------------------------------------------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------------------------------------------
type Q = { id: number; la?: [string, Record<string, unknown>]; en?: [string, Record<string, unknown>]; hidden?: boolean };
function items(list: Q[]): MockFaqItem[] {
  return list.map((q, index) => ({
    id: q.id,
    public_id: itemPublicId(q.id),
    sort_order: index,
    is_visible: !q.hidden,
    translations: [
      ...(q.la ? [{ locale_code: "la", question: q.la[0], answer: q.la[1] }] : []),
      ...(q.en ? [{ locale_code: "en", question: q.en[0], answer: q.en[1] }] : []),
    ],
  }));
}
function group(id: number, key: string, name: string, status: MockFaqGroup["status"], list: Q[], rest: Partial<MockFaqGroup> = {}): MockFaqGroup {
  return {
    id,
    public_id: groupPublicId(id),
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
    live: { group: { name }, items: items(list) },
    ...rest,
  };
}

export function seedFaqGroups(): MockFaqGroup[] {
  const contact = group(1, "contact", "Contact questions", "published", [
    { id: 1, la: ["How do I book a trip?", doc("Send us a message with the dates you have in mind.")], en: ["How do I book a trip?", doc("Send us a message with the dates you have in mind.")] },
    { id: 2, la: ["Do you offer trips for beginners?", doc("Yes. Every season has an easy route with a guide.")], en: ["Do you offer trips for beginners?", doc("Yes. Every season has an easy route with a guide.")] },
    { id: 3, la: ["Can I bring my own gear?", doc("You can; we also lend tents and packs.")], hidden: true },
    { id: 4, la: ["What if the weather turns?", doc("We move the date or refund the trip.")], en: ["What if the weather turns?", doc("We move the date or refund the trip.")] },
  ]);
  // INVENTED. 2: a draft that cannot be published - the second question has no answer in the default language - and no English at all.
  const booking = group(2, "booking", "Booking", "draft", [
    { id: 5, la: ["How early should I book?", doc("Four weeks before the date is best.")] },
    { id: 6, la: ["Can I change the date?", emptyDoc()] },
  ]);
  // 3: published with a pending draft (a new name and a third question): see `seedFaqRevisions`.
  const trips = group(3, "trips", "Trips", "published", [
    { id: 7, la: ["How long is a trip?", doc("From one day to a week.")], en: ["How long is a trip?", doc("From one day to a week.")] },
    { id: 8, la: ["Is food included?", doc("Meals on the trail are.")] },
  ], { created_by: SOMCHAI, updated_by: SOMCHAI });
  // 4: in the trash.
  const old = group(4, "old-faq", "Old questions", "archived", [{ id: 10, la: ["Old question?", doc("Old answer.")] }], {
    deleted_at: micros(Date.UTC(2026, 9, 20, 9, 0, 0), 195),
    unpublished_at: micros(Date.UTC(2026, 9, 20, 9, 0, 0), 195),
    first_published_at: SEED_AT,
    created_by: SOMCHAI,
    updated_by: SOMCHAI,
  });
  return [contact, booking, trips, old];
}

export function seedFaqRevisions(db: MockDb) {
  const who = (id: number, name: string): UserRef => ({ id, name });
  const base = Date.UTC(2026, 9, 27, 3, 0, 0);
  for (const g of db.faqGroups.filter((x) => x.status === "published")) {
    pushRevision(db, "faq-groups", g.id, "cms.faq_groups", "published", structuredClone(g.live), null, g.published_at ?? SEED_AT, g.created_by ?? who(4, "Somchai Vongsa"));
  }
  const contact = db.faqGroups[0];
  const older = structuredClone(contact.live);
  older.items = older.items.slice(0, 2);
  pushRevision(db, "faq-groups", 1, "cms.faq_groups", "history", older, "autosave", micros(base - 3 * 86_400_000), who(4, "Somchai Vongsa"));
  const trips = db.faqGroups.find((x) => x.id === 3)!;
  const draft = structuredClone(trips.live);
  draft.group.name = "Trips and tours";
  draft.items.push(...items([{ id: 9, la: ["Can children come?", doc("From the age of eight.")], en: ["Can children come?", doc("From the age of eight.")] }]).map((i) => ({ ...i, sort_order: 2 })));
  pushRevision(db, "faq-groups", 3, "cms.faq_groups", "draft", draft, null, micros(base + 3_600_000), who(6, "Noy Keomany"));
  trips.lock_version = 2;
  trips.updated_at = micros(base + 3_600_000, 417);
  trips.updated_by = who(6, "Noy Keomany");
}

// ---------------------------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------------------------
const engine = makeEngine<MockFaqGroup, FaqGroupListItem>({
  kind: "faq-groups",
  entityType: "cms.faq_groups",
  permission: "cms.faq",
  path: "/faq-groups/{id}",
  roots: (db) => db.faqGroups,
  view: (db, root) => faqGroupView(db, root),
  validate: (db, root) => validateFaqForPublish(db, root),
  references: (db, root) => findReferences(db, "group_key", root.key),
  referencedWarning: "faq_group_referenced",
  snapshotRefs: () => [],
  childrenOf: (snap) => (snap as MockFaqSnapshot).items,
});

export const faqEngine = engine;
const working = (db: MockDb, root: MockFaqGroup) => engine.working(db, root) as MockFaqSnapshot;
export const faqWorking = working;
export const faqIsTrashed = (root: MockFaqGroup) => root.deleted_at !== null;
const sortedItems = (snap: MockFaqSnapshot) => snap.items.slice().sort((x, y) => x.sort_order - y.sort_order);
const orderOf = (snap: MockFaqSnapshot) => sortedItems(snap).map((i) => ({ id: i.id, sort_order: i.sort_order }));
const renumber = (snap: MockFaqSnapshot) => {
  snap.items = sortedItems(snap);
  snap.items.forEach((i, n) => (i.sort_order = n));
};

export function faqGroupView(db: MockDb, root: MockFaqGroup): FaqGroupListItem {
  const snap = working(db, root);
  const draft = engine.hasDraft(db, root) ? engine.draftRow(db, root) : undefined;
  const trashed = faqIsTrashed(root);
  return {
    id: root.id,
    public_id: root.public_id,
    key: root.key,
    name: snap.group.name,
    item_count: snap.items.length,
    visible_item_count: snap.items.filter((i) => i.is_visible).length,
    usage_count: findReferences(db, "group_key", root.key).filter((r) => r.kind === "section_props").length,
    draft: draft ? { revision_id: draft.id, version: draft.version, created_at: draft.created_at, created_by: draft.created_by } : null,
    status: root.status,
    lock_version: root.lock_version,
    has_unpublished_changes: engine.hasDraft(db, root),
    published_at: root.published_at,
    first_published_at: root.first_published_at,
    scheduled_at: null,
    unpublished_at: root.unpublished_at,
    created_by: root.created_by,
    updated_by: root.updated_by,
    created_at: root.created_at,
    updated_at: root.updated_at,
    deleted_at: root.deleted_at,
    purge_at: trashed ? micros(Date.parse(root.deleted_at!) + TRASH_DAYS * 86_400_000, 0) : null,
  };
}

export function faqItemView(it: MockFaqItem): FaqItem {
  return {
    id: it.id,
    public_id: it.public_id,
    sort_order: it.sort_order,
    is_visible: it.is_visible,
    translations: Object.fromEntries(it.translations.map((t) => [t.locale_code, { question: t.question, answer: structuredClone(t.answer) }])),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------------
export function listFaqGroups(db: MockDb, params: Params) {
  rejectUnknown(params, ["page", "limit", "keyword", "status", "has_unpublished_changes", "trashed", "sort"]);
  const errors: ApiFieldError[] = [];
  const trashed = boolParam(params, "trashed") ?? false;
  const pending = boolParam(params, "has_unpublished_changes");
  const keyword = params.get("keyword")?.trim().toLowerCase();
  if (keyword && charCount(keyword) > 100) errors.push({ in: "query", path: "/keyword", code: "too_long", params: { max: 100 } });
  const statuses = params.get("status")?.split(",").filter(Boolean);
  if (statuses && (statuses.length > 5 || statuses.some((s) => !STATUSES.includes(s)))) errors.push({ in: "query", path: "/status", code: "not_in_enum", params: { expected: STATUSES } });
  const sort = params.get("sort") ?? "key";
  const m = /^(-?)([a-z_]+)$/.exec(sort);
  if (!m || !SORTS.includes(m[2])) errors.push({ in: "query", path: "/sort", code: "not_in_enum", params: { expected: SORTS } });
  if (errors.length) throw validationFailed(errors);
  if (trashed && engine.translator(db)) throw engine.deny("delete", "GET", "/faq-groups?trashed=true");

  let rows = db.faqGroups.filter((r) => faqIsTrashed(r) === trashed);
  if (keyword) rows = rows.filter((r) => r.key.includes(keyword) || working(db, r).group.name.toLowerCase().includes(keyword));
  if (statuses?.length) rows = rows.filter((r) => statuses.includes(r.status));
  if (pending !== undefined) rows = rows.filter((r) => engine.hasDraft(db, r) === pending);
  const views = rows.map((r) => faqGroupView(db, r));
  const dir = m![1] ? -1 : 1;
  const field = m![2];
  views.sort((x, y) => {
    const xv = field === "name" ? x.name.toLowerCase() : String((x as unknown as Record<string, unknown>)[field] ?? "");
    const yv = field === "name" ? y.name.toLowerCase() : String((y as unknown as Record<string, unknown>)[field] ?? "");
    return xv.localeCompare(yv) * dir || x.id - y.id;
  });
  return paginate(views, params);
}

export function getFaqGroup(db: MockDb, id: string) {
  const root = engine.find(db, id);
  return { data: faqGroupView(db, root), etag: engine.etagOfRoot(root) };
}

export function listFaqItems(db: MockDb, id: string) {
  const root = engine.find(db, id);
  return { data: sortedItems(working(db, root)).map(faqItemView), etag: engine.etagOfRoot(root) };
}

// ---------------------------------------------------------------------------------------------------------------
// Body checks
// ---------------------------------------------------------------------------------------------------------------
const LITE_NODES = ["paragraph", "bulletList", "orderedList", "listItem", "hardBreak", "text"];
const LITE_MARKS = ["bold", "italic", "link"];
const MAX_NODES = 50;

// `ValidateRichTextLite` (04 3.7): a `doc` of paragraphs and lists with bold / italic / link marks, at most 50 nodes.
function checkAnswer(value: unknown, path: string, errors: ApiFieldError[]) {
  if (!isObject(value) || value.type !== "doc") {
    errors.push({ in: "body", path, code: "invalid_type" });
    return;
  }
  let count = 0;
  const walk = (node: unknown, p: string) => {
    if (!isObject(node)) {
      errors.push({ in: "body", path: p, code: "invalid_type" });
      return;
    }
    count += 1;
    if (typeof node.type !== "string" || !LITE_NODES.includes(node.type)) errors.push({ in: "body", path: `${p}/type`, code: "not_in_enum", params: { expected: LITE_NODES } });
    if (Array.isArray(node.marks)) {
      node.marks.forEach((mark, i) => {
        if (!isObject(mark) || typeof mark.type !== "string" || !LITE_MARKS.includes(mark.type)) errors.push({ in: "body", path: `${p}/marks/${i}/type`, code: "not_in_enum", params: { expected: LITE_MARKS } });
      });
    }
    if (Array.isArray(node.content)) node.content.forEach((child, i) => walk(child, `${p}/content/${i}`));
  };
  if (value.content !== undefined && !Array.isArray(value.content)) errors.push({ in: "body", path: `${path}/content`, code: "invalid_type" });
  else (value.content as unknown[] | undefined)?.forEach((child, i) => walk(child, `${path}/content/${i}`));
  if (count > MAX_NODES) errors.push({ in: "body", path, code: "limit_exceeded", params: { max: MAX_NODES } });
}

const knownLocale = (code: string) => (MOCK_LOCALE_CODES as readonly string[]).includes(code);

// One language row: BOTH texts are columns NOT NULL, so a row that is new needs both; an existing row may be patched by one.
function checkRow(code: string, t: unknown, errors: ApiFieldError[], mode: "create" | "patch", exists: boolean) {
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
  for (const k of Object.keys(t)) if (k !== "question" && k !== "answer") errors.push({ in: "body", path: `${base}/${k}`, code: "unknown_field" });
  const needAll = mode === "create" || !exists;
  if ("question" in t) {
    if (typeof t.question !== "string") errors.push({ in: "body", path: `${base}/question`, code: "invalid_type" });
    else if (t.question.trim() === "") errors.push({ in: "body", path: `${base}/question`, code: "required" });
    else if (charCount(t.question) > MAX_QUESTION) errors.push({ in: "body", path: `${base}/question`, code: "too_long", params: { max: MAX_QUESTION } });
  } else if (needAll) errors.push({ in: "body", path: `${base}/question`, code: "required" });
  if ("answer" in t) checkAnswer(t.answer, `${base}/answer`, errors);
  else if (needAll) errors.push({ in: "body", path: `${base}/answer`, code: "required" });
}

// ---------------------------------------------------------------------------------------------------------------
// Groups: create / PATCH
// ---------------------------------------------------------------------------------------------------------------
function checkName(value: unknown, errors: ApiFieldError[]) {
  if (typeof value !== "string") errors.push({ in: "body", path: "/name", code: value === undefined ? "required" : "invalid_type" });
  else if (value.trim() === "") errors.push({ in: "body", path: "/name", code: "required" });
  else if (charCount(value) > MAX_FAQ_NAME) errors.push({ in: "body", path: "/name", code: "too_long", params: { max: MAX_FAQ_NAME } });
}

export function createFaqGroup(db: MockDb, body: unknown) {
  if (engine.translator(db)) throw engine.deny("create", "POST", "/faq-groups");
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(body)) if (k !== "key" && k !== "name") errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  if (typeof body.key !== "string") errors.push({ in: "body", path: "/key", code: body.key === undefined ? "required" : "invalid_type" });
  else if (!FAQ_KEY_PATTERN.test(body.key)) errors.push({ in: "body", path: "/key", code: "pattern_mismatch" });
  checkName(body.name, errors);
  if (errors.length) throw validationFailed(errors);
  if (db.faqGroups.some((r) => !r.deleted_at && r.key === body.key)) throw duplicate([{ in: "body", path: "/key", code: "duplicate" }]);
  const id = db.nextFaqGroupId++;
  const stamp = tick(db);
  const root: MockFaqGroup = {
    id,
    public_id: groupPublicId(id),
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
    live: { group: { name: (body.name as string).trim() }, items: [] },
  };
  db.faqGroups.push(root);
  return { data: engine.writeResult(db, root), etag: engine.etagOfRoot(root) };
}

export function patchFaqGroup(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
  const root = engine.find(db, id);
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(body)) {
    if (k === "key") errors.push({ in: "body", path: "/key", code: "immutable" });
    else if (k !== "name") errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  }
  if (Object.keys(body).length === 0) errors.push({ in: "body", path: "", code: "min_properties" });
  if ("name" in body) checkName(body.name, errors);
  if (errors.length) throw validationFailed(errors);
  const current = working(db, root);
  // The name is not translatable: a translate-only writer sending a different one is refused (05 13.5.2).
  if (engine.translator(db) && body.name !== current.group.name) throw engine.deny("update", "PATCH", "/faq-groups/{id} (name)");
  engine.requireMatch(ifMatch, root);
  engine.trashedCheck(root);
  const name = (body.name as string).trim();
  if (name === current.group.name) return { data: engine.writeResult(db, root), etag: engine.etagOfRoot(root) };
  const { snapshot, stamp } = engine.beginWrite(db, root);
  (snapshot as MockFaqSnapshot).group.name = name;
  engine.commitWrite(root, stamp);
  return { data: engine.writeResult(db, root), etag: engine.etagOfRoot(root) };
}

// ---------------------------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------------------------
const sortRows = (rows: MockFaqItem["translations"]) => rows.sort((x, y) => MOCK_LOCALE_CODES.indexOf(x.locale_code as never) - MOCK_LOCALE_CODES.indexOf(y.locale_code as never));

export function createFaqItem(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
  const root = engine.find(db, id);
  if (engine.translator(db)) throw engine.deny("create", "POST", "/faq-groups/{id}/items");
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(body)) if (!["translations", "is_visible", "position"].includes(k)) errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  const current = working(db, root);
  if (!isObject(body.translations)) errors.push({ in: "body", path: "/translations", code: body.translations === undefined ? "required" : "invalid_type" });
  else {
    for (const [code, t] of Object.entries(body.translations)) checkRow(code, t, errors, "create", false);
    if (!isObject(body.translations[DEFAULT_LOCALE_CODE])) {
      errors.push({ in: "body", path: `/translations/${DEFAULT_LOCALE_CODE}/question`, code: "required" });
      errors.push({ in: "body", path: `/translations/${DEFAULT_LOCALE_CODE}/answer`, code: "required" });
    }
  }
  if (body.is_visible !== undefined && typeof body.is_visible !== "boolean") errors.push({ in: "body", path: "/is_visible", code: "invalid_type" });
  let position = current.items.length;
  if (body.position !== undefined) {
    if (typeof body.position !== "number" || !Number.isInteger(body.position) || body.position < 0) errors.push({ in: "body", path: "/position", code: "invalid_type" });
    else if (body.position > current.items.length) errors.push({ in: "body", path: "/position", code: "out_of_range", params: { max: current.items.length } });
    else position = body.position;
  }
  if (errors.length === 0 && current.items.length >= MAX_FAQ_ITEMS) errors.push({ in: "body", path: "/translations", code: "limit_exceeded", params: { max: MAX_FAQ_ITEMS } });
  if (errors.length) throw validationFailed(errors);
  engine.requireMatch(ifMatch, root);
  engine.trashedCheck(root);

  const { snapshot, stamp } = engine.beginWrite(db, root);
  const snap = snapshot as MockFaqSnapshot;
  const newId = db.nextFaqItemId++;
  const created: MockFaqItem = {
    id: newId,
    public_id: itemPublicId(newId),
    sort_order: 0,
    is_visible: body.is_visible !== false,
    translations: sortRows(Object.entries(body.translations as Record<string, { question: string; answer: Record<string, unknown> }>).map(([locale_code, t]) => ({ locale_code, question: t.question.trim(), answer: structuredClone(t.answer) }))),
  };
  const ordered = sortedItems(snap);
  ordered.splice(position, 0, created);
  snap.items = ordered;
  renumber(snap);
  engine.commitWrite(root, stamp);
  return { data: { item: faqItemView(created), order: orderOf(snap), aggregate: engine.stampOf(db, root), warnings: [] }, etag: engine.etagOfRoot(root) };
}

function findItem(snap: MockFaqSnapshot, itemId: string): MockFaqItem {
  const it = snap.items.find((i) => String(i.id) === itemId);
  if (!it) throw notFound();
  return it;
}

export function patchFaqItem(db: MockDb, id: string, itemId: string, body: unknown, ifMatch: string | null) {
  const root = engine.find(db, id);
  const old = findItem(working(db, root), itemId);
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(body)) if (k !== "is_visible" && k !== "translations") errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  if (Object.keys(body).length === 0) errors.push({ in: "body", path: "", code: "min_properties" });
  if (body.is_visible !== undefined && typeof body.is_visible !== "boolean") errors.push({ in: "body", path: "/is_visible", code: "invalid_type" });
  if (body.translations !== undefined) {
    if (!isObject(body.translations)) errors.push({ in: "body", path: "/translations", code: "invalid_type" });
    else {
      for (const [code, t] of Object.entries(body.translations)) {
        checkRow(code, t, errors, "patch", old.translations.some((x) => x.locale_code === code));
        // The default language row can not be removed.
        if (t === null && code === DEFAULT_LOCALE_CODE) errors.push({ in: "body", path: `/translations/${code}`, code: "required" });
      }
    }
  }
  if (errors.length) throw validationFailed(errors);
  if (engine.translator(db)) {
    // 05 13.5.2: the texts of every language are `translate`; hiding and removing a language row are `update`.
    if (body.is_visible !== undefined && body.is_visible !== old.is_visible) throw engine.deny("update", "PATCH", "/faq-groups/{id}/items/{itemId} (is_visible)");
    if (Object.values((body.translations ?? {}) as Record<string, unknown>).some((t) => t === null)) throw engine.deny("update", "PATCH", "/faq-groups/{id}/items/{itemId} (translations)");
  }
  engine.requireMatch(ifMatch, root);
  engine.trashedCheck(root);

  const next: MockFaqItem = structuredClone(old);
  if (body.is_visible !== undefined) next.is_visible = body.is_visible as boolean;
  for (const [code, t] of Object.entries((body.translations ?? {}) as Record<string, { question?: string; answer?: Record<string, unknown> } | null>)) {
    const at = next.translations.findIndex((x) => x.locale_code === code);
    if (t === null) {
      if (at >= 0) next.translations.splice(at, 1);
      continue;
    }
    const row = at >= 0 ? next.translations[at] : { locale_code: code, question: "", answer: emptyDoc() };
    if (t.question !== undefined) row.question = t.question.trim();
    if (t.answer !== undefined) row.answer = structuredClone(t.answer);
    if (at < 0) next.translations.push(row);
  }
  sortRows(next.translations);
  if (JSON.stringify(next) === JSON.stringify(old)) return { data: { item: faqItemView(old), order: orderOf(working(db, root)), aggregate: engine.stampOf(db, root), warnings: [] }, etag: engine.etagOfRoot(root) };

  const { snapshot, stamp } = engine.beginWrite(db, root);
  const snap = snapshot as MockFaqSnapshot;
  snap.items[snap.items.findIndex((i) => i.id === old.id)] = next;
  engine.commitWrite(root, stamp);
  return { data: { item: faqItemView(next), order: orderOf(snap), aggregate: engine.stampOf(db, root), warnings: [] }, etag: engine.etagOfRoot(root) };
}

export function deleteFaqItem(db: MockDb, id: string, itemId: string, ifMatch: string | null) {
  const root = engine.find(db, id);
  const old = findItem(working(db, root), itemId);
  if (engine.translator(db)) throw engine.deny("delete", "DELETE", "/faq-groups/{id}/items/{itemId}");
  engine.requireMatch(ifMatch, root);
  engine.trashedCheck(root);
  const { snapshot, stamp } = engine.beginWrite(db, root);
  const snap = snapshot as MockFaqSnapshot;
  snap.items = snap.items.filter((i) => i.id !== old.id);
  renumber(snap);
  engine.commitWrite(root, stamp);
  return { data: { order: orderOf(snap), aggregate: engine.stampOf(db, root), warnings: [] }, etag: engine.etagOfRoot(root) };
}

export function reorderFaqItems(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
  const root = engine.find(db, id);
  if (engine.translator(db)) throw engine.deny("update", "PUT", "/faq-groups/{id}/items/order");
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
      if (!isObject(entry) || typeof entry.id !== "number") {
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
  if (ids.every((v, i) => sortedItems(current)[i].id === v)) return { data: { order: orderOf(current), aggregate: engine.stampOf(db, root) }, etag: engine.etagOfRoot(root) };
  const { snapshot, stamp } = engine.beginWrite(db, root);
  const snap = snapshot as MockFaqSnapshot;
  snap.items.forEach((it) => (it.sort_order = ids.indexOf(it.id)));
  renumber(snap);
  engine.commitWrite(root, stamp);
  return { data: { order: orderOf(snap), aggregate: engine.stampOf(db, root) }, etag: engine.etagOfRoot(root) };
}

// ---------------------------------------------------------------------------------------------------------------
// Publish rules (05 13.5.5): a hidden question skips every rule.
// ---------------------------------------------------------------------------------------------------------------
export function validateFaqForPublish(db: MockDb, root: MockFaqGroup): { blockers: PublishIssue[]; warnings: PublishIssue[] } {
  const snap = working(db, root);
  const blockers: PublishIssue[] = [];
  const warnings: PublishIssue[] = [];
  const def = DEFAULT_LOCALE_CODE;
  const visible = sortedItems(snap).filter((i) => i.is_visible);
  visible.forEach((it, index) => {
    const row = it.translations.find((t) => t.locale_code === def);
    const base = `/items/${it.public_id}/translations/${def}`;
    if (blank(row?.question)) blockers.push(issue(`${base}/question`, "empty_default_locale", { locale: def, item_id: it.id, item_index: index }));
    if (!docHasText(row?.answer)) blockers.push(issue(`${base}/answer`, "empty_default_locale", { locale: def, item_id: it.id, item_index: index }));
  });
  if (visible.length === 0) warnings.push(issue("/items", "faq_group_empty", {}, false));
  for (const code of MOCK_ACTIVE_LOCALE_CODES) {
    if (code === def) continue;
    const missing = visible.filter((it) => {
      const row = it.translations.find((t) => t.locale_code === code);
      return blank(row?.question) || !docHasText(row?.answer);
    }).length;
    if (missing > 0) warnings.push(issue("/items", "translation_incomplete", { locale: code, missing }, false));
  }
  return { blockers, warnings };
}

export const deleteFaqGroup = engine.remove;
export const restoreFaqGroup = engine.restoreFromTrash;
export const publishFaqGroup = engine.publish;
export const unpublishFaqGroup = engine.unpublish;
export const discardFaqGroupDraft = engine.discardDraft;
export const listFaqRevisions = engine.listRevisions;
export const getFaqRevision = engine.getRevision;
export const restoreFaqRevision = engine.restoreRevision;
export const touchFaqGroupAsSomeoneElse = engine.touchAsSomeoneElse;

export const faqSummary = (db: MockDb) =>
  db.faqGroups.map((g) => ({ id: g.id, key: g.key, status: g.status, lock_version: g.lock_version, deleted_at: g.deleted_at, items: working(db, g).items.length }));

// A test / click-through helper: a `faq` section of a page names the group by `group_key` (the delete is then refused).
export function referenceFaqGroupFromPage(db: MockDb, pageId: number, key: string): void {
  const page = db.pages.find((p) => p.id === pageId);
  const section = page?.live.sections.find((s) => s.section_type === "faq");
  if (!section) throw notFound();
  (section.props as Record<string, unknown>).group_key = key;
}
export { entityReferenced };
