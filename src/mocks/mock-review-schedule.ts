// D1: the review and schedule commands of the publish engine (doc/05 12.10 - 12.11), written ONCE and parameterised by an adapter, like the
// backend's generic engine (`pkg/content/publish`: review.go, schedule.go). Used by the pages, posts, albums and collection-entries models.
//
// Rules as the server has them (checks in this order, as `publishing.controller.go` and the engine run them):
//   route policy (403) -> the entity (404) -> the body (422: unknown field, `/comment` required / too_long, `/scheduled_at` required /
//   invalid_format) -> the time range (422 `out_of_range` with `params.min` / `max`) -> the rate limit (429, schedule only) -> `If-Match`
//   (428 / 409 `CONFLICT_LOCK_VERSION`) -> the state (409 `INVALID_STATE` `trashed` / `not_draft` / `not_in_review` / `not_scheduled` /
//   `nothing_to_publish`) -> the publish rules (422 `PUBLISH_BLOCKED`, schedule only).
//   draft -> in_review (submit), in_review -> draft (reject, the comment is the change note of a `history` revision); draft | in_review |
//   archived | scheduled -> scheduled (schedule); a PUBLISHED root with a pending draft stays `published` and gets an `apply_revision`
//   booking; unschedule: scheduled -> archived (ever published) or draft, a published root only loses its booking.
//   A schedule row is `pending` -> `running` -> done, or `failed` after 3 attempts (the entity stays `scheduled`, overdue).
//
// Rights: `db.workflowRole` (see `MockWorkflowRole`) on top of each model's own roles (`adapter.denied`).
import {
  MOCK_USER,
  fail,
  forbidden,
  invalidState,
  keyOf,
  micros,
  notFound,
  pushRevision,
  validationFailed,
  type MockDb,
  type MockSchedule,
  type StoredRevision,
} from "@/mocks/mock-core";
import type { ApiFieldError } from "@/types/api";
import type { PublishableStatus, PublishIssue, ScheduleInfo } from "@/types/publishing";

export const SCHEDULE_LIMIT_PER_HOUR = 60;
export const MAX_FIRE_ATTEMPTS = 3;
const MIN_LEAD_MS = 60_000;
const COMMENT_MAX = 200;
const RFC3339_OFFSET = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

// `2026-11-10T09:00:00+07:00` (second precision, the zone of every body timestamp).
export function rfc3339Vientiane(ms: number): string {
  return `${new Date(ms + 7 * 3_600_000).toISOString().slice(0, 19)}+07:00`;
}

// ---- views the models embed in their rows ----------------------------------------------------------------------------------------
export function scheduleMember(db: MockDb, kind: string, id: number): ScheduleInfo | null {
  const row = db.schedules[keyOf(kind, id)];
  if (!row) return null;
  return { action: row.action, run_at: micros(row.run_at, 0), status: row.status, attempts: row.attempts, last_error: row.last_error };
}
// The root's `scheduled_at`: only a `publish` booking sets it (an `apply_revision` leaves the root alone).
export function scheduledAtOf(db: MockDb, kind: string, id: number): string | null {
  const row = db.schedules[keyOf(kind, id)];
  return row && row.action === "publish" ? micros(row.run_at, 0) : null;
}
export const clearSchedule = (db: MockDb, kind: string, id: number) => {
  delete db.schedules[keyOf(kind, id)];
};

type Params = { min: string; max: string };
const addYear = (ms: number) => {
  const d = new Date(ms);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.getTime();
};

export type D1Root = { id: number; status: PublishableStatus; first_published_at: string | null };
export type D1Adapter<R extends D1Root> = {
  kind: string; // "pages" | "posts" | "albums" | "collection-entries"
  entityType: string; // "cms.pages"
  permission: string; // "cms.pages"
  path: string; // "/pages/{id}"
  // Pages and posts have the review workflow; albums and entries do not (their `submit-review` / `reject` routes do not exist).
  review: boolean;
  find: (db: MockDb, id: string) => R;
  requireMatch: (ifMatch: string | null, root: R) => void;
  touch: (db: MockDb, root: R) => string;
  trashedCheck: (root: R) => void;
  hasDraft: (db: MockDb, root: R) => boolean;
  validate: (db: MockDb, root: R) => { blockers: PublishIssue[]; warnings: PublishIssue[] };
  blockedError: (blockers: PublishIssue[], warnings: PublishIssue[]) => Error;
  writeResult: (db: MockDb, root: R, warnings?: Array<{ path: string; code: string; params?: unknown }>) => object;
  etag: (root: R) => string;
  // The working copy the reject keeps as a `history` revision.
  snapshot: (db: MockDb, root: R) => Record<string, unknown>;
  // The model's own refusal of an action, or null: posts (the `update_own` author), collections (viewer, translator).
  denied: (db: MockDb, root: R, action: "update" | "review" | "publish" | "schedule") => string | null;
  // The real publish done by the server when the time comes (no rights check, `If-Match` = the current ETag).
  publishNow: (db: MockDb, id: string) => void;
};

export function makeReviewSchedule<R extends D1Root>(a: D1Adapter<R>) {
  const deny = (action: string, method: string, suffix: string) => forbidden(`${a.permission}:${action} ${method} ${a.path}${suffix}`);

  // ---- rights ---------------------------------------------------------------------------------------------------------------------
  function mayUpdate(db: MockDb, root: R): boolean {
    return db.workflowRole !== "reviewer" && a.denied(db, root, "update") === null;
  }
  function mayReview(db: MockDb, root: R): boolean {
    return (db.workflowRole === "full" || db.workflowRole === "reviewer") && a.denied(db, root, "review") === null;
  }
  // BR-11: `schedule` AND `publish`. The `scheduler` role holds the first without the second.
  function maySchedule(db: MockDb, root: R): boolean {
    return db.workflowRole === "full" && a.denied(db, root, "schedule") === null && a.denied(db, root, "publish") === null;
  }

  // ---- submit-review ----------------------------------------------------------------------------------------------------------------
  function submitReview(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
    const root = a.find(db, id);
    if (!a.review) throw notFound();
    if (!mayUpdate(db, root)) throw deny("update", "POST", "/submit-review");
    const errors: ApiFieldError[] = [];
    if (body !== undefined && body !== null && !isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
    const input = (body ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(input)) if (k !== "note") errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
    if (input.note !== undefined && input.note !== null && (typeof input.note !== "string" || [...input.note.trim()].length > COMMENT_MAX)) errors.push({ in: "body", path: "/note", code: "too_long", params: { max: COMMENT_MAX } });
    if (errors.length) throw validationFailed(errors);
    a.requireMatch(ifMatch, root);
    a.trashedCheck(root);
    if (root.status !== "draft") throw invalidState("not_draft");
    a.touch(db, root);
    root.status = "in_review";
    return { data: a.writeResult(db, root, []), etag: a.etag(root) };
  }

  // ---- reject -----------------------------------------------------------------------------------------------------------------------
  function reject(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
    const root = a.find(db, id);
    if (!a.review) throw notFound();
    if (!mayReview(db, root)) throw deny("review", "POST", "/reject");
    if (body !== undefined && body !== null && !isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
    const input = (body ?? {}) as Record<string, unknown>;
    const errors: ApiFieldError[] = Object.keys(input)
      .filter((k) => k !== "comment")
      .map((k) => ({ in: "body" as const, path: `/${k}`, code: "unknown_field" }));
    const comment = typeof input.comment === "string" ? input.comment.trim() : "";
    const length = [...comment].length;
    if (typeof input.comment !== "string" || length === 0) errors.push({ in: "body", path: "/comment", code: "required" });
    else if (length > COMMENT_MAX) errors.push({ in: "body", path: "/comment", code: "too_long", params: { max: COMMENT_MAX } });
    if (errors.length) throw validationFailed(errors);
    a.requireMatch(ifMatch, root);
    a.trashedCheck(root);
    if (root.status !== "in_review") throw invalidState("not_in_review");
    const stamp = a.touch(db, root);
    root.status = "draft";
    const revision: StoredRevision = pushRevision(db, a.kind, root.id, a.entityType, "history", structuredClone(a.snapshot(db, root)), comment, stamp, MOCK_USER);
    return { data: { ...a.writeResult(db, root, []), review_revision: { id: revision.id, version: revision.version } }, etag: a.etag(root) };
  }

  // ---- schedule ---------------------------------------------------------------------------------------------------------------------
  // 60 per hour per user, every kind together (05 12.11.6); the unschedule is never limited.
  function rateLimit(db: MockDb) {
    const now = Date.now();
    db.scheduleCalls = db.scheduleCalls.filter((t) => now - t < 3_600_000);
    if (db.scheduleCalls.length >= SCHEDULE_LIMIT_PER_HOUR) {
      const retry = Math.max(1, Math.ceil((db.scheduleCalls[0] + 3_600_000 - now) / 1000));
      throw fail(429, "RATE_LIMITED", "Too many requests. Try again later.", {}, { "Retry-After": String(retry) });
    }
    db.scheduleCalls.push(now);
  }

  function schedule(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
    const root = a.find(db, id);
    if (!maySchedule(db, root)) throw deny(db.workflowRole === "scheduler" || a.denied(db, root, "publish") !== null ? "publish" : "schedule", "POST", "/schedule");
    if (body !== undefined && body !== null && !isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
    const input = (body ?? {}) as Record<string, unknown>;
    const errors: ApiFieldError[] = Object.keys(input)
      .filter((k) => k !== "scheduled_at")
      .map((k) => ({ in: "body" as const, path: `/${k}`, code: "unknown_field" }));
    const raw = input.scheduled_at;
    if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) errors.push({ in: "body", path: "/scheduled_at", code: "required" });
    else if (typeof raw !== "string" || !RFC3339_OFFSET.test(raw.trim()) || Number.isNaN(Date.parse(raw.trim()))) errors.push({ in: "body", path: "/scheduled_at", code: "invalid_format", params: { format: "RFC 3339 with an offset" } });
    if (errors.length) throw validationFailed(errors);
    const at = Date.parse((raw as string).trim());
    const now = Date.now();
    if (at < now + MIN_LEAD_MS || at > addYear(now)) {
      const params: Params = { min: rfc3339Vientiane(now + MIN_LEAD_MS), max: rfc3339Vientiane(addYear(now)) };
      throw validationFailed([{ in: "body", path: "/scheduled_at", code: "out_of_range", params }]);
    }
    rateLimit(db);
    a.requireMatch(ifMatch, root);
    a.trashedCheck(root);
    let action: MockSchedule["action"] = "publish";
    if (root.status === "published") {
      if (!a.hasDraft(db, root)) throw invalidState("nothing_to_publish");
      action = "apply_revision";
    }
    const { blockers, warnings } = a.validate(db, root);
    if (blockers.length > 0) throw a.blockedError(blockers, warnings);
    a.touch(db, root);
    if (action === "publish") root.status = "scheduled";
    db.schedules[keyOf(a.kind, root.id)] = { action, run_at: at, status: "pending", attempts: 0, last_error: null };
    return { data: a.writeResult(db, root, warnings.map((w) => ({ path: w.path, code: w.code, params: w.params }))), etag: a.etag(root) };
  }

  // ---- unschedule -------------------------------------------------------------------------------------------------------------------
  function unschedule(db: MockDb, id: string, ifMatch: string | null) {
    const root = a.find(db, id);
    if (!maySchedule(db, root)) throw deny(db.workflowRole === "scheduler" || a.denied(db, root, "publish") !== null ? "publish" : "schedule", "DELETE", "/schedule");
    a.requireMatch(ifMatch, root);
    a.trashedCheck(root);
    const key = keyOf(a.kind, root.id);
    if (root.status !== "scheduled" && !db.schedules[key]) throw invalidState("not_scheduled");
    a.touch(db, root);
    if (root.status === "scheduled") root.status = root.first_published_at ? "archived" : "draft";
    delete db.schedules[key];
    return { data: a.writeResult(db, root, []), etag: a.etag(root) };
  }

  // ---- the clock of the tests --------------------------------------------------------------------------------------------------------
  // The scheduler worker, for ONE entity: runs its booking now (whatever `run_at` says). The publish rules run again: blocked = an attempt
  // is used (the booking is retried a minute later; after 3 attempts it is `failed` and the entity stays `scheduled`, overdue). An
  // `apply_revision` whose draft is gone is cancelled. Returns what happened.
  function fire(db: MockDb, id: string): "published" | "retry" | "failed" | "cancelled" {
    const root = a.find(db, id);
    const key = keyOf(a.kind, root.id);
    const row = db.schedules[key];
    if (!row) throw invalidState("not_scheduled");
    if (row.action === "apply_revision" && (root.status !== "published" || !a.hasDraft(db, root))) {
      delete db.schedules[key];
      return "cancelled";
    }
    const { blockers } = a.validate(db, root);
    if (blockers.length > 0) {
      row.attempts += 1;
      row.last_error = [...new Set(blockers.map((b) => b.code))].join(", ");
      if (row.attempts >= MAX_FIRE_ATTEMPTS) {
        row.status = "failed";
        return "failed";
      }
      row.status = "pending";
      row.run_at = Date.now() + 60_000;
      return "retry";
    }
    a.publishNow(db, id);
    delete db.schedules[key];
    return "published";
  }

  // The server gave up (3 attempts): the entity stays `scheduled`, the booking is `failed` with its reason.
  function fail3(db: MockDb, id: string, lastError = "media_alt_missing") {
    const root = a.find(db, id);
    const row = db.schedules[keyOf(a.kind, root.id)];
    if (!row) throw invalidState("not_scheduled");
    row.status = "failed";
    row.attempts = MAX_FIRE_ATTEMPTS;
    row.last_error = lastError;
  }
  // The time passed and the worker has not fired yet (`pending`, `run_at` in the past).
  function makeOverdue(db: MockDb, id: string) {
    const root = a.find(db, id);
    const row = db.schedules[keyOf(a.kind, root.id)];
    if (!row) throw invalidState("not_scheduled");
    row.run_at = Date.now() - 5 * 60_000;
    row.status = "pending";
  }

  return { submitReview, reject, schedule, unschedule, fire, fail3, makeOverdue, mayUpdate, mayReview, maySchedule };
}
