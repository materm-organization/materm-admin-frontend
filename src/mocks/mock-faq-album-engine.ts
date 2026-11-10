// The publish engine of the albums and FAQ-group models (doc/05 section 12.7 instantiated by 13.2, 13.4.6, 13.4.7, 13.5.5), written ONCE
// and parameterised by an adapter, like the backend's generic engine: the working copy (the real rows while the thing is not
// published, a `draft` revision while it is), `If-Match` / ETag, publish (+ dry run), unpublish (`confirm_references`), discard-draft,
// delete / restore (the trash), revisions list / get / restore. What differs per kind (snapshot, blockers, who references it) is the adapter.
//
// Rights: the model has two writers only. `db.translateOnly` containing the resource makes it a translate-only writer (read + translate,
// 05 13.4.2 / 13.5.2); otherwise every action is allowed.
import { draftRowOf as pageDraftRow } from "@/mocks/mock-pages";
import { clearSchedule, makeReviewSchedule } from "@/mocks/mock-review-schedule";
import {
  DEFAULT_LOCALE_CODE,
  MOCK_USER,
  boolParam,
  duplicate,
  etagOf,
  fail,
  forbidden,
  invalidState,
  keyOf,
  lockConflict,
  notFound,
  paginate,
  preconditionRequired,
  pushRevision,
  rejectUnknown,
  tick,
  validationFailed,
  type MockAlbum,
  type MockCollectionEntry,
  type MockEntrySnapshot,
  type MockSharedSection,
  type MockSharedSnapshot,
  type MockAlbumSnapshot,
  type MockDb,
  type MockFaqGroup,
  type MockFaqSnapshot,
  type MockPageSnapshot,
  type Params,
  type StoredRevision,
} from "@/mocks/mock-core";
import type { ApiFieldError } from "@/types/api";
import type { SaveLiveWarning } from "@/types/media";
import type { AggregateStamp, PublishIssue } from "@/types/publishing";
import type { RevisionSummary } from "@/types/revisions";

export type Kind = "albums" | "faq-groups" | "collection-entries" | "shared-sections";
export type Root = MockAlbum | MockFaqGroup | MockCollectionEntry | MockSharedSection;
export type Snap = MockAlbumSnapshot | MockFaqSnapshot | MockEntrySnapshot | MockSharedSnapshot;

export const TRASH_DAYS = 30;
const MAX_ISSUES = 100;
export const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
export const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === "";
export const issue = (path: string, code: string, params: PublishIssue["params"] = {}, blocker = true): PublishIssue => (blocker ? { in: "entity", path, code, params } : { path, code, params });

// One row of `details.references[]` (05 13.4.4, `ReferenceItem` + `kind` + `in_draft`).
export type Reference = { entity_type: string; id: number; title: string | null; field: string; kind: "section_props" | "draft_props"; in_draft: boolean };

function deepFind(value: unknown, key: string, path: string, visit: (v: unknown, pointer: string) => void) {
  if (Array.isArray(value)) value.forEach((v, i) => deepFind(v, key, `${path}/${i}`, visit));
  else if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === key) visit(v, `${path}/${k}`);
      else deepFind(v, key, `${path}/${k}`, visit);
    }
  }
}

// Sections of the pages (live rows AND the draft snapshots) whose props hold `key` = `value`: `album_id`, `album_item_id`, `group_key`.
export function findReferences(db: MockDb, key: "album_id" | "album_item_id" | "group_key", value: number | string): Reference[] {
  const out: Reference[] = [];
  for (const page of db.pages) {
    if (page.deleted_at) continue;
    const titleOf = (snap: { translations: Array<{ locale_code: string; title: string }> }) => snap.translations.find((t) => t.locale_code === DEFAULT_LOCALE_CODE)?.title ?? null;
    const draft = pageDraftRow(db, page)?.snapshot as unknown as MockPageSnapshot | undefined;
    const origins = [
      { kind: "section_props" as const, sections: page.live.sections, title: titleOf(page.live) },
      ...(draft ? [{ kind: "draft_props" as const, sections: draft.sections, title: titleOf(draft) }] : []),
    ];
    for (const origin of origins) {
      for (const section of origin.sections) {
        deepFind(section.props, key, `/sections/${section.public_id}/props`, (v, pointer) => {
          if (v === value) out.push({ entity_type: "cms.page", id: page.id, title: origin.title, field: pointer, kind: origin.kind, in_draft: origin.kind === "draft_props" });
        });
      }
    }
  }
  return out;
}

export const entityReferenced = (references: Array<Reference | Record<string, unknown>>, reason?: string) =>
  fail(409, "ENTITY_REFERENCED", "The record is still used.", {
    details: { ...(reason ? { reason } : {}), total_references: references.length, truncated: references.length > 50, references: references.slice(0, 50) },
  });

export type Adapter<R extends Root, V extends object> = {
  kind: Kind;
  entityType: string; // "cms.albums"
  permission: string; // "cms.galleries"
  path: string; // "/albums/{id}"
  roots: (db: MockDb) => R[];
  view: (db: MockDb, root: R) => V;
  validate: (db: MockDb, root: R) => { blockers: PublishIssue[]; warnings: PublishIssue[] };
  // Who names this thing (a delete is refused while there is anybody; an unpublish until confirmed).
  references: (db: MockDb, root: R) => Reference[];
  referencedWarning: string;
  // References to children a snapshot would remove (a restore of such a revision is refused).
  droppedReferences?: (db: MockDb, root: R, snapshot: Snap) => Reference[];
  // `/key` or other pointers of ids the snapshot names that do not exist any more.
  snapshotRefs: (db: MockDb, snapshot: Snap) => ApiFieldError[];
  // The ids of the children a new draft reserves (a published thing's children keep their ids, 05 13.4.4): nothing to do in the mock.
  childrenOf: (snapshot: Snap) => unknown[];
  // A restore from the trash that would collide with a live row (default: the same `key`).
  restoreConflicts?: (db: MockDb, root: R) => ApiFieldError[];
  // Rights beyond "translator": the action is refused when this returns false (the collections `viewer` role).
  allowed?: (db: MockDb, action: string) => boolean;
  // Shared sections (05 18.6): `ENTITY_REFERENCED` of a delete carries this `details.reason`.
  referencedReason?: string;
  // Shared sections (SS-4): an unpublish NEVER fails because of who references it and takes no `confirm_references`; instead it answers
  // these warnings (the engine adds `draft_kept_as_history` itself).
  unpublishWarnings?: (db: MockDb, root: R) => SaveLiveWarning[];
};

export function makeEngine<R extends Root, V extends object>(a: Adapter<R, V>) {
  const translator = (db: MockDb) =>
    db.translateOnly.includes(a.kind) || (a.kind === "collection-entries" && db.collectionRole === "viewer") || (a.kind === "shared-sections" && db.sharedSectionRole === "viewer");
  const deny = (action: string, method: string, path = a.path) => forbidden(`${a.permission}:${action} ${method} ${path}`);

  const revList = (db: MockDb, root: R) => (db.revisions[keyOf(a.kind, root.id)] ??= []);
  const draftRow = (db: MockDb, root: R): StoredRevision | undefined => revList(db, root).find((r) => r.kind === "draft");
  const working = (db: MockDb, root: R): Snap => (draftRow(db, root)?.snapshot as unknown as Snap | undefined) ?? root.live;
  const hasDraft = (db: MockDb, root: R) => root.status === "published" && Boolean(draftRow(db, root));
  const isTrashed = (root: R) => root.deleted_at !== null;
  const etagOfRoot = (root: R) => etagOf(String(root.lock_version));

  const stampOf = (db: MockDb, root: R): AggregateStamp => ({
    entity_type: a.entityType,
    id: root.id,
    lock_version: root.lock_version,
    status: root.status,
    has_unpublished_changes: hasDraft(db, root),
    updated_at: root.updated_at,
  });
  const writeResult = (db: MockDb, root: R, warnings: SaveLiveWarning[] = []) => ({ ...a.view(db, root), aggregate: stampOf(db, root), warnings });

  function find(db: MockDb, id: string): R {
    const root = a.roots(db).find((r) => String(r.id) === id);
    if (!root) throw notFound();
    return root;
  }
  function requireMatch(ifMatch: string | null, root: R) {
    if (!ifMatch) throw preconditionRequired();
    if (ifMatch !== etagOfRoot(root)) throw lockConflict();
  }
  function touch(db: MockDb, root: R): string {
    const stamp = tick(db);
    root.lock_version += 1;
    root.updated_at = stamp;
    root.updated_by = MOCK_USER;
    return stamp;
  }
  function checkpoint(db: MockDb, root: R, stamp: string) {
    const latest = revList(db, root)
      .filter((r) => r.kind === "history" && !r.is_preview)
      .reduce<number>((max, r) => Math.max(max, Date.parse(r.created_at)), 0);
    if (Date.parse(stamp) - latest < 10 * 60_000) return;
    pushRevision(db, a.kind, root.id, a.entityType, "history", structuredClone(working(db, root)) as unknown as Record<string, unknown>, "autosave", stamp, MOCK_USER);
  }
  // A write goes to the real rows of a thing that is not published, to the draft snapshot of one that is.
  function beginWrite(db: MockDb, root: R): { snapshot: Snap; stamp: string } {
    const stamp = tick(db);
    checkpoint(db, root, stamp);
    if (root.status === "published" && !draftRow(db, root)) {
      pushRevision(db, a.kind, root.id, a.entityType, "draft", structuredClone(root.live) as unknown as Record<string, unknown>, null, stamp, MOCK_USER);
    }
    return { snapshot: working(db, root), stamp };
  }
  function commitWrite(root: R, stamp: string) {
    root.lock_version += 1;
    root.updated_at = stamp;
    root.updated_by = MOCK_USER;
  }
  const trashedCheck = (root: R) => {
    if (isTrashed(root)) throw invalidState("trashed");
  };

  function keepDraftAsHistory(db: MockDb, root: R, note: string): SaveLiveWarning[] {
    const draft = draftRow(db, root);
    if (!draft || root.status !== "published") return [];
    draft.kind = "history";
    draft.change_note = note;
    draft.is_preview = false;
    return [{ path: "", code: "draft_kept_as_history", params: { revision_id: draft.id, version: draft.version } }];
  }

  // ---- DELETE / restore (05 13.4.6, 13.5.3) -----------------------------------------------------------------------------------
  function remove(db: MockDb, id: string, params: Params, ifMatch: string | null) {
    rejectUnknown(params, []);
    const root = find(db, id);
    if (translator(db)) throw deny("delete", "DELETE");
    requireMatch(ifMatch, root);
    if (isTrashed(root)) return { data: null, etag: etagOfRoot(root) };
    // Always refused while anybody names it: nothing confirms it (BR-19).
    const refs = a.references(db, root);
    if (refs.length > 0) throw entityReferenced(refs, a.referencedReason);
    const warnings: SaveLiveWarning[] = [];
    const stamp = touch(db, root);
    if (root.status === "published") {
      warnings.push(...keepDraftAsHistory(db, root, "unpublish"));
      root.unpublished_at = stamp;
      root.status = "archived";
    }
    root.deleted_at = stamp;
    return { data: { aggregate: stampOf(db, root), warnings }, etag: etagOfRoot(root) };
  }

  function restoreFromTrash(db: MockDb, id: string, ifMatch: string | null) {
    const root = find(db, id);
    if (translator(db)) throw deny("delete", "POST", `${a.path}/restore`);
    requireMatch(ifMatch, root);
    if (!isTrashed(root)) throw invalidState("not_trashed");
    const conflicts = a.restoreConflicts?.(db, root) ?? (a.roots(db).some((r) => r.id !== root.id && !r.deleted_at && r.key === root.key) ? [{ in: "entity" as const, path: "/key", code: "duplicate" }] : []);
    if (conflicts.length) throw duplicate(conflicts);
    touch(db, root);
    root.deleted_at = null;
    root.status = "draft";
    return { data: writeResult(db, root), etag: etagOfRoot(root) };
  }

  // ---- publish / unpublish / discard ---------------------------------------------------------------------------------------
  function blockedError(blockers: PublishIssue[], warnings: PublishIssue[]) {
    const shown = blockers.slice(0, MAX_ISSUES);
    return fail(422, "PUBLISH_BLOCKED", `Cannot publish: ${blockers.length} item(s) must be fixed first.`, {
      errors: shown,
      details: { blocker_count: blockers.length, truncated: blockers.length > MAX_ISSUES, warning_count: warnings.length, warnings: warnings.slice(0, MAX_ISSUES) },
    });
  }

  // `system`: the scheduler worker publishing at the time (no rights check).
  function publish(db: MockDb, id: string, params: Params, body: unknown, ifMatch: string | null, system = false) {
    rejectUnknown(params, ["dry_run"]);
    const dryRun = boolParam(params, "dry_run") ?? false;
    const root = find(db, id);
    if (!system && translator(db)) throw deny("publish", "POST", `${a.path}/publish`);
    requireMatch(ifMatch, root);
    if (body !== undefined && body !== null && !isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
    const input = (body ?? {}) as Record<string, unknown>;
    const errors: ApiFieldError[] = [];
    for (const k of Object.keys(input)) if (k !== "change_note") errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
    if (input.change_note !== undefined && (typeof input.change_note !== "string" || [...input.change_note].length > 200)) errors.push({ in: "body", path: "/change_note", code: "too_long", params: { max: 200 } });
    if (errors.length) throw validationFailed(errors);
    trashedCheck(root);
    if (root.status === "published" && !hasDraft(db, root)) throw invalidState("nothing_to_publish");

    const { blockers, warnings } = a.validate(db, root);
    if (blockers.length > 0) throw blockedError(blockers, warnings);
    if (dryRun) return { data: { publishable: true as const, warnings }, etag: undefined };

    const stamp = touch(db, root);
    clearSchedule(db, a.kind, root.id);
    const note = typeof input.change_note === "string" && input.change_note ? input.change_note : null;
    const draft = hasDraft(db, root) ? draftRow(db, root) : undefined;
    const snapshot = structuredClone(working(db, root));
    (root as { live: Snap }).live = snapshot;
    let published: StoredRevision;
    if (draft) {
      draft.snapshot = structuredClone(snapshot) as unknown as Record<string, unknown>;
      draft.kind = "published";
      draft.change_note = note;
      published = draft;
    } else {
      published = pushRevision(db, a.kind, root.id, a.entityType, "published", structuredClone(snapshot) as unknown as Record<string, unknown>, note, stamp, MOCK_USER);
    }
    root.status = "published";
    // `published_at = coalesce(the old one, now)` (PT-7).
    root.published_at ??= stamp;
    root.first_published_at ??= stamp;
    root.unpublished_at = null;
    const result = { ...writeResult(db, root, warnings.map((w) => ({ path: w.path, code: w.code, params: w.params }))), published_revision: { id: published.id, version: published.version } };
    return { data: result, etag: etagOfRoot(root) };
  }

  function unpublish(db: MockDb, id: string, params: Params, ifMatch: string | null) {
    rejectUnknown(params, a.unpublishWarnings ? [] : ["confirm_references"]);
    const confirm = boolParam(params, "confirm_references") ?? false;
    const root = find(db, id);
    if (translator(db)) throw deny("unpublish", "POST", `${a.path}/unpublish`);
    requireMatch(ifMatch, root);
    trashedCheck(root);
    if (root.status !== "published" && root.status !== "scheduled") throw invalidState("not_published");
    const refs = a.unpublishWarnings ? [] : a.references(db, root);
    if (refs.length > 0 && !confirm) throw entityReferenced(refs);
    const warnings: SaveLiveWarning[] = a.unpublishWarnings ? a.unpublishWarnings(db, root) : refs.length > 0 ? [{ path: "", code: a.referencedWarning, params: { total_references: refs.length } }] : [];
    const stamp = touch(db, root);
    clearSchedule(db, a.kind, root.id);
    warnings.push(...keepDraftAsHistory(db, root, "unpublish"));
    root.status = "archived";
    root.unpublished_at = stamp;
    return { data: writeResult(db, root, warnings), etag: etagOfRoot(root) };
  }

  function discardDraft(db: MockDb, id: string, ifMatch: string | null) {
    const root = find(db, id);
    if (translator(db)) throw deny("update", "POST", `${a.path}/discard-draft`);
    requireMatch(ifMatch, root);
    trashedCheck(root);
    const draft = hasDraft(db, root) ? draftRow(db, root) : undefined;
    if (!draft) throw invalidState("no_draft");
    draft.kind = "history";
    draft.change_note = "discarded";
    draft.is_preview = false;
    touch(db, root);
    clearSchedule(db, a.kind, root.id);
    return { data: writeResult(db, root), etag: etagOfRoot(root) };
  }

  // ---- revisions (05 12.8) ---------------------------------------------------------------------------------------------------
  const KINDS = ["draft", "published", "history", "restore"];
  function liveRevisionId(db: MockDb, root: R): number | null {
    if (root.status !== "published") return null;
    const rows = revList(db, root).filter((r) => r.kind === "published");
    return rows.length ? rows.reduce((x, y) => (y.version > x.version ? y : x)).id : null;
  }

  function listRevisions(db: MockDb, id: string, params: Params) {
    rejectUnknown(params, ["page", "limit", "kind", "include_preview", "sort"]);
    const root = find(db, id);
    const errors: ApiFieldError[] = [];
    const kinds = params.get("kind")?.split(",").filter(Boolean);
    if (kinds && (kinds.length > 4 || kinds.some((k) => !KINDS.includes(k)))) errors.push({ in: "query", path: "/kind", code: "not_in_enum", params: { expected: KINDS } });
    const sort = params.get("sort") ?? "-version";
    if (sort !== "-version" && sort !== "version") errors.push({ in: "query", path: "/sort", code: "not_in_enum" });
    const includePreview = boolParam(params, "include_preview") ?? false;
    if (errors.length) throw validationFailed(errors);
    const live = liveRevisionId(db, root);
    let rows = revList(db, root).slice();
    if (kinds?.length) rows = rows.filter((r) => kinds.includes(r.kind));
    if (!includePreview) rows = rows.filter((r) => !r.is_preview);
    rows.sort((x, y) => (sort === "version" ? x.version - y.version : y.version - x.version));
    const summaries: RevisionSummary[] = rows.map(({ entity: _e, snapshot: _s, ...summary }) => {
      void _e;
      void _s;
      return { ...summary, is_live: summary.id === live };
    });
    return paginate(summaries, params);
  }

  function getRevision(db: MockDb, id: string, revId: string) {
    const root = find(db, id);
    const rev = revList(db, root).find((r) => String(r.id) === revId);
    if (!rev) throw notFound();
    return { ...rev, entity: { type: a.entityType, id: root.id, key: null }, is_live: rev.id === liveRevisionId(db, root) };
  }

  function restoreRevision(db: MockDb, id: string, revId: string, body: unknown, ifMatch: string | null) {
    const root = find(db, id);
    const rev = revList(db, root).find((r) => String(r.id) === revId);
    if (!rev) throw notFound();
    if (translator(db)) throw deny("update", "POST", `${a.path}/revisions/{revId}/restore`);
    requireMatch(ifMatch, root);
    if (body !== undefined && body !== null && !isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
    const input = (body ?? {}) as Record<string, unknown>;
    const bodyErrors: ApiFieldError[] = Object.keys(input).filter((k) => k !== "change_note").map((k) => ({ in: "body" as const, path: `/${k}`, code: "unknown_field" }));
    if (input.change_note !== undefined && (typeof input.change_note !== "string" || [...input.change_note].length > 200)) bodyErrors.push({ in: "body", path: "/change_note", code: "too_long", params: { max: 200 } });
    if (bodyErrors.length) throw validationFailed(bodyErrors);
    trashedCheck(root);
    if (rev.schema_version > 1) throw invalidState("snapshot_incompatible");
    const restoredFrom = { revision_id: rev.id, version: rev.version };
    const snapshot = rev.snapshot as unknown as Snap;
    const current = working(db, root);
    if (rev.kind === "draft" || JSON.stringify(snapshot) === JSON.stringify(current)) {
      return { data: { ...writeResult(db, root), restored_from: restoredFrom }, etag: etagOfRoot(root) };
    }
    // All or nothing: the references first, then the children somebody still names (05 13.4.4).
    const errors = a.snapshotRefs(db, snapshot);
    if (errors.length) throw validationFailed(errors);
    const dropped = a.droppedReferences?.(db, root, snapshot) ?? [];
    if (dropped.length) throw entityReferenced(dropped);

    const stamp = tick(db);
    const note = (typeof input.change_note === "string" && input.change_note) || `restore of v${rev.version}`;
    pushRevision(db, a.kind, root.id, a.entityType, "restore", structuredClone(current) as unknown as Record<string, unknown>, note, stamp, MOCK_USER);
    const next = structuredClone(snapshot);
    if (root.status === "published") {
      const draft = draftRow(db, root);
      if (draft) draft.snapshot = next as unknown as Record<string, unknown>;
      else pushRevision(db, a.kind, root.id, a.entityType, "draft", next as unknown as Record<string, unknown>, null, stamp, MOCK_USER);
    } else {
      (root as { live: Snap }).live = next;
    }
    commitWrite(root, stamp);
    return { data: { ...writeResult(db, root), restored_from: restoredFrom }, etag: etagOfRoot(root) };
  }

  // Somebody else saved it: the next command with the old ETag is a 409 (a click-through helper).
  function touchAsSomeoneElse(db: MockDb, id: number): number {
    const root = a.roots(db).find((r) => r.id === id);
    if (!root) throw notFound();
    touch(db, root);
    root.updated_by = { id: 4, name: "Somchai Vongsa" };
    return root.lock_version;
  }

  // D1 (05 12.11): the schedule commands. No review workflow here (albums, FAQ groups, entries have none).
  const d1 = makeReviewSchedule<R>({
    kind: a.kind,
    entityType: a.entityType,
    permission: a.permission,
    path: a.path,
    review: false,
    find: (db, id) => find(db, id),
    requireMatch,
    touch,
    trashedCheck,
    hasDraft,
    validate: a.validate,
    blockedError: blockedError as never,
    writeResult: (db, root, warnings) => writeResult(db, root, warnings as SaveLiveWarning[]),
    etag: etagOfRoot,
    snapshot: (db, root) => working(db, root) as unknown as Record<string, unknown>,
    denied: (db, _root, action) => (translator(db) ? action : null),
    publishNow: (db, id) => {
      publish(db, id, new URLSearchParams(), undefined, etagOfRoot(find(db, id)), true);
    },
  });

  return {
    d1,
    translator,
    deny,
    revList,
    draftRow,
    working,
    hasDraft,
    isTrashed,
    etagOfRoot,
    stampOf,
    writeResult,
    find,
    requireMatch,
    touch,
    beginWrite,
    commitWrite,
    trashedCheck,
    remove,
    restoreFromTrash,
    publish,
    unpublish,
    discardDraft,
    listRevisions,
    getRevision,
    restoreRevision,
    touchAsSomeoneElse,
  };
}

export type Engine<R extends Root, V extends object> = ReturnType<typeof makeEngine<R, V>>;
