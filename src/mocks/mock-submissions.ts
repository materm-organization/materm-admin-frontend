// In-memory model of the submissions endpoints (doc/05 section 13.7; backend materm-admin-backend/modules/forms: listSubmissions,
// summary, export, bulk-status, getSubmission, setStatus, addNote), strict like the backend:
//  - an unknown query parameter or body member is 422; `assigned_to` / `mine` are 422 `not_applicable` (P2);
//  - `status` absent = every status EXCEPT `spam`; a `keyword` search needs a window of at most 366 days (none = the last 90 days
//    of the model's clock), longer is 422 `date_range_too_large` at `/to`; `from > to` is 422 `out_of_range`; sort is `created_at` only;
//  - `GET /submissions/{id}?created_at=` must equal the row's `created_at` or it is a 404 (the partition hint);
//  - the status table of 13.7.4: a move that is not in the table is 409 `INVALID_STATE` `invalid_transition` (+ `details.from` / `to`),
//    the same status is a 200 without effect, an anonymised row is 409 `anonymized`; `If-Match` is optional on PATCH (a stale one is 409);
//  - notes are append-only (1 - 2000 characters), do not change the ETag; the bulk status skips what it cannot change instead of failing;
//  - the CSV export: UTF-8 BOM, CRLF, formula cells prefixed with `'`, no `ip_hash` / `user_agent` / notes / consent / spam score, 50,000 rows
//    at most (422 `EXPORT_TOO_LARGE`), 5 per hour (429 + `Retry-After`, fail closed: a knob makes it a 503), and an audit row is "written"
//    before the stream (`submissionsState(db).exportLog`, with the keyword reduced to its length).
// Nothing here is ever logged. The state is a WeakMap keyed by the `MockDb` (a fresh model per `resetMockDb()`), seeded on first use.
//
// INVENTED seed: 16 messages for the three forms of `mock-forms.ts` (the real database has none), by made-up people, among them one
// whose text is HTML (it must render as text), one that starts with `=` (CSV injection), one with a key the form no longer has, one
// anonymised, one past its retention, one older than 90 days and two spam.
import { csvCell, SUBMISSION_STATUSES, canMoveSubmission, KEYWORD_DEFAULT_WINDOW_DAYS, KEYWORD_MAX_WINDOW_DAYS, MAX_BULK_IDS, MAX_NOTE, EXPORT_MAX_ROWS } from "@/lib/submissions";
import {
  CLOCK_START,
  DEFAULT_LOCALE_CODE,
  MOCK_USER,
  etagOf,
  fail,
  forbidden,
  invalidState,
  lockConflict,
  micros,
  notFound,
  paginate,
  rejectUnknown,
  tick,
  validationFailed,
  type MockDb,
  type Params,
} from "@/mocks/mock-core";
import { bindNewSubmissionCount, formsState, formWorking, type MockFormRoot } from "@/mocks/mock-forms";
import type { ApiFieldError } from "@/types/api";
import type { UserRef } from "@/types/media";
import type { BulkStatusResult, SubmissionDetail, SubmissionField, SubmissionListItem, SubmissionNote, SubmissionStatus } from "@/types/submissions";

const DAY = 86_400_000;
const SOMCHAI: UserRef = { id: 4, name: "Somchai Vongsa" };
const EXPORT_LIMIT = 5;
const BULK_LIMIT = 30;

export type MockSubmission = {
  id: number;
  public_id: string;
  created_at: string;
  updated_at: string;
  form_id: number;
  locale_code: string | null;
  status: SubmissionStatus;
  data: Record<string, unknown>;
  schema_version: number;
  source_path: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  consent_at: string | null;
  consent_version: string | null;
  spam_score: number;
  handled_by: UserRef;
  handled_at: string | null;
  notes: SubmissionNote[];
  anonymized_at: string | null;
  retention_until: string;
};

export type ExportAudit = { filter: Record<string, string | number>; row_count: number; columns: number };

export type SubmissionsState = {
  items: MockSubmission[];
  nextId: number;
  nextNoteId: number;
  // The signed-in user's rights: `forms.submissions:update` and `:export` (read is always there).
  canUpdate: boolean;
  canExport: boolean;
  exportCalls: number;
  bulkCalls: number;
  exportMax: number;
  // Redis is down: the export is fail-closed (503).
  exportUnavailable: boolean;
  exportLog: ExportAudit[];
};

const states = new WeakMap<MockDb, SubmissionsState>();

export function submissionsState(db: MockDb): SubmissionsState {
  let state = states.get(db);
  if (!state) {
    state = { items: [], nextId: 1, nextNoteId: 1, canUpdate: true, canExport: true, exportCalls: 0, bulkCalls: 0, exportMax: EXPORT_MAX_ROWS, exportUnavailable: false, exportLog: [] };
    states.set(db, state);
    seed(db, state);
  }
  return state;
}

// The forms list and the form detail show "new messages"; this is where they get the number.
export const newCount = (db: MockDb, formId?: number) =>
  submissionsState(db).items.filter((s) => s.status === "new" && !s.anonymized_at && (formId === undefined || s.form_id === formId)).length;
bindNewSubmissionCount((db, formId) => newCount(db, formId));

// ---- seed ----------------------------------------------------------------------------------------------------------------
function seed(db: MockDb, state: SubmissionsState) {
  formsState(db); // the forms first (the three ids below)
  const retention = (createdMs: number, days = 365) => micros(createdMs + days * DAY, 0);
  let seq = 0;
  const add = (daysAgo: number, hoursOffset: number, p: Partial<MockSubmission> & Pick<MockSubmission, "form_id" | "data">) => {
    const ms = CLOCK_START - daysAgo * DAY - hoursOffset * 3_600_000;
    const id = state.nextId++;
    seq += 1;
    const created = micros(ms, 100 + seq);
    state.items.push({
      id,
      public_id: `0192d3a4-7c1e-7b52-9d0a-fb${String(id).padStart(10, "0")}`,
      created_at: created,
      updated_at: created,
      locale_code: "en",
      status: "new",
      schema_version: 1,
      source_path: "/contact",
      user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
      ip_hash: `a3f9${String(id).padStart(2, "0")}c07be2d1${"4f".repeat(24)}`.slice(0, 64),
      consent_at: null,
      consent_version: null,
      spam_score: 0,
      handled_by: null,
      handled_at: null,
      notes: [],
      anonymized_at: null,
      retention_until: retention(ms),
      ...p,
    });
    return state.items[state.items.length - 1];
  };
  const msg = (name: string, email: string, topic: string, message: string, phone?: string) => ({ name, email, topic, message, ...(phone ? { phone } : {}) });

  // The ids grow with the date, except 7 (an old row that is past its retention) and 8.
  add(130, 0, { form_id: 1, status: "archived", handled_by: SOMCHAI, handled_at: micros(CLOCK_START - 128 * DAY, 3), data: msg("Khamla Sihalath", "khamla@example.com", "booking", "Do you have a tent for four people in March?") }); // 1: older than 90 days
  add(60, 2, { form_id: 1, status: "replied", handled_by: MOCK_USER, handled_at: micros(CLOCK_START - 59 * DAY, 4), locale_code: "la", data: msg("Noy Vilay", "noy.vilay@example.com", "events", "Can we hold a small birthday evening with live music?", "+856 20 5551 2200") }); // 2
  add(45, 0, { form_id: 3, status: "read", data: msg("Ploy Chaiyo", "ploy@example.com", "trek", "Two of us, first week of December.") }); // 3
  add(33, 1, { form_id: 1, status: "spam", spam_score: 92, source_path: "/contact", data: msg("seo-deals", "deals@spam.example", "other", "Cheap links, visit http://spam.example now!!! Cheap links, visit http://spam.example now!!!") }); // 4
  add(21, 5, { form_id: 1, status: "read", data: msg("Anouvong Keo", "anou@example.com", "camping", "Is the camp site open all year? We would like to bring two kids.") }); // 5
  add(14, 2, { form_id: 2, status: "read", consent_at: micros(CLOCK_START - 14 * DAY, 5), consent_version: "2026-01", source_path: "/", data: { email: "reader@example.com", consent: true } }); // 6
  const overdue = add(400, 0, { form_id: 1, status: "read", data: msg("Old Contact", "old@example.com", "other", "A message that is past its retention period.") }); // 7 (retention_overdue)
  overdue.retention_until = micros(CLOCK_START - 35 * DAY, 0);
  const anon = add(70, 3, { form_id: 1, status: "archived", handled_by: SOMCHAI, handled_at: micros(CLOCK_START - 69 * DAY, 1), data: {} }); // 8
  anon.anonymized_at = micros(CLOCK_START - 5 * DAY, 1);
  anon.ip_hash = null;
  anon.user_agent = null;
  anon.source_path = null;
  anon.locale_code = null;
  add(9, 1, { form_id: 1, status: "new", data: msg("Dara Phommachan Jr.", "dara.jr@example.com", "booking", "Looking for a weekend stay for six people at the end of November. Is there a minibus from Vientiane?") }); // 9
  add(7, 3, { form_id: 3, status: "new", data: { name: "Mali Souk", email: "mali@example.com", topic: "camp", group_size: "6+", notes: "We are a school group of 8." } }); // 10
  add(5, 2, { form_id: 1, status: "new", locale_code: "la", data: { ...msg("ສົມຊາຍ", "somchai.l@example.com", "events", "ເຮົາຢາກຖາມກ່ຽວກັບຄືນດົນຕີ"), legacy_field: "kept from an older version of the form" } }); // 11: a key the schema no longer has
  add(3, 4, { form_id: 1, status: "new", data: msg("<b>Bold</b> Visitor", "html@example.com", "other", '<img src=x onerror="alert(1)"> Hello <script>alert("xss")</script>\nSecond line with a link: <a href="javascript:alert(2)">click</a>') }); // 12: HTML that must stay text
  add(2, 1, { form_id: 1, status: "new", data: msg('=HYPERLINK("http://evil.example","click")', "formula@example.com", "other", "+SUM(1,1) this message starts with a plus sign on purpose and has , commas and \"quotes\".") }); // 13: CSV injection
  add(1, 6, { form_id: 3, status: "new", data: { name: "Bounmy", email: "bounmy@example.com", topic: "trek", group_size: "3-5", notes: "" } }); // 14
  add(1, 1, { form_id: 1, status: "spam", spam_score: 80, data: msg("promo", "promo@spam.example", "other", "You won a prize, click here to claim it right now, only today.") }); // 15
  add(0, 5, { form_id: 1, status: "new", data: msg("Keo Manivong", "keo.m@example.com", "camping", "x".repeat(300) + " end") }); // 16 (a long message: the preview is cut at 140)
}

// ---- views ---------------------------------------------------------------------------------------------------------------
const formOf = (db: MockDb, id: number): MockFormRoot => {
  const form = formsState(db).forms.find((f) => f.id === id);
  if (!form) throw notFound();
  return form;
};
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const len = (v: string) => [...v].length;
const etagOfSubmission = (s: MockSubmission) => etagOf(s.updated_at);

export function submissionListItem(db: MockDb, s: MockSubmission): SubmissionListItem {
  const form = formOf(db, s.form_id);
  const anon = s.anonymized_at !== null;
  const message = str(s.data.message);
  return {
    id: s.id,
    public_id: s.public_id,
    created_at: s.created_at,
    form: { id: form.id, slug: form.slug, name: formWorking(db, form).form.name },
    locale_code: anon ? null : s.locale_code,
    status: s.status,
    sender_name: anon ? null : str(s.data.name),
    sender_email: anon ? null : str(s.data.email),
    topic: str(s.data.topic),
    message_preview: anon || message === null ? null : [...message].slice(0, 140).join(""),
    source_path: anon ? null : s.source_path,
    assigned_to: null,
    handled_by: s.handled_by,
    handled_at: s.handled_at,
    spam_score: s.spam_score,
    notes_count: anon ? 0 : s.notes.length,
    anonymized_at: s.anonymized_at,
    retention_until: s.retention_until,
    etag: etagOfSubmission(s),
  };
}

function labelFor(db: MockDb, form: MockFormRoot, key: string, locale: string): string {
  const rows = formWorking(db, form).field_translations.filter((t) => t.field_key === key);
  return (rows.find((t) => t.locale_code === locale) ?? rows.find((t) => t.locale_code === DEFAULT_LOCALE_CODE) ?? rows[0])?.label ?? key;
}

export function submissionDetail(db: MockDb, s: MockSubmission, locale: string = DEFAULT_LOCALE_CODE): SubmissionDetail {
  const form = formOf(db, s.form_id);
  const anon = s.anonymized_at !== null;
  const keys = form.fields.map((f) => f.key);
  const fields: SubmissionField[] = anon
    ? []
    : form.fields.filter((f) => f.key in s.data).map((f) => ({ key: f.key, label: labelFor(db, form, f.key, locale), type: f.type, value: s.data[f.key] }));
  const extra = anon ? {} : Object.fromEntries(Object.entries(s.data).filter(([k]) => !keys.includes(k)));
  return {
    ...submissionListItem(db, s),
    schema_version: s.schema_version,
    fields,
    extra,
    user_agent: anon ? null : s.user_agent,
    ip_hash_prefix: anon || !s.ip_hash ? null : s.ip_hash.slice(0, 12),
    consent_at: anon ? null : s.consent_at,
    consent_version: anon ? null : s.consent_version,
    notes: anon ? [] : structuredClone(s.notes),
    retention_overdue: !anon && Date.parse(s.retention_until) < db.clock,
  };
}

// ---- guards --------------------------------------------------------------------------------------------------------------
const deny = (action: string, method: string, path: string) => forbidden(`forms.submissions:${action} ${method} ${path}`);
const needUpdate = (db: MockDb, method: string, path: string) => {
  if (!submissionsState(db).canUpdate) throw deny("update", method, path);
};

function findRow(db: MockDb, id: string, params: Params): MockSubmission {
  const s = submissionsState(db).items.find((x) => String(x.id) === id);
  if (!s) throw notFound();
  const hint = params.get("created_at");
  if (hint !== null && hint !== s.created_at) throw notFound();
  return s;
}

// ---- filters (shared by the list and the export) -------------------------------------------------------------------------
type Filter = { statuses: string[] | undefined; formId: number | undefined; topic: string | undefined; from: number | undefined; to: number | undefined; keyword: string | undefined };

function parseTime(params: Params, name: "from" | "to", errors: ApiFieldError[]): number | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;
  const ms = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(raw) ? Date.parse(raw) : NaN;
  if (Number.isNaN(ms)) {
    errors.push({ in: "query", path: `/${name}`, code: "invalid_format" });
    return undefined;
  }
  return ms;
}

function parseFilter(db: MockDb, params: Params): Filter {
  const errors: ApiFieldError[] = [];
  for (const name of ["assigned_to", "mine"]) if (params.has(name)) errors.push({ in: "query", path: `/${name}`, code: "not_applicable" });
  if (errors.length) throw validationFailed(errors);
  const statuses = params.get("status")?.split(",").filter(Boolean);
  if (statuses && (statuses.length > 5 || statuses.some((s) => !(SUBMISSION_STATUSES as readonly string[]).includes(s)))) errors.push({ in: "query", path: "/status", code: "not_in_enum", params: { expected: [...SUBMISSION_STATUSES] } });
  let formId: number | undefined;
  if (params.has("form_id")) {
    formId = /^[1-9]\d*$/.test(params.get("form_id") ?? "") ? Number(params.get("form_id")) : undefined;
    if (formId === undefined) errors.push({ in: "query", path: "/form_id", code: "invalid_type", params: { expected: "integer" } });
  }
  const topic = params.get("topic") ?? undefined;
  if (topic !== undefined && len(topic) > 60) errors.push({ in: "query", path: "/topic", code: "too_long", params: { max: 60 } });
  const keyword = params.get("keyword")?.trim() || undefined;
  if (keyword !== undefined && len(keyword) > 100) errors.push({ in: "query", path: "/keyword", code: "too_long", params: { max: 100 } });
  let from = parseTime(params, "from", errors);
  const to = parseTime(params, "to", errors);
  if (errors.length) throw validationFailed(errors);
  if (from !== undefined && to !== undefined && from > to) throw validationFailed([{ in: "query", path: "/to", code: "out_of_range" }]);
  if (keyword !== undefined) {
    if (from === undefined && to === undefined) from = db.clock - KEYWORD_DEFAULT_WINDOW_DAYS * DAY;
    else if (from !== undefined && (to ?? db.clock) - from > KEYWORD_MAX_WINDOW_DAYS * DAY) throw validationFailed([{ in: "query", path: "/to", code: "date_range_too_large", params: { max_days: KEYWORD_MAX_WINDOW_DAYS } }]);
    else if (from === undefined && to !== undefined) from = to - KEYWORD_DEFAULT_WINDOW_DAYS * DAY;
  }
  return { statuses, formId, topic, from, to, keyword };
}

function matching(db: MockDb, f: Filter): MockSubmission[] {
  const kw = f.keyword?.toLowerCase();
  return submissionsState(db).items.filter((s) => {
    if (f.statuses ? !f.statuses.includes(s.status) : s.status === "spam") return false;
    if (f.formId !== undefined && s.form_id !== f.formId) return false;
    if (f.topic !== undefined && str(s.data.topic) !== f.topic) return false;
    const at = Date.parse(s.created_at);
    if (f.from !== undefined && at < f.from) return false;
    if (f.to !== undefined && at > f.to) return false;
    if (kw && !(s.anonymized_at === null && [s.data.name, s.data.email, s.data.message].some((v) => typeof v === "string" && v.toLowerCase().includes(kw)))) return false;
    return true;
  });
}

// ---- reads ---------------------------------------------------------------------------------------------------------------
export function listSubmissions(db: MockDb, params: Params) {
  rejectUnknown(params, ["page", "limit", "keyword", "status", "form_id", "topic", "from", "to", "sort", "assigned_to", "mine"]);
  const sort = params.get("sort") ?? "-created_at";
  if (sort !== "-created_at" && sort !== "created_at") throw validationFailed([{ in: "query", path: "/sort", code: "not_in_enum", params: { expected: ["-created_at", "created_at"] } }]);
  const filter = parseFilter(db, params);
  const rows = matching(db, filter).sort((a, b) => (sort === "created_at" ? 1 : -1) * (Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id));
  return paginate(rows.map((s) => submissionListItem(db, s)), params);
}

export function submissionsSummary(db: MockDb) {
  const forms = formsState(db).forms;
  const by_form = forms.map((f) => ({ form_id: f.id, slug: f.slug, name: formWorking(db, f).form.name, new: newCount(db, f.id) })).filter((f) => f.new > 0);
  return { new: newCount(db), by_form };
}

export function getSubmission(db: MockDb, id: string, params: Params) {
  rejectUnknown(params, ["created_at", "locale"]);
  const locale = params.get("locale");
  if (locale !== null && len(locale) > 20) throw validationFailed([{ in: "query", path: "/locale", code: "too_long", params: { max: 20 } }]);
  const s = findRow(db, id, params);
  return { data: submissionDetail(db, s, locale ?? DEFAULT_LOCALE_CODE), etag: etagOfSubmission(s) };
}

// ---- writes --------------------------------------------------------------------------------------------------------------
function applyStatus(db: MockDb, s: MockSubmission, to: SubmissionStatus) {
  const stamp = tick(db);
  if (to === "replied" || to === "archived" || to === "spam") {
    s.handled_by = MOCK_USER;
    s.handled_at = stamp;
  } else if (s.status === "spam" && to === "new") {
    s.handled_by = null;
    s.handled_at = null;
  }
  s.status = to;
  s.updated_at = stamp;
}

export function setSubmissionStatus(db: MockDb, id: string, params: Params, body: unknown, ifMatch: string | null) {
  rejectUnknown(params, ["created_at"]);
  needUpdate(db, "PATCH", "/submissions/{id}");
  const s = findRow(db, id, params);
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type", params: { expected: "object" } }]);
  const input = body as Record<string, unknown>;
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(input)) {
    if (k === "assigned_to") errors.push({ in: "body", path: "/assigned_to", code: "not_applicable" });
    else if (k !== "status") errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  }
  if (input.status === undefined) errors.push({ in: "body", path: "/status", code: "required" });
  else if (typeof input.status !== "string" || !(SUBMISSION_STATUSES as readonly string[]).includes(input.status)) errors.push({ in: "body", path: "/status", code: "not_in_enum", params: { expected: [...SUBMISSION_STATUSES] } });
  if (errors.length) throw validationFailed(errors);
  if (ifMatch !== null && ifMatch !== etagOfSubmission(s)) throw lockConflict();
  const to = input.status as SubmissionStatus;
  if (s.anonymized_at) throw invalidState("anonymized");
  if (to === s.status) return { data: submissionListItem(db, s), etag: etagOfSubmission(s) };
  if (!canMoveSubmission(s.status, to)) throw invalidState("invalid_transition", { from: s.status, to });
  applyStatus(db, s, to);
  return { data: submissionListItem(db, s), etag: etagOfSubmission(s) };
}

export function bulkSubmissionStatus(db: MockDb, body: unknown): BulkStatusResult {
  needUpdate(db, "POST", "/submissions/bulk-status");
  const state = submissionsState(db);
  state.bulkCalls += 1;
  if (state.bulkCalls > BULK_LIMIT) throw fail(429, "RATE_LIMITED", "Too many requests.", {}, { "Retry-After": "1800" });
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type", params: { expected: "object" } }]);
  const input = body as Record<string, unknown>;
  const errors: ApiFieldError[] = [];
  // SEC-P1-5: `ids` is gone (unknown_field); every item carries the ETag the caller last read.
  for (const k of Object.keys(input)) if (k !== "items" && k !== "status") errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  if (typeof input.status !== "string" || !(SUBMISSION_STATUSES as readonly string[]).includes(input.status)) errors.push({ in: "body", path: "/status", code: input.status === undefined ? "required" : "not_in_enum", params: { expected: [...SUBMISSION_STATUSES] } });
  const items = input.items;
  if (!Array.isArray(items) || items.length < 1) errors.push({ in: "body", path: "/items", code: items === undefined ? "required" : "too_short", params: { min: 1 } });
  else if (items.length > MAX_BULK_IDS) errors.push({ in: "body", path: "/items", code: "limit_exceeded", params: { max: MAX_BULK_IDS } });
  else {
    const seen = new Set<unknown>();
    items.forEach((it, i) => {
      const o = typeof it === "object" && it !== null && !Array.isArray(it) ? (it as Record<string, unknown>) : null;
      if (!o) {
        errors.push({ in: "body", path: `/items/${i}`, code: "invalid_type", params: { expected: "object" } });
        return;
      }
      for (const k of Object.keys(o)) if (k !== "id" && k !== "etag") errors.push({ in: "body", path: `/items/${i}/${k}`, code: "unknown_field" });
      if (typeof o.id !== "number" || !Number.isInteger(o.id)) errors.push({ in: "body", path: `/items/${i}/id`, code: "invalid_type", params: { expected: "integer" } });
      else if (o.id < 1) errors.push({ in: "body", path: `/items/${i}/id`, code: "out_of_range", params: { min: 1 } });
      else if (seen.has(o.id)) errors.push({ in: "body", path: `/items/${i}/id`, code: "duplicate" });
      seen.add(o.id);
      const tag = typeof o.etag === "string" ? o.etag.trim() : "";
      if (tag === "") errors.push({ in: "body", path: `/items/${i}/etag`, code: "required" });
      else if (tag === "*") errors.push({ in: "body", path: `/items/${i}/etag`, code: "invalid_format" });
    });
  }
  if (errors.length) throw validationFailed(errors);

  const to = input.status as SubmissionStatus;
  const result: BulkStatusResult = { updated: [], skipped: [], counts: { updated: 0, skipped: 0 } };
  for (const item of items as Array<{ id: number; etag: string }>) {
    const s = state.items.find((x) => x.id === item.id);
    if (!s) result.skipped.push({ id: item.id, reason: "not_found" });
    // A changed row is NOT written; it answers its current status and ETag so the caller can refresh.
    else if (item.etag.trim() !== etagOfSubmission(s)) result.skipped.push({ id: item.id, reason: "stale", from: s.status, etag: etagOfSubmission(s) });
    else if (s.anonymized_at) result.skipped.push({ id: item.id, reason: "anonymized", from: s.status });
    else if (s.status === to) result.skipped.push({ id: item.id, reason: "unchanged", from: s.status });
    else if (!canMoveSubmission(s.status, to)) result.skipped.push({ id: item.id, reason: "invalid_transition", from: s.status });
    else {
      applyStatus(db, s, to);
      result.updated.push({ id: item.id, status: to, etag: etagOfSubmission(s) });
    }
  }
  result.counts = { updated: result.updated.length, skipped: result.skipped.length };
  return result;
}

export function addSubmissionNote(db: MockDb, id: string, params: Params, body: unknown) {
  rejectUnknown(params, ["created_at"]);
  needUpdate(db, "POST", "/submissions/{id}/notes");
  const s = findRow(db, id, params);
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type", params: { expected: "object" } }]);
  const input = body as Record<string, unknown>;
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(input)) if (k !== "note") errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  const note = typeof input.note === "string" ? input.note.trim() : undefined;
  if (input.note === undefined) errors.push({ in: "body", path: "/note", code: "required" });
  else if (note === undefined) errors.push({ in: "body", path: "/note", code: "invalid_type", params: { expected: "string" } });
  else if (note === "") errors.push({ in: "body", path: "/note", code: "required" });
  else if (len(note) > MAX_NOTE) errors.push({ in: "body", path: "/note", code: "too_long", params: { max: MAX_NOTE } });
  else if (note.includes("\u0000")) errors.push({ in: "body", path: "/note", code: "invalid_format" });
  if (errors.length) throw validationFailed(errors);
  if (s.anonymized_at) throw invalidState("anonymized");
  const row: SubmissionNote = { id: submissionsState(db).nextNoteId++, note: note as string, author: MOCK_USER, created_at: tick(db) };
  // A note does not touch `updated_at`: the ETag of the row stays.
  s.notes.push(row);
  return { data: structuredClone(row), location: `/api/v1/submissions/${s.id}` };
}

// ---- export --------------------------------------------------------------------------------------------------------------
const BASE_COLUMNS = ["id", "public_id", "created_at", "form_slug", "locale_code", "status", "sender_name", "sender_email", "topic", "source_path", "handled_by_name", "handled_at", "retention_until", "retention_overdue"];

export function exportSubmissions(db: MockDb, params: Params): { csv: string; filename: string } {
  const state = submissionsState(db);
  if (!state.canExport) throw deny("export", "GET", "/submissions/export");
  state.exportCalls += 1;
  // The rate limit comes before everything else and is fail-closed (personal data).
  if (state.exportUnavailable) throw fail(503, "SERVICE_UNAVAILABLE", "The service is temporarily unavailable.", {}, { "Retry-After": "30" });
  if (state.exportCalls > EXPORT_LIMIT) throw fail(429, "RATE_LIMITED", "Too many requests.", {}, { "Retry-After": "3000" });
  rejectUnknown(params, ["keyword", "status", "form_id", "topic", "from", "to", "locale", "assigned_to", "mine"]);
  const locale = params.get("locale") ?? DEFAULT_LOCALE_CODE;
  const filter = parseFilter(db, params);
  const rows = matching(db, filter).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
  if (rows.length > state.exportMax) throw fail(422, "EXPORT_TOO_LARGE", "The export is too large.", { details: { matched: rows.length, max: state.exportMax } });

  const form = filter.formId !== undefined ? formOf(db, filter.formId) : undefined;
  const fieldColumns = form ? form.fields.map((f) => ({ key: f.key, head: `field:${labelFor(db, form, f.key, locale)}` })) : [];
  const head = [...BASE_COLUMNS, ...(form ? fieldColumns.map((c) => c.head) : ["data_json"])];
  const lines = [head.map(csvCell).join(",")];
  for (const s of rows) {
    const item = submissionListItem(db, s);
    const anon = s.anonymized_at !== null;
    const base = [
      item.id,
      item.public_id,
      item.created_at,
      item.form.slug,
      item.locale_code ?? "",
      item.status,
      item.sender_name ?? "",
      item.sender_email ?? "",
      item.topic ?? "",
      item.source_path ?? "",
      item.handled_by?.name ?? "",
      item.handled_at ?? "",
      item.retention_until,
      !anon && Date.parse(s.retention_until) < db.clock,
    ];
    const rest = form ? fieldColumns.map((c) => (anon ? "" : (s.data[c.key] ?? ""))) : [anon ? "" : JSON.stringify(s.data)];
    lines.push([...base, ...rest].map(csvCell).join(","));
  }
  // The audit row is written before the first byte; the keyword is never stored, only its length.
  const logged: Record<string, string | number> = {};
  for (const [k, v] of params.entries()) logged[k] = k === "keyword" ? `len:${len(v)}` : v;
  state.exportLog.push({ filter: logged, row_count: rows.length, columns: head.length });
  const stamp = new Date(db.clock).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return { csv: `﻿${lines.join("\r\n")}\r\n`, filename: `submissions-${stamp}.csv` };
}

// ---- helpers for the browser click-through and the tests -----------------------------------------------------------------
export function setSubmissionsRights(db: MockDb, rights: { update?: boolean; export?: boolean }) {
  const state = submissionsState(db);
  if (rights.update !== undefined) state.canUpdate = rights.update;
  if (rights.export !== undefined) state.canExport = rights.export;
}
// The next export is the sixth of the hour (429).
export function exhaustExportRate(db: MockDb) {
  submissionsState(db).exportCalls = EXPORT_LIMIT;
}
export function setExportUnavailable(db: MockDb, on: boolean) {
  submissionsState(db).exportUnavailable = on;
}
export function setExportMax(db: MockDb, max: number) {
  submissionsState(db).exportMax = max;
}
// Somebody else changed the status: the next PATCH with the old ETag is a 409.
export function touchSubmissionAsSomeoneElse(db: MockDb, id: number) {
  const s = submissionsState(db).items.find((x) => x.id === id);
  if (!s) throw notFound();
  s.updated_at = tick(db);
}
