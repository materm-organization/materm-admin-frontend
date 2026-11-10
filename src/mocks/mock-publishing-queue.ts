// SCR-39: `GET /publishing/queue` (doc/05 12.12, backend `modules/publishing`). The three tabs are COMPUTED from the same mock db the D1 engines
// write (pages, posts, albums, FAQ groups, forms, collection entries, shared sections and `db.schedules`), never typed in, so a mock
// submit-review / schedule / fire / reject shows up in the next answer. The rules follow the server's README:
//   awaiting_review      pages and posts with `status = in_review`, oldest first;
//   scheduled            pages, posts, albums and entries that are `scheduled`, plus PUBLISHED roots with a live `apply_revision` booking; by run time
//                        (no time last); a row past its time (overdue) is always listed, the others only inside `to` (default and maximum now + 30 days);
//   unpublished_changes  published roots with a `draft` revision (all seven kinds), newest edit first.
// A kind the caller can not read is left out of rows and counts (the filter naming it matches nothing). The mock cannot know the caller, so
// `setQueueReadableKinds(db, kinds)` stands in for the permission set (null = every kind). `can{}` follows `db.workflowRole` (the D1 role).
import { albumEngine, albumTitle } from "@/mocks/mock-albums";
import { entryEngine, entryView } from "@/mocks/mock-collections";
import { keyOf, micros, rejectUnknown, validationFailed, type MockDb, type MockFaqGroup, type MockPostRoot } from "@/mocks/mock-core";
import { faqEngine } from "@/mocks/mock-faq";
import { formDraftRow, formWorking, formsState } from "@/mocks/mock-forms";
import { pageTitle } from "@/mocks/mock-pages";
import { postTitle } from "@/mocks/mock-posts";
import { rfc3339Vientiane } from "@/mocks/mock-review-schedule";
import { WORKFLOW_ACTIONS } from "@/mocks/mock-schedule-helpers";
import { sharedHasDraft } from "@/mocks/mock-shared-core";
import type { ApiFieldError } from "@/types/api";
import type { UserRef } from "@/types/media";
import type { PublishableStatus, ScheduleInfo } from "@/types/publishing";
import type { PublishingQueue, QueueAwaitingItem, QueueCan, QueueChangesItem, QueueKind, QueueRowBase, QueueScheduledItem, QueueTab } from "@/types/publishing-queue";

const TABS: readonly QueueTab[] = ["awaiting_review", "scheduled", "unpublished_changes"];
const KINDS: readonly QueueKind[] = ["pages", "posts", "albums", "faq-groups", "forms", "collection-entries", "shared-sections"];
const REVIEW_KINDS: readonly QueueKind[] = ["pages", "posts"];
const SCHEDULE_KINDS: readonly QueueKind[] = ["pages", "posts", "albums", "collection-entries"];
const DAY = 86_400_000;
const WINDOW_MS = 30 * DAY;

type State = { readable: Set<QueueKind> | null; fail: boolean };
const states = new WeakMap<MockDb, State>();
const stateOf = (db: MockDb): State => {
  let s = states.get(db);
  if (!s) {
    s = { readable: null, fail: false };
    states.set(db, s);
  }
  return s;
};

// Which kinds the signed-in user may read (null = all). A role with `read` on one key sees nothing of the other kinds.
export function setQueueReadableKinds(db: MockDb, kinds: readonly QueueKind[] | null) {
  stateOf(db).readable = kinds ? new Set(kinds) : null;
}
export const setQueueFails = (db: MockDb, fail: boolean) => {
  stateOf(db).fail = fail;
};
export const queueFails = (db: MockDb) => stateOf(db).fail;
const mayRead = (db: MockDb, kind: QueueKind) => {
  const r = stateOf(db).readable;
  return r === null || r.has(kind);
};

type Root = { id: number; status: PublishableStatus; deleted_at?: string | null; updated_at: string; updated_by: UserRef };
type Entry = { kind: QueueKind; root: Root; title: string; collectionKey?: string; hasDraft: boolean };

const hasDraftRevision = (db: MockDb, resource: string, id: number) => (db.revisions[keyOf(resource, id)] ?? []).some((r) => r.kind === "draft");

function entries(db: MockDb): Entry[] {
  const out: Entry[] = [];
  for (const root of db.pages) out.push({ kind: "pages", root, title: pageTitle(root), hasDraft: root.status === "published" && hasDraftRevision(db, "pages", root.id) });
  for (const root of db.posts as MockPostRoot[]) out.push({ kind: "posts", root, title: postTitle(root), hasDraft: root.status === "published" && hasDraftRevision(db, "posts", root.id) });
  for (const root of db.albums) out.push({ kind: "albums", root, title: albumTitle(root), hasDraft: root.status === "published" && albumEngine.hasDraft(db, root) });
  for (const root of db.faqGroups as MockFaqGroup[]) out.push({ kind: "faq-groups", root, title: root.live.group.name || `#${root.id}`, hasDraft: root.status === "published" && faqEngine.hasDraft(db, root) });
  for (const root of formsState(db).forms) out.push({ kind: "forms", root: { ...root, deleted_at: null }, title: formWorking(db, root).form.name, hasDraft: root.status === "published" && Boolean(formDraftRow(db, root)) });
  for (const root of db.collectionEntries) {
    const collection = db.collections.find((c) => c.key === root.collection_key);
    // the entries of a trashed collection never show
    const hidden = !collection || collection.deleted_at !== null;
    out.push({
      kind: "collection-entries",
      root: hidden ? { ...root, deleted_at: root.deleted_at ?? collection?.deleted_at ?? "hidden" } : root,
      title: (entryView(db, root, false) as { title?: string }).title ?? `#${root.id}`,
      collectionKey: root.collection_key,
      hasDraft: root.status === "published" && entryEngine.hasDraft(db, root),
    });
  }
  for (const root of db.sharedSections) out.push({ kind: "shared-sections", root, title: root.live.name, hasDraft: sharedHasDraft(db, root) });
  return out;
}

function canOf(db: MockDb, kind: QueueKind): QueueCan {
  const actions = WORKFLOW_ACTIONS[db.workflowRole];
  const has = (a: string) => actions.includes(a);
  return {
    read: true,
    update: has("update"),
    review: REVIEW_KINDS.includes(kind) && has("review"),
    publish: has("publish"),
    // BR-11: scheduling needs `schedule` AND `publish`
    schedule: SCHEDULE_KINDS.includes(kind) && has("schedule") && has("publish"),
  };
}

function base(db: MockDb, e: Entry): QueueRowBase {
  return {
    entity_type: e.kind,
    id: e.root.id,
    ...(e.collectionKey ? { collection_key: e.collectionKey } : {}),
    title: e.title,
    status: e.root.status,
    updated_at: e.root.updated_at,
    updated_by: e.root.updated_by,
    can: canOf(db, e.kind),
  };
}

const order = (a: Entry, b: Entry) => (a.kind === b.kind ? a.root.id - b.root.id : KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));

function scheduleOf(db: MockDb, e: Entry): { info: ScheduleInfo; runAt: number } | null {
  const row = db.schedules[keyOf(e.kind, e.root.id)];
  if (!row) return null;
  return { info: { action: row.action, run_at: micros(row.run_at, 0), status: row.status, attempts: row.attempts, last_error: row.last_error }, runAt: row.run_at };
}

type Parsed = { tabs: QueueTab[]; kinds: QueueKind[]; page: number; limit: number; to: number };

function parse(params: URLSearchParams, now: number): Parsed {
  rejectUnknown(params, ["tab", "kind", "page", "limit", "to"]);
  const errors: ApiFieldError[] = [];
  let tabs: QueueTab[] = [...TABS];
  const tab = params.get("tab");
  if (tab) {
    if ((TABS as readonly string[]).includes(tab)) tabs = [tab as QueueTab];
    else errors.push({ in: "query", path: "/tab", code: "not_in_enum", params: { expected: [...TABS] } });
  }
  let kinds: QueueKind[] = [];
  const kind = params.get("kind");
  if (kind) {
    const names = kind.split(",").map((k) => k.trim());
    if (names.every((k) => (KINDS as readonly string[]).includes(k))) kinds = names as QueueKind[];
    else errors.push({ in: "query", path: "/kind", code: "invalid_format" });
  }
  const intParam = (name: string, min: number, max: number, fallback: number) => {
    const raw = params.get(name);
    if (raw === null) return fallback;
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || n < min || n > max) {
      errors.push({ in: "query", path: `/${name}`, code: n > max ? "too_large" : "invalid_format" });
      return fallback;
    }
    return n;
  };
  const page = intParam("page", 1, 1_000_000, 1);
  const limit = intParam("limit", 1, 100, 50);
  let to = now + WINDOW_MS;
  const rawTo = params.get("to");
  if (rawTo) {
    const t = Date.parse(rawTo);
    if (Number.isNaN(t)) errors.push({ in: "query", path: "/to", code: "invalid_format" });
    else if (t > now + WINDOW_MS + 60_000) errors.push({ in: "query", path: "/to", code: "out_of_range", params: { max: rfc3339Vientiane(now + WINDOW_MS) } });
    else to = t;
  }
  if (errors.length) throw validationFailed(errors);
  return { tabs, kinds, page, limit, to };
}

// ---- the three tabs ---------------------------------------------------------------------------------------------------------------
type Tabbed = { awaiting: Entry[]; scheduled: Array<{ e: Entry; sched: ReturnType<typeof scheduleOf>; runAt: number | null }>; changes: Entry[] };

function compute(db: MockDb, kinds: readonly QueueKind[], to: number, now: number): Tabbed {
  const wanted = (k: QueueKind) => mayRead(db, k) && (kinds.length === 0 || kinds.includes(k));
  const live = entries(db).filter((e) => wanted(e.kind) && !e.root.deleted_at);
  const awaiting = live.filter((e) => REVIEW_KINDS.includes(e.kind) && e.root.status === "in_review").sort((a, b) => a.root.updated_at.localeCompare(b.root.updated_at) || order(a, b));
  const scheduled = live
    .filter((e) => SCHEDULE_KINDS.includes(e.kind))
    .map((e) => ({ e, sched: scheduleOf(db, e) }))
    .filter(({ e, sched }) => e.root.status === "scheduled" || (e.root.status === "published" && sched?.info.action === "apply_revision"))
    .map(({ e, sched }) => ({ e, sched, runAt: sched?.runAt ?? null }))
    // overdue rows are always listed; the rest only inside the window
    .filter(({ runAt, sched }) => runAt === null || runAt <= to || runAt < now || sched?.info.status === "failed")
    .sort((a, b) => (a.runAt ?? Infinity) - (b.runAt ?? Infinity) || order(a.e, b.e));
  const changes = live.filter((e) => e.hasDraft).sort((a, b) => b.root.updated_at.localeCompare(a.root.updated_at) || order(a, b));
  return { awaiting, scheduled, changes };
}

const slice = <T>(rows: T[], page: number, limit: number) => rows.slice((page - 1) * limit, page * limit);

export function publishingQueue(db: MockDb, params: URLSearchParams): PublishingQueue {
  const now = Date.now();
  const q = parse(params, now);
  const t = compute(db, q.kinds, q.to, now);
  const out: PublishingQueue = {};
  if (q.tabs.includes("awaiting_review")) {
    const items: QueueAwaitingItem[] = slice(t.awaiting, q.page, q.limit).map((e) => ({ ...base(db, e), submitted_at: e.root.updated_at, submitted_by: e.root.updated_by }));
    out.awaiting_review = { count: t.awaiting.length, items };
  }
  if (q.tabs.includes("scheduled")) {
    const items: QueueScheduledItem[] = slice(t.scheduled, q.page, q.limit).map(({ e, sched, runAt }) => ({
      ...base(db, e),
      run_at: sched?.info.run_at ?? null,
      // a failed booking has given up after its retries, so its time is past
      overdue: (runAt !== null && runAt < now) || sched?.info.status === "failed",
      schedule: sched?.info ?? null,
    }));
    out.scheduled = { count: t.scheduled.length, items };
  }
  if (q.tabs.includes("unpublished_changes")) {
    const items: QueueChangesItem[] = slice(t.changes, q.page, q.limit).map((e) => ({ ...base(db, e), draft_updated_at: e.root.updated_at, draft_updated_by: e.root.updated_by }));
    out.unpublished_changes = { count: t.changes.length, items };
  }
  return out;
}

// The two dashboard cards: the pages and posts waiting for a review, and the scheduled publications due within 7 days or overdue.
export function queueCounts(db: MockDb): { in_review: number; scheduled_7d: number } {
  const now = Date.now();
  const t = compute(db, [], now + WINDOW_MS, now);
  return { in_review: t.awaiting.length, scheduled_7d: t.scheduled.filter(({ runAt }) => runAt !== null && runAt <= now + 7 * DAY).length };
}
