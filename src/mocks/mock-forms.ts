// In-memory model of the forms endpoints (doc/05 section 13.6, 13.2, 13.6.5; backend materm-admin-backend/modules/forms):
// listForms, getForm, updateForm (PATCH: texts and settings only), replaceRecipients (PUT), publish / unpublish / discard-draft and
// the revisions, strict like the backend: an unknown query parameter or body field is 422 `unknown_field`, a schema field
// (`json_schema`, `field_order`...) is 422 `not_applicable`, `slug` / `status` are 422 `immutable`, no `If-Match` is 428, a stale one
// 409 `CONFLICT_LOCK_VERSION`, `INVALID_STATE` carries `details.reason`, a refused publish is `PUBLISH_BLOCKED` with JSON pointers.
//
// Two validators: the form's ETag is `"<lock_version>"` (PATCH, publish); `recipients_etag` is a hash of the recipient set and is
// the `If-Match` of `PUT /forms/{id}/recipients`, which does NOT move `lock_version` (13.6.4).
//
// The state lives in a WeakMap keyed by the `MockDb` object (`resetMockDb()` builds a new one, so a test starts clean) and is
// seeded on first use: this file adds nothing to `MockDb` / `createMockDb`.
//
// Seeded from the real seed (`0050_reference_content.sql`): form 1 `contact` (published, texts and field texts in la + en, recipients
// EMPTY, so the first save of recipients on the published form needs a catch-all `to`). INVENTED: form 2 `newsletter` (draft, only
// Lao texts) and form 3 `trek-booking` (published, a pending draft, recipients bound to topics), their authors and the history.
import {
  EMAIL_RE,
  HONEYPOT_RE,
  MAX_EMAIL,
  MAX_FIELD_LABEL,
  MAX_FORM_DESCRIPTION,
  MAX_FORM_NAME,
  MAX_FORM_TITLE,
  MAX_HELP,
  MAX_MESSAGES,
  MAX_MESSAGE_TEXT,
  MAX_OPTION_LABEL,
  MAX_PLACEHOLDER,
  MAX_RECIPIENTS,
  MAX_REDIRECT_URL,
  MAX_SENDING_LABEL,
  MAX_SUBMIT_LABEL,
  MAX_SUCCESS_AGAIN,
  MAX_SUCCESS_DESCRIPTION,
  MAX_SUCCESS_TITLE,
  MESSAGE_KEY_RE,
  RECIPIENT_KINDS,
  REDIRECT_RE,
  SETTING_RANGES,
  hasCatchAllRecipient,
  recipientKey,
} from "@/lib/forms";
import {
  DEFAULT_LOCALE_CODE,
  MOCK_ACTIVE_LOCALE_CODES,
  MOCK_LOCALE_CODES,
  MOCK_USER,
  boolParam,
  etagOf,
  fail,
  forbidden,
  invalidState,
  keyOf,
  lockConflict,
  micros,
  notFound,
  paginate,
  preconditionRequired,
  pushRevision,
  rejectUnknown,
  tick,
  validationFailed,
  type MockDb,
  type Params,
  type StoredRevision,
} from "@/mocks/mock-core";
import type { ApiFieldError } from "@/types/api";
import type {
  FormDetail,
  FormFieldDef,
  FormFieldTranslation,
  FormListItem,
  FormRecipient,
  FormSettings,
  FormTranslation,
  FormTopic,
  FormWarning,
} from "@/types/forms";
import type { UserRef } from "@/types/media";
import type { AggregateStamp, PublishIssue, PublishableStatus } from "@/types/publishing";
import type { RevisionSummary } from "@/types/revisions";

const MAX_ISSUES = 100;
const SEED_AT = micros(Date.UTC(2026, 9, 26, 9, 0, 0), 240);
const SOMCHAI: UserRef = { id: 4, name: "Somchai Vongsa" };
const DARA: UserRef = { id: 7, name: "Dara Phommachan" };
const ENTITY = "forms.forms";

// ---- the model -----------------------------------------------------------------------------------------------------------
type SettingsKeys = "name" | "store_submissions" | "retention_days" | "honeypot_field" | "rate_limit_max" | "rate_limit_window_s" | "rate_limit_daily_max" | "min_fill_seconds" | "notify_enabled" | "success_redirect_url";
export type MockFormSnapshot = {
  // Everything the PATCH can change besides the texts (the snapshot of 13.6.3: `form.*`).
  form: Pick<FormSettings, Exclude<SettingsKeys, "name">> & { name: string };
  translations: Array<FormTranslation & { locale_code: string }>;
  field_translations: Array<FormFieldTranslation & { field_key: string; locale_code: string }>;
};

export type MockFormRoot = {
  id: number;
  public_id: string;
  slug: string;
  is_system: boolean;
  status: PublishableStatus;
  lock_version: number;
  published_at: string | null;
  first_published_at: string | null;
  unpublished_at: string | null;
  created_by: UserRef;
  updated_by: UserRef;
  created_at: string;
  updated_at: string;
  schema_version: number;
  fields: FormFieldDef[];
  recipients: FormRecipient[];
  // Fixed system values (13.6.1 `settings`).
  retention_mode: string;
  max_payload_bytes: number;
  live: MockFormSnapshot;
};

// The role of the signed-in user for the forms: an editor (every action), a translator (`read` + `translate`: texts only, all
// languages) or a reader (`read`).
export type MockFormsRole = "editor" | "translator" | "reader";

export type FormsState = { forms: MockFormRoot[]; nextRecipientId: number; role: MockFormsRole };

const states = new WeakMap<MockDb, FormsState>();

export function formsState(db: MockDb): FormsState {
  let state = states.get(db);
  if (!state) {
    state = { forms: [], nextRecipientId: 1, role: "editor" };
    states.set(db, state);
    seed(db, state);
  }
  return state;
}

export const formsRole = (db: MockDb): MockFormsRole => (db.translateOnly.includes("forms") ? "translator" : formsState(db).role);
export const setFormsRole = (db: MockDb, role: MockFormsRole) => {
  formsState(db).role = role;
};

// ---- seeds ---------------------------------------------------------------------------------------------------------------
const baseSettings = (name: string, honeypot: string | null): MockFormSnapshot["form"] => ({
  name,
  store_submissions: true,
  retention_days: 365,
  honeypot_field: honeypot,
  rate_limit_max: 5,
  rate_limit_window_s: 600,
  rate_limit_daily_max: 50,
  min_fill_seconds: 3,
  notify_enabled: true,
  success_redirect_url: null,
});

const text = (title: string, submit: string, rest: Partial<FormTranslation> = {}): FormTranslation => ({
  title,
  description: null,
  submit_label: submit,
  sending_label: null,
  success_title: null,
  success_description: null,
  success_again_label: null,
  messages: {},
  ...rest,
});

const field = (key: string, type: FormFieldDef["type"], rest: Partial<FormFieldDef> = {}): FormFieldDef => ({
  key,
  type,
  required: false,
  min_length: null,
  max_length: null,
  pattern: null,
  options: null,
  pii: false,
  ...rest,
});

const label = (label: string, rest: Partial<FormFieldTranslation> = {}): FormFieldTranslation => ({ label, placeholder: null, help: null, option_labels: {}, ...rest });

const CONTACT_MESSAGES = {
  required: "This field is required",
  email: "Enter a valid email address",
  messageShort: "Please write at least 10 characters",
  phone: "Enter a valid phone number",
  generic: "Something went wrong. Please try again.",
  summary: "Please check the highlighted fields.",
};

function snapshotOf(form: MockFormSnapshot["form"], translations: Record<string, FormTranslation>, fields: Record<string, Record<string, FormFieldTranslation>>): MockFormSnapshot {
  return {
    form,
    translations: Object.entries(translations).map(([locale_code, t]) => ({ locale_code, ...t })),
    field_translations: Object.entries(fields).flatMap(([field_key, byLocale]) => Object.entries(byLocale).map(([locale_code, t]) => ({ field_key, locale_code, ...t }))),
  };
}

function seed(db: MockDb, state: FormsState) {
  const publicId = (id: number) => `0192d3a4-7c1e-7b52-9d0a-fa${String(id).padStart(10, "0")}`;
  const root = (id: number, slug: string, status: PublishableStatus, createdBy: UserRef, fields: FormFieldDef[], live: MockFormSnapshot, extra: Partial<MockFormRoot> = {}): MockFormRoot => ({
    id,
    public_id: publicId(id),
    slug,
    is_system: slug === "contact",
    status,
    lock_version: 1,
    published_at: status === "published" ? "2026-01-01T07:00:00.000000+07:00" : null,
    first_published_at: status === "published" ? "2026-01-01T07:00:00.000000+07:00" : null,
    unpublished_at: null,
    created_by: createdBy,
    updated_by: createdBy,
    created_at: SEED_AT,
    updated_at: SEED_AT,
    schema_version: 1,
    fields,
    recipients: [],
    retention_mode: "anonymize",
    max_payload_bytes: 16384,
    live,
    ...extra,
  });

  // 1 - the real seed (recipients stay EMPTY, created_by null).
  const contactTexts = (): FormTranslation =>
    text("Send a message", "Send message", {
      description: "We usually reply within two working days.",
      sending_label: "Sending…",
      success_title: "Thank you!",
      success_description: "Your message is on its way. We'll reply as soon as we can.",
      success_again_label: "Send another message",
      messages: { ...CONTACT_MESSAGES },
    });
  const topicLabels = { booking: "Booking & stays", events: "Music nights & events", camping: "Camping & treks", other: "Something else" };
  const contactFieldTexts = (): Record<string, FormFieldTranslation> => ({
    name: label("Full name", { placeholder: "Your name" }),
    email: label("Email", { placeholder: "you@example.com" }),
    phone: label("Phone (optional)", { placeholder: "+856 20 0000 0000" }),
    topic: label("What is it about?", { option_labels: { ...topicLabels } }),
    message: label("Message", { placeholder: "Tell us how we can help…" }),
  });
  const contact = root(
    1,
    "contact",
    "published",
    null,
    [
      field("name", "text", { required: true, min_length: 2, max_length: 100, pii: true }),
      field("email", "email", { required: true, max_length: 254, pii: true }),
      field("phone", "tel", { max_length: 30, pattern: "^[0-9 +()\\-.]+$", pii: true }),
      field("topic", "select", { required: true, options: ["booking", "events", "camping", "other"] }),
      field("message", "textarea", { required: true, min_length: 10, max_length: 2000, pii: true }),
    ],
    snapshotOf(
      baseSettings("Contact form", "company"),
      { la: contactTexts(), en: contactTexts() },
      Object.fromEntries(Object.keys(contactFieldTexts()).map((k) => [k, { la: contactFieldTexts()[k], en: contactFieldTexts()[k] }]))
    )
  );

  // 2 - INVENTED: a newsletter form nobody finished (Lao texts only, no recipients: fine while it is a draft).
  const newsletter = root(
    2,
    "newsletter",
    "draft",
    SOMCHAI,
    [field("email", "email", { required: true, max_length: 254, pii: true }), field("consent", "consent", { required: true })],
    snapshotOf(
      { ...baseSettings("Newsletter", "website"), notify_enabled: false },
      { la: text("Stay in touch", "Subscribe") },
      { email: { la: label("Email", { placeholder: "you@example.com" }) }, consent: { la: label("I agree to receive the newsletter") } }
    ),
    { created_at: micros(Date.UTC(2026, 9, 24, 8, 0, 0), 5), updated_at: micros(Date.UTC(2026, 9, 25, 8, 0, 0), 6), updated_by: SOMCHAI }
  );

  // 3 - INVENTED: a published trek booking form with recipients bound to topics and a pending draft.
  const trekTopics = { trek: "Day trek", camp: "Camp stay" };
  const trekFieldTexts = (): Record<string, Record<string, FormFieldTranslation>> => ({
    name: { la: label("Your name"), en: label("Your name") },
    email: { la: label("Email"), en: label("Email") },
    topic: { la: label("Booking type", { option_labels: { ...trekTopics } }), en: label("Booking type", { option_labels: { ...trekTopics } }) },
    group_size: { la: label("Group size", { option_labels: { "1-2": "1 to 2", "3-5": "3 to 5", "6+": "6 or more" } }), en: label("Group size", { option_labels: { "1-2": "1 to 2", "3-5": "3 to 5", "6+": "6 or more" } }) },
    notes: { la: label("Anything we should know?"), en: label("Anything we should know?") },
  });
  const trek = root(
    3,
    "trek-booking",
    "published",
    DARA,
    [
      field("name", "text", { required: true, max_length: 100, pii: true }),
      field("email", "email", { required: true, max_length: 254, pii: true }),
      field("topic", "select", { required: true, options: ["trek", "camp"] }),
      field("group_size", "select", { required: true, options: ["1-2", "3-5", "6+"] }),
      field("notes", "textarea", { max_length: 1000, pii: true }),
    ],
    snapshotOf(baseSettings("Trek booking", "nickname"), { la: text("Book a trek", "Send request"), en: text("Book a trek", "Send request") }, trekFieldTexts()),
    { lock_version: 3, updated_at: micros(Date.UTC(2026, 9, 27, 7, 0, 0), 9), updated_by: MOCK_USER, published_at: "2026-09-01T10:00:00.000000+07:00", first_published_at: "2026-09-01T10:00:00.000000+07:00" }
  );
  trek.recipients = [
    { id: state.nextRecipientId++, email: "bookings@materm.example", kind: "to", topic_value: null, is_active: true },
    { id: state.nextRecipientId++, email: "treks@materm.example", kind: "to", topic_value: "trek", is_active: true },
    { id: state.nextRecipientId++, email: "camp@materm.example", kind: "cc", topic_value: "camp", is_active: true },
    { id: state.nextRecipientId++, email: "old-manager@materm.example", kind: "bcc", topic_value: null, is_active: false },
  ];
  state.forms.push(contact, newsletter, trek);

  // history
  pushRevision(db, "forms", 1, ENTITY, "published", structuredClone(contact.live), null, "2026-01-01T07:00:00.000000+07:00", SOMCHAI);
  pushRevision(db, "forms", 3, ENTITY, "published", structuredClone(trek.live), null, "2026-09-01T10:00:00.000000+07:00", DARA);
  const older = structuredClone(trek.live);
  older.translations.forEach((t) => (t.submit_label = "Send"));
  pushRevision(db, "forms", 3, ENTITY, "history", older, "autosave", micros(Date.UTC(2026, 9, 20, 8, 0, 0), 3), DARA);
  const draft = structuredClone(trek.live);
  draft.form.name = "Trek booking (2027 season)";
  draft.translations.forEach((t) => (t.title = "Book a trek for 2027"));
  pushRevision(db, "forms", 3, ENTITY, "draft", draft, null, micros(Date.UTC(2026, 9, 27, 7, 0, 0), 9), MOCK_USER);
  // A snapshot saved by a newer schema: restoring it is refused (`snapshot_incompatible`).
  pushRevision(db, "forms", 1, ENTITY, "history", { future: true }, null, micros(Date.UTC(2026, 9, 25, 8, 0, 0), 1), null, 99);
}

// ---- views ---------------------------------------------------------------------------------------------------------------
const revList = (db: MockDb, root: MockFormRoot) => (db.revisions[keyOf("forms", root.id)] ??= []);
export const formDraftRow = (db: MockDb, root: MockFormRoot): StoredRevision | undefined => revList(db, root).find((r) => r.kind === "draft");
export const formWorking = (db: MockDb, root: MockFormRoot): MockFormSnapshot => (formDraftRow(db, root)?.snapshot as unknown as MockFormSnapshot | undefined) ?? root.live;
const hasDraft = (db: MockDb, root: MockFormRoot) => root.status === "published" && Boolean(formDraftRow(db, root));
const etagOfForm = (root: MockFormRoot) => etagOf(String(root.lock_version));

// A short stable hash of the recipient set (the real one is a sha256 prefix over the sorted keys); quoted like the backend's.
export function recipientsEtag(list: FormRecipient[]): string {
  const text = list.map(recipientKey).sort().join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `"${h.toString(16).padStart(8, "0")}${text.length.toString(16).padStart(8, "0")}"`;
}

const activeCount = (root: MockFormRoot) => root.recipients.filter((r) => r.is_active).length;
const userRef = (u: UserRef): UserRef => (u ? { id: u.id, name: u.name } : null);

function translationsOf(snapshot: MockFormSnapshot): Record<string, FormTranslation> {
  return Object.fromEntries(snapshot.translations.map(({ locale_code, ...t }) => [locale_code, structuredClone(t)]));
}
function fieldTranslationsOf(snapshot: MockFormSnapshot): Record<string, Record<string, FormFieldTranslation>> {
  const out: Record<string, Record<string, FormFieldTranslation>> = {};
  for (const { field_key, locale_code, ...t } of snapshot.field_translations) (out[field_key] ??= {})[locale_code] = structuredClone(t);
  return out;
}

function topicsOf(root: MockFormRoot, snapshot: MockFormSnapshot): FormTopic[] {
  const topic = root.fields.find((f) => f.key === "topic");
  if (!topic?.options) return [];
  return topic.options.map((value) => ({
    value,
    labels: Object.fromEntries(snapshot.field_translations.filter((t) => t.field_key === "topic" && t.option_labels[value]).map((t) => [t.locale_code, t.option_labels[value]])),
    notify_override: root.recipients.filter((r) => r.topic_value === value).map((r) => r.email),
  }));
}

// The "new messages" count of a form comes from the submissions model when it has been created (see `mock-submissions.ts`).
let newCountOf: (db: MockDb, formId: number) => number = () => 0;
export function bindNewSubmissionCount(fn: (db: MockDb, formId: number) => number) {
  newCountOf = fn;
}

export function formListItem(db: MockDb, root: MockFormRoot, withSubmissions = true): FormListItem {
  const draft = formDraftRow(db, root);
  const item: FormListItem = {
    id: root.id,
    public_id: root.public_id,
    slug: root.slug,
    name: formWorking(db, root).form.name,
    is_system: root.is_system,
    recipient_count: activeCount(root),
    draft: hasDraft(db, root) && draft ? { revision_id: draft.id, version: draft.version, created_at: draft.created_at, created_by: userRef(draft.created_by) } : null,
    status: root.status,
    lock_version: root.lock_version,
    has_unpublished_changes: hasDraft(db, root),
    published_at: root.published_at,
    first_published_at: root.first_published_at,
    scheduled_at: null,
    unpublished_at: root.unpublished_at,
    created_by: userRef(root.created_by),
    updated_by: userRef(root.updated_by),
    created_at: root.created_at,
    updated_at: root.updated_at,
  };
  if (withSubmissions) item.submissions_new = newCountOf(db, root.id);
  return item;
}

export function formDetail(db: MockDb, root: MockFormRoot): FormDetail {
  const snap = formWorking(db, root);
  const { name: _name, ...settings } = snap.form;
  void _name;
  return {
    ...formListItem(db, root),
    settings: { ...settings, retention_mode: root.retention_mode, max_payload_bytes: root.max_payload_bytes },
    schema_version: root.schema_version,
    fields: structuredClone(root.fields),
    topics: topicsOf(root, snap),
    translations: translationsOf(snap),
    field_translations: fieldTranslationsOf(snap),
    recipients: structuredClone(root.recipients),
    recipients_etag: recipientsEtag(root.recipients),
    missing_locales: MOCK_ACTIVE_LOCALE_CODES.filter((c) => !snap.translations.some((t) => t.locale_code === c)),
  };
}

const stampOf = (db: MockDb, root: MockFormRoot): AggregateStamp => ({
  entity_type: ENTITY,
  id: root.id,
  lock_version: root.lock_version,
  status: root.status,
  has_unpublished_changes: hasDraft(db, root),
  updated_at: root.updated_at,
});
const writeResult = (db: MockDb, root: MockFormRoot, warnings: FormWarning[] = []) => ({ ...formDetail(db, root), aggregate: stampOf(db, root), warnings });

export function findForm(db: MockDb, id: string): MockFormRoot {
  const root = formsState(db).forms.find((f) => String(f.id) === id);
  if (!root) throw notFound();
  return root;
}

const deny = (action: string, method: string, path: string) => forbidden(`forms.manage:${action} ${method} ${path}`);
function requireMatch(ifMatch: string | null, root: MockFormRoot) {
  if (!ifMatch) throw preconditionRequired();
  if (ifMatch !== etagOfForm(root)) throw lockConflict();
}
function touch(db: MockDb, root: MockFormRoot): string {
  const stamp = tick(db);
  root.lock_version += 1;
  root.updated_at = stamp;
  root.updated_by = MOCK_USER;
  return stamp;
}
const issue = (path: string, code: string, params: PublishIssue["params"] = {}, blocker = true): PublishIssue =>
  blocker ? { in: "entity", path, code, params } : { path, code, params };
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === "";

// ---- GET /forms, GET /forms/{id} -----------------------------------------------------------------------------------------
const STATUSES = ["draft", "in_review", "scheduled", "published", "archived"];
const SORTS = ["slug", "name", "updated_at", "status"];

export function listForms(db: MockDb, params: Params) {
  rejectUnknown(params, ["page", "limit", "keyword", "status", "has_unpublished_changes", "sort"]);
  const errors: ApiFieldError[] = [];
  const pending = boolParam(params, "has_unpublished_changes");
  const keyword = params.get("keyword")?.trim().toLowerCase();
  if (keyword && [...keyword].length > 100) errors.push({ in: "query", path: "/keyword", code: "too_long", params: { max: 100 } });
  const statuses = params.get("status")?.split(",").filter(Boolean);
  if (statuses && (statuses.length > 5 || statuses.some((s) => !STATUSES.includes(s)))) errors.push({ in: "query", path: "/status", code: "not_in_enum", params: { expected: STATUSES } });
  const sort = params.get("sort") ?? "slug";
  const field = sort.startsWith("-") ? sort.slice(1) : sort;
  if (!SORTS.includes(field)) errors.push({ in: "query", path: "/sort", code: "not_in_enum", params: { expected: SORTS } });
  if (errors.length) throw validationFailed(errors);

  let rows = formsState(db).forms.map((r) => formListItem(db, r));
  if (keyword) rows = rows.filter((r) => r.slug.toLowerCase().includes(keyword) || r.name.toLowerCase().includes(keyword));
  if (statuses?.length) rows = rows.filter((r) => statuses.includes(r.status));
  if (pending !== undefined) rows = rows.filter((r) => r.has_unpublished_changes === pending);
  const dir = sort.startsWith("-") ? -1 : 1;
  const key = field as "slug" | "name" | "updated_at" | "status";
  rows.sort((a, b) => dir * String(a[key]).localeCompare(String(b[key])) || a.id - b.id);
  return paginate(rows, params);
}

export function getForm(db: MockDb, id: string) {
  const root = findForm(db, id);
  return { data: formDetail(db, root), etag: etagOfForm(root) };
}

// ---- PATCH /forms/{id} ---------------------------------------------------------------------------------------------------
const NOT_APPLICABLE = ["json_schema", "field_order", "schema_version", "retention_mode", "max_payload_bytes", "extra_settings"];
const IMMUTABLE = ["slug", "status"];
const SETTING_KEYS: SettingsKeys[] = ["name", "store_submissions", "retention_days", "honeypot_field", "rate_limit_max", "rate_limit_window_s", "rate_limit_daily_max", "min_fill_seconds", "notify_enabled", "success_redirect_url"];
const TEXT_LIMITS: Record<string, [number, number, boolean]> = {
  title: [1, MAX_FORM_TITLE, false],
  submit_label: [1, MAX_SUBMIT_LABEL, false],
  description: [0, MAX_FORM_DESCRIPTION, true],
  sending_label: [0, MAX_SENDING_LABEL, true],
  success_title: [0, MAX_SUCCESS_TITLE, true],
  success_description: [0, MAX_SUCCESS_DESCRIPTION, true],
  success_again_label: [0, MAX_SUCCESS_AGAIN, true],
};
const len = (v: string) => [...v].length;

function textProblem(value: unknown, path: string, [min, max, nullable]: [number, number, boolean], errors: ApiFieldError[]): string | null | undefined {
  if (value === null) {
    if (!nullable) errors.push({ in: "body", path, code: "required" });
    return nullable ? null : undefined;
  }
  if (typeof value !== "string") {
    errors.push({ in: "body", path, code: "invalid_type", params: { expected: "string" } });
    return undefined;
  }
  const v = value.trim();
  if (len(v) < min || (min > 0 && v === "")) errors.push({ in: "body", path, code: v === "" ? "required" : "too_short", ...(v === "" ? {} : { params: { min } }) });
  else if (len(v) > max) errors.push({ in: "body", path, code: "too_long", params: { max } });
  // Nullable texts: an empty string is "cleared" = null.
  return v === "" && nullable ? null : v;
}

function mapProblem(value: unknown, path: string, errors: ApiFieldError[], opts: { maxEntries?: number; keyRe?: RegExp; maxValue: number; allowedKeys?: string[] }): Record<string, string> | undefined {
  if (!isObject(value)) {
    errors.push({ in: "body", path, code: "invalid_type", params: { expected: "object" } });
    return undefined;
  }
  const entries = Object.entries(value);
  if (opts.maxEntries !== undefined && entries.length > opts.maxEntries) errors.push({ in: "body", path, code: "too_long", params: { max: opts.maxEntries, unit: "items" } });
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    const p = `${path}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`;
    if (opts.keyRe && !opts.keyRe.test(k)) errors.push({ in: "body", path: p, code: "pattern_mismatch" });
    else if (opts.allowedKeys && !opts.allowedKeys.includes(k)) errors.push({ in: "body", path: p, code: "not_in_enum", params: { expected: opts.allowedKeys } });
    if (typeof v !== "string") errors.push({ in: "body", path: p, code: "invalid_type", params: { expected: "string" } });
    else if (len(v) > opts.maxValue) errors.push({ in: "body", path: p, code: "too_long", params: { max: opts.maxValue } });
    else out[k] = v;
  }
  return out;
}

export function patchForm(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
  const root = findForm(db, id);
  const role = formsRole(db);
  if (role === "reader") throw deny("update", "PATCH", "/forms/{id}");
  requireMatch(ifMatch, root);
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type", params: { expected: "object" } }]);
  const errors: ApiFieldError[] = [];
  const known = [...SETTING_KEYS, "translations", "field_translations"];
  for (const k of Object.keys(body)) {
    if (NOT_APPLICABLE.includes(k)) errors.push({ in: "body", path: `/${k}`, code: "not_applicable" });
    else if (IMMUTABLE.includes(k)) errors.push({ in: "body", path: `/${k}`, code: "immutable" });
    else if (!known.includes(k)) errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  }
  if (errors.length) throw validationFailed(errors);
  if (Object.keys(body).length === 0) throw validationFailed([{ in: "body", path: "", code: "too_few_properties", params: { min: 1 } }]);

  const before = formWorking(db, root);
  // A translator may only send texts; a settings value that differs from the current one is a 403.
  if (role === "translator") {
    for (const k of SETTING_KEYS) if (k in body && JSON.stringify(body[k]) !== JSON.stringify(before.form[k])) throw deny("update", "PATCH", "/forms/{id}");
  }
  const next: MockFormSnapshot = structuredClone(before);

  // settings
  const num = (k: keyof typeof SETTING_RANGES) => {
    if (!(k in body)) return;
    const v = body[k];
    const [min, max] = SETTING_RANGES[k];
    if (typeof v !== "number" || !Number.isInteger(v)) errors.push({ in: "body", path: `/${k}`, code: "invalid_type", params: { expected: "integer" } });
    else if (v < min || v > max) errors.push({ in: "body", path: `/${k}`, code: "out_of_range", params: { min, max } });
    else (next.form as Record<string, unknown>)[k] = v;
  };
  if ("name" in body) {
    const v = textProblem(body.name, "/name", [1, MAX_FORM_NAME, false], errors);
    if (typeof v === "string") next.form.name = v;
  }
  for (const k of ["store_submissions", "notify_enabled"] as const) {
    if (!(k in body)) continue;
    if (typeof body[k] !== "boolean") errors.push({ in: "body", path: `/${k}`, code: "invalid_type", params: { expected: "boolean" } });
    else next.form[k] = body[k];
  }
  (["retention_days", "rate_limit_max", "rate_limit_window_s", "rate_limit_daily_max", "min_fill_seconds"] as const).forEach(num);
  if ("honeypot_field" in body) {
    const v = body.honeypot_field;
    if (v === null) next.form.honeypot_field = null;
    else if (typeof v !== "string" || !HONEYPOT_RE.test(v)) errors.push({ in: "body", path: "/honeypot_field", code: "pattern_mismatch" });
    else if (root.fields.some((f) => f.key === v)) errors.push({ in: "body", path: "/honeypot_field", code: "duplicate", params: { reason: "field" } });
    else next.form.honeypot_field = v;
  }
  if ("success_redirect_url" in body) {
    const v = body.success_redirect_url;
    if (v === null || v === "") next.form.success_redirect_url = null;
    else if (typeof v !== "string") errors.push({ in: "body", path: "/success_redirect_url", code: "invalid_type", params: { expected: "string" } });
    else if (len(v) > MAX_REDIRECT_URL) errors.push({ in: "body", path: "/success_redirect_url", code: "too_long", params: { max: MAX_REDIRECT_URL } });
    else if (!REDIRECT_RE.test(v)) errors.push({ in: "body", path: "/success_redirect_url", code: "pattern_mismatch" });
    else next.form.success_redirect_url = v;
  }
  if (next.form.store_submissions === false && activeCount(root) === 0 && !errors.some((e) => e.path === "/store_submissions")) {
    if ("store_submissions" in body) errors.push({ in: "body", path: "/store_submissions", code: "recipients_required" });
  }

  // translations
  if ("translations" in body) {
    if (!isObject(body.translations)) errors.push({ in: "body", path: "/translations", code: "invalid_type", params: { expected: "object" } });
    else {
      for (const [code, patch] of Object.entries(body.translations)) {
        const base = `/translations/${code}`;
        if (!/^[a-z]{2,3}$/.test(code)) {
          errors.push({ in: "body", path: base, code: "invalid_format" });
          continue;
        }
        if (!(MOCK_LOCALE_CODES as readonly string[]).includes(code)) {
          errors.push({ in: "body", path: base, code: "unknown_reference" });
          continue;
        }
        const idx = next.translations.findIndex((t) => t.locale_code === code);
        if (patch === null) {
          if (idx < 0) continue;
          if (code === DEFAULT_LOCALE_CODE) errors.push({ in: "body", path: base, code: "required" });
          else next.translations.splice(idx, 1);
          continue;
        }
        if (!isObject(patch)) {
          errors.push({ in: "body", path: base, code: "invalid_type", params: { expected: "object" } });
          continue;
        }
        const row = idx >= 0 ? next.translations[idx] : { locale_code: code, ...text("", ""), };
        for (const [k, v] of Object.entries(patch)) {
          if (k === "messages") {
            const m = mapProblem(v, `${base}/messages`, errors, { maxEntries: MAX_MESSAGES, keyRe: MESSAGE_KEY_RE, maxValue: MAX_MESSAGE_TEXT });
            if (m) row.messages = m;
          } else if (TEXT_LIMITS[k]) {
            const t = textProblem(v, `${base}/${k}`, TEXT_LIMITS[k], errors);
            if (t !== undefined) (row as Record<string, unknown>)[k] = t;
          } else errors.push({ in: "body", path: `${base}/${k}`, code: "unknown_field" });
        }
        if (idx < 0) {
          if (blank(row.title) && !("title" in patch)) errors.push({ in: "body", path: `${base}/title`, code: "required" });
          if (blank(row.submit_label) && !("submit_label" in patch)) errors.push({ in: "body", path: `${base}/submit_label`, code: "required" });
          next.translations.push(row);
        }
      }
    }
  }

  // field translations
  if ("field_translations" in body) {
    if (!isObject(body.field_translations)) errors.push({ in: "body", path: "/field_translations", code: "invalid_type", params: { expected: "object" } });
    else {
      for (const [key, byLocale] of Object.entries(body.field_translations)) {
        const base = `/field_translations/${key}`;
        const def = root.fields.find((f) => f.key === key);
        if (!def) {
          errors.push({ in: "body", path: base, code: "unknown_reference" });
          continue;
        }
        if (!isObject(byLocale)) {
          errors.push({ in: "body", path: base, code: "invalid_type", params: { expected: "object" } });
          continue;
        }
        for (const [code, patch] of Object.entries(byLocale)) {
          const p = `${base}/${code}`;
          if (!(MOCK_LOCALE_CODES as readonly string[]).includes(code)) {
            errors.push({ in: "body", path: p, code: "unknown_reference" });
            continue;
          }
          const idx = next.field_translations.findIndex((t) => t.field_key === key && t.locale_code === code);
          if (patch === null) {
            if (idx < 0) continue;
            if (code === DEFAULT_LOCALE_CODE) errors.push({ in: "body", path: p, code: "required" });
            else next.field_translations.splice(idx, 1);
            continue;
          }
          if (!isObject(patch)) {
            errors.push({ in: "body", path: p, code: "invalid_type", params: { expected: "object" } });
            continue;
          }
          const row = idx >= 0 ? next.field_translations[idx] : { field_key: key, locale_code: code, ...label("") };
          for (const [k, v] of Object.entries(patch)) {
            if (k === "label") {
              const t = textProblem(v, `${p}/label`, [1, MAX_FIELD_LABEL, false], errors);
              if (typeof t === "string") row.label = t;
            } else if (k === "placeholder" || k === "help") {
              const t = textProblem(v, `${p}/${k}`, [0, k === "help" ? MAX_HELP : MAX_PLACEHOLDER, true], errors);
              if (t !== undefined) row[k] = t;
            } else if (k === "option_labels") {
              const m = mapProblem(v, `${p}/option_labels`, errors, { maxValue: MAX_OPTION_LABEL, allowedKeys: def.options ?? [] });
              if (m) row.option_labels = m;
            } else errors.push({ in: "body", path: `${p}/${k}`, code: "unknown_field" });
          }
          if (idx < 0) {
            if (!("label" in patch)) errors.push({ in: "body", path: `${p}/label`, code: "required" });
            next.field_translations.push(row);
          }
        }
      }
    }
  }
  if (errors.length) throw validationFailed(errors);

  // Nothing changed: 200 with the same ETag, no side effect.
  if (JSON.stringify(next) === JSON.stringify(before)) return { data: writeResult(db, root), etag: etagOfForm(root) };

  const stamp = tick(db);
  if (root.status === "published") {
    const draft = formDraftRow(db, root);
    if (draft) draft.snapshot = next as unknown as Record<string, unknown>;
    else pushRevision(db, "forms", root.id, ENTITY, "draft", next as unknown as Record<string, unknown>, null, stamp, MOCK_USER);
  } else {
    root.live = next;
  }
  root.lock_version += 1;
  root.updated_at = stamp;
  root.updated_by = MOCK_USER;
  return { data: writeResult(db, root), etag: etagOfForm(root) };
}

// ---- PUT /forms/{id}/recipients ------------------------------------------------------------------------------------------
export function replaceRecipients(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
  const root = findForm(db, id);
  if (formsRole(db) !== "editor") throw deny("update", "PUT", "/forms/{id}/recipients");
  if (!ifMatch) throw preconditionRequired();
  if (ifMatch !== recipientsEtag(root.recipients)) throw lockConflict();
  const errors: ApiFieldError[] = [];
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type", params: { expected: "object" } }]);
  for (const k of Object.keys(body)) if (k !== "recipients") errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  if (!Array.isArray(body.recipients)) {
    errors.push({ in: "body", path: "/recipients", code: Object.keys(body).includes("recipients") ? "invalid_type" : "required" });
    throw validationFailed(errors);
  }
  const list = body.recipients as unknown[];
  if (list.length > MAX_RECIPIENTS) errors.push({ in: "body", path: "/recipients", code: "limit_exceeded", params: { max: MAX_RECIPIENTS } });
  const topics = root.fields.find((f) => f.key === "topic")?.options ?? [];
  const next: FormRecipient[] = [];
  const seen = new Set<string>();
  list.forEach((raw, i) => {
    const p = `/recipients/${i}`;
    if (!isObject(raw)) {
      errors.push({ in: "body", path: p, code: "invalid_type", params: { expected: "object" } });
      return;
    }
    for (const k of Object.keys(raw)) if (!["email", "kind", "topic_value", "is_active"].includes(k)) errors.push({ in: "body", path: `${p}/${k}`, code: "unknown_field" });
    const email = typeof raw.email === "string" ? raw.email.trim() : "";
    if (typeof raw.email !== "string" || email === "") errors.push({ in: "body", path: `${p}/email`, code: "required" });
    else if (len(email) > MAX_EMAIL) errors.push({ in: "body", path: `${p}/email`, code: "too_long", params: { max: MAX_EMAIL } });
    else if (!EMAIL_RE.test(email)) errors.push({ in: "body", path: `${p}/email`, code: "invalid_format" });
    const kind = raw.kind === undefined ? "to" : raw.kind;
    if (typeof kind !== "string" || !(RECIPIENT_KINDS as readonly string[]).includes(kind)) errors.push({ in: "body", path: `${p}/kind`, code: "not_in_enum", params: { expected: [...RECIPIENT_KINDS] } });
    const topic = raw.topic_value === undefined ? null : raw.topic_value;
    if (topic !== null && (typeof topic !== "string" || !topics.includes(topic))) errors.push({ in: "body", path: `${p}/topic_value`, code: "not_in_enum", params: { expected: topics } });
    if (raw.is_active !== undefined && typeof raw.is_active !== "boolean") errors.push({ in: "body", path: `${p}/is_active`, code: "invalid_type", params: { expected: "boolean" } });
    if (errors.some((e) => e.path.startsWith(p))) return;
    const row: FormRecipient = { email, kind: kind as FormRecipient["kind"], topic_value: topic as string | null, is_active: raw.is_active !== false };
    const key = `${email.toLowerCase()}\u001f${row.kind}\u001f${row.topic_value ?? ""}`;
    if (seen.has(key)) errors.push({ in: "body", path: p, code: "duplicate" });
    seen.add(key);
    next.push(row);
  });
  if (errors.length) throw validationFailed(errors);
  // BR-34: a published form (or one that does not keep its submissions) needs an active catch-all `to`.
  if ((root.status === "published" || !formWorking(db, root).form.store_submissions) && !hasCatchAllRecipient(next)) {
    throw validationFailed([{ in: "body", path: "/recipients", code: "recipients_required" }]);
  }
  if (recipientsEtag(next) === recipientsEtag(root.recipients)) return { data: { recipients: structuredClone(root.recipients), recipients_etag: recipientsEtag(root.recipients) }, etag: recipientsEtag(root.recipients) };
  const state = formsState(db);
  root.recipients = next.map((r) => {
    const same = root.recipients.find((o) => recipientKey({ ...o, is_active: true }) === recipientKey({ ...r, is_active: true }));
    return { id: same?.id ?? state.nextRecipientId++, ...r };
  });
  // No `touch`: the form's ETag and `lock_version` stay (13.6.4).
  return { data: { recipients: structuredClone(root.recipients), recipients_etag: recipientsEtag(root.recipients) }, etag: recipientsEtag(root.recipients) };
}

// ---- publish engine (05 12.7 instantiated by 13.6.5) -----------------------------------------------------------------------
// Pages that name this form in a `contact_section` (`props.form_slug`): what blocks an unpublish without a confirmation (PT-8).
export function formReferences(db: MockDb, root: MockFormRoot) {
  const refs: Array<{ entity_type: string; id: number; title: string | null; field: string; kind: string; in_draft: boolean }> = [];
  for (const page of db.pages) {
    if (page.deleted_at) continue;
    const uses = page.live.sections.some((s) => s.section_type === "contact_section" && (s.props as { form_slug?: unknown }).form_slug === root.slug);
    if (!uses) continue;
    const t = page.live.translations.find((x) => x.locale_code === DEFAULT_LOCALE_CODE) ?? page.live.translations[0];
    refs.push({ entity_type: "cms.pages", id: page.id, title: t?.title ?? page.live.page.name, field: "form_slug", kind: "section_props", in_draft: false });
  }
  return refs;
}

export function validateFormForPublish(db: MockDb, root: MockFormRoot): { blockers: PublishIssue[]; warnings: PublishIssue[] } {
  const snap = formWorking(db, root);
  const blockers: PublishIssue[] = [];
  const warnings: PublishIssue[] = [];
  const def = DEFAULT_LOCALE_CODE;
  const dflt = snap.translations.find((t) => t.locale_code === def);
  for (const f of ["title", "submit_label"] as const) if (blank(dflt?.[f])) blockers.push(issue(`/translations/${def}/${f}`, "empty_default_locale", { locale: def }));
  for (const f of root.fields) {
    const row = snap.field_translations.find((t) => t.field_key === f.key && t.locale_code === def);
    if (blank(row?.label)) blockers.push(issue(`/field_translations/${f.key}/${def}/label`, "empty_default_locale", { locale: def }));
    if (f.type === "select" || f.type === "radio") {
      for (const option of f.options ?? []) {
        if (blank(row?.option_labels[option])) blockers.push(issue(`/field_translations/${f.key}/${def}/option_labels/${option}`, "empty_default_locale", { locale: def }));
      }
    }
  }
  if (!hasCatchAllRecipient(root.recipients)) blockers.push(issue("/recipients", "recipients_required"));
  if (snap.form.honeypot_field && root.fields.some((f) => f.key === snap.form.honeypot_field)) blockers.push(issue("/settings/honeypot_field", "duplicate", { reason: "field" }));
  for (const code of MOCK_ACTIVE_LOCALE_CODES) {
    if (code === def) continue;
    const t = snap.translations.find((x) => x.locale_code === code);
    const missing =
      (blank(t?.title) ? 1 : 0) + (blank(t?.submit_label) ? 1 : 0) + root.fields.filter((f) => blank(snap.field_translations.find((x) => x.field_key === f.key && x.locale_code === code)?.label)).length;
    if (missing > 0) warnings.push(issue(`/translations/${code}`, "translation_incomplete", { locale: code, missing }, false));
  }
  return { blockers, warnings };
}

function blockedError(blockers: PublishIssue[], warnings: PublishIssue[]) {
  return fail(422, "PUBLISH_BLOCKED", `Cannot publish: ${blockers.length} item(s) must be fixed first.`, {
    errors: blockers.slice(0, MAX_ISSUES),
    details: { blocker_count: blockers.length, truncated: blockers.length > MAX_ISSUES, warning_count: warnings.length, warnings: warnings.slice(0, MAX_ISSUES) },
  });
}

export function publishForm(db: MockDb, id: string, params: Params, body: unknown, ifMatch: string | null) {
  rejectUnknown(params, ["dry_run"]);
  const dryRun = boolParam(params, "dry_run") ?? false;
  const root = findForm(db, id);
  if (formsRole(db) !== "editor") throw deny("publish", "POST", "/forms/{id}/publish");
  requireMatch(ifMatch, root);
  const input = body === undefined || body === null ? {} : body;
  if (!isObject(input)) throw validationFailed([{ in: "body", path: "", code: "invalid_type", params: { expected: "object" } }]);
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(input)) if (k !== "change_note") errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  if (input.change_note !== undefined && (typeof input.change_note !== "string" || len(input.change_note) > 200)) errors.push({ in: "body", path: "/change_note", code: "too_long", params: { max: 200 } });
  if (errors.length) throw validationFailed(errors);
  if (root.status === "published" && !hasDraft(db, root)) throw invalidState("nothing_to_publish");

  const { blockers, warnings } = validateFormForPublish(db, root);
  if (blockers.length > 0) throw blockedError(blockers, warnings);
  if (dryRun) return { data: { publishable: true as const, warnings }, etag: undefined };

  const stamp = touch(db, root);
  const note = typeof input.change_note === "string" && input.change_note ? input.change_note : null;
  const draft = hasDraft(db, root) ? formDraftRow(db, root) : undefined;
  const snapshot = structuredClone(formWorking(db, root));
  root.live = snapshot;
  let published: StoredRevision;
  if (draft) {
    draft.snapshot = structuredClone(snapshot) as unknown as Record<string, unknown>;
    draft.kind = "published";
    draft.change_note = note;
    published = draft;
  } else {
    published = pushRevision(db, "forms", root.id, ENTITY, "published", structuredClone(snapshot) as unknown as Record<string, unknown>, note, stamp, MOCK_USER);
  }
  root.status = "published";
  root.published_at = root.published_at ?? stamp;
  root.first_published_at ??= stamp;
  root.unpublished_at = null;
  const result = { ...writeResult(db, root, warnings.map((w) => ({ path: w.path, code: w.code, params: w.params }))), published_revision: { id: published.id, version: published.version } };
  return { data: result, etag: etagOfForm(root) };
}

export function unpublishForm(db: MockDb, id: string, params: Params, ifMatch: string | null) {
  rejectUnknown(params, ["confirm_references"]);
  const confirm = boolParam(params, "confirm_references") ?? false;
  const root = findForm(db, id);
  if (formsRole(db) !== "editor") throw deny("unpublish", "POST", "/forms/{id}/unpublish");
  requireMatch(ifMatch, root);
  if (root.status !== "published") throw invalidState("not_published");
  const refs = formReferences(db, root);
  const warnings: FormWarning[] = [];
  if (refs.length > 0) {
    if (!confirm) throw fail(409, "ENTITY_REFERENCED", "The record is referenced by other data.", { details: { references: refs.slice(0, 50), total_references: refs.length } });
    warnings.push({ path: "", code: "form_referenced", params: { total_references: refs.length } });
  }
  const stamp = touch(db, root);
  const draft = formDraftRow(db, root);
  if (draft) {
    draft.kind = "history";
    draft.change_note = "unpublish";
    warnings.push({ path: "", code: "draft_kept_as_history", params: { revision_id: draft.id, version: draft.version } });
  }
  root.status = "archived";
  root.unpublished_at = stamp;
  return { data: writeResult(db, root, warnings), etag: etagOfForm(root) };
}

export function discardFormDraft(db: MockDb, id: string, ifMatch: string | null) {
  const root = findForm(db, id);
  if (formsRole(db) !== "editor") throw deny("update", "POST", "/forms/{id}/discard-draft");
  requireMatch(ifMatch, root);
  const draft = hasDraft(db, root) ? formDraftRow(db, root) : undefined;
  if (!draft) throw invalidState("no_draft");
  draft.kind = "history";
  draft.change_note = "discarded";
  draft.is_preview = false;
  touch(db, root);
  return { data: writeResult(db, root), etag: etagOfForm(root) };
}

// ---- revisions (05 12.8 for forms) ---------------------------------------------------------------------------------------
const KINDS = ["draft", "published", "history", "restore"];

function liveRevisionId(db: MockDb, root: MockFormRoot): number | null {
  if (root.status !== "published") return null;
  const rows = revList(db, root).filter((r) => r.kind === "published");
  return rows.length ? rows.reduce((a, b) => (b.version > a.version ? b : a)).id : null;
}

export function listFormRevisions(db: MockDb, id: string, params: Params) {
  rejectUnknown(params, ["page", "limit", "kind", "include_preview", "sort"]);
  const root = findForm(db, id);
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
  rows.sort((a, b) => (sort === "version" ? a.version - b.version : b.version - a.version));
  const summaries: RevisionSummary[] = rows.map(({ entity: _e, snapshot: _s, ...summary }) => {
    void _e;
    void _s;
    return { ...summary, is_live: summary.id === live };
  });
  return paginate(summaries, params);
}

export function getFormRevision(db: MockDb, id: string, revId: string) {
  const root = findForm(db, id);
  const rev = revList(db, root).find((r) => String(r.id) === revId);
  if (!rev) throw notFound();
  return { ...rev, entity: { type: ENTITY, id: root.id, key: null }, is_live: rev.id === liveRevisionId(db, root) };
}

// A restore always becomes the WORKING draft (never reaches the website); the current state is kept as a `restore` row.
export function restoreFormRevision(db: MockDb, id: string, revId: string, body: unknown, ifMatch: string | null) {
  const root = findForm(db, id);
  const rev = revList(db, root).find((r) => String(r.id) === revId);
  if (!rev) throw notFound();
  if (formsRole(db) !== "editor") throw deny("update", "POST", "/forms/{id}/revisions/{revId}/restore");
  requireMatch(ifMatch, root);
  const input = body === undefined || body === null ? {} : body;
  if (!isObject(input)) throw validationFailed([{ in: "body", path: "", code: "invalid_type", params: { expected: "object" } }]);
  const bodyErrors: ApiFieldError[] = Object.keys(input).filter((k) => k !== "change_note").map((k) => ({ in: "body" as const, path: `/${k}`, code: "unknown_field" }));
  if (input.change_note !== undefined && (typeof input.change_note !== "string" || len(input.change_note) > 200)) bodyErrors.push({ in: "body", path: "/change_note", code: "too_long", params: { max: 200 } });
  if (bodyErrors.length) throw validationFailed(bodyErrors);
  if (rev.schema_version > 1) throw invalidState("snapshot_incompatible");
  const restoredFrom = { revision_id: rev.id, version: rev.version };
  const snapshot = rev.snapshot as unknown as MockFormSnapshot;
  const current = formWorking(db, root);
  if (rev.kind === "draft" || JSON.stringify(snapshot) === JSON.stringify(current)) return { data: { ...writeResult(db, root), restored_from: restoredFrom }, etag: etagOfForm(root) };
  const stamp = tick(db);
  const note = (typeof input.change_note === "string" && input.change_note) || `restore of v${rev.version}`;
  pushRevision(db, "forms", root.id, ENTITY, "restore", structuredClone(current) as unknown as Record<string, unknown>, note, stamp, MOCK_USER);
  const next = structuredClone(snapshot);
  if (root.status === "published") {
    const draft = formDraftRow(db, root);
    if (draft) draft.snapshot = next as unknown as Record<string, unknown>;
    else pushRevision(db, "forms", root.id, ENTITY, "draft", next as unknown as Record<string, unknown>, null, stamp, MOCK_USER);
  } else root.live = next;
  root.lock_version += 1;
  root.updated_at = stamp;
  root.updated_by = MOCK_USER;
  return { data: { ...writeResult(db, root), restored_from: restoredFrom }, etag: etagOfForm(root) };
}

// ---- helpers for the browser click-through and the tests -------------------------------------------------------------------
// Somebody else saved the form: the next command with the old ETag is a 409 `CONFLICT_LOCK_VERSION`.
export function touchFormAsSomeoneElse(db: MockDb, id: number): number {
  const root = formsState(db).forms.find((f) => f.id === id);
  if (!root) throw notFound();
  touch(db, root);
  root.updated_by = SOMCHAI;
  return root.lock_version;
}
// Somebody else replaced the recipients: the next PUT with the old `recipients_etag` is a 409.
export function changeRecipientsAsSomeoneElse(db: MockDb, id: number, email: string) {
  const root = formsState(db).forms.find((f) => f.id === id);
  if (!root) throw notFound();
  root.recipients = [...root.recipients, { id: formsState(db).nextRecipientId++, email, kind: "cc", topic_value: null, is_active: true }];
}
