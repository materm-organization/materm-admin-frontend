// In-memory model of the external webhooks endpoints, strict to doc/05 section 16 (backend e856e35): rows with a soft delete (no trash),
// `If-Match` mandatory on PATCH / DELETE / rotate-secret with the `etag` that is a HASH of the editable fields (NOT `updated_at`: the
// worker writes statistics all the time), `data.secret` only in the answers of create and rotate-secret (`whsec_` + 43 characters; a
// replayed create has `secret: null`), the field rules and codes of 16.2 (every problem in ONE 422), the early URL check of 16.3,
// the test of 16.6 (synchronous, 10 per minute and user, 503 without the secret key), the deliveries of 16.7 and the retry rules.
// URL-driven behaviour (INVENTED, only the mock): a host containing "failing" answers 500, a host containing "slow" times out, a host
// `private.*` resolves to a blocked address, `*.invalid` does not resolve, every other public name answers 200.
// INVENTED seed: three webhooks (healthy, switched off by the system after 24 h of failures, switched off by hand) and their deliveries.
import {
  MOCK_USER,
  badRequest,
  boolParam,
  fail,
  invalidState,
  micros,
  notFound,
  paginate,
  rejectUnknown,
  requireIfMatch,
  tick,
  validationFailed,
  type MockDb,
  type Params,
} from "@/mocks/mock-core";
import { withLocalOffset } from "@/mocks/mock-taxonomy";
import type { ApiFieldError } from "@/types/api";
import type { Webhook, WebhookDelivery, WebhookDeliveryEvent, WebhookDeliveryStatus, WebhookEvent, WebhookTestResult, WebhookWithSecret } from "@/types/webhooks";

export const EVENTS: WebhookEvent[] = ["content.published", "content.unpublished", "form.submitted", "media.ready", "user.created"];
const DELIVERY_EVENTS: string[] = [...EVENTS, "webhook.test"];
const DELIVERY_STATUSES: string[] = ["pending", "delivering", "succeeded", "failed", "dead"];
const SORTABLE = ["name", "created_at", "updated_at"];
export const MAX_NAME = 80;
export const MAX_URL = 2048;
const MAX_ATTEMPTS = 8;
const TEST_LIMIT_PER_MINUTE = 10;

/** A stored webhook: what the API shows plus what only the server keeps. */
export type MockWebhook = Omit<Webhook, "etag"> & { secret_version: number; deleted_at: string | null };
export type MockWebhookState = { rows: MockWebhook[]; deliveries: WebhookDelivery[]; nextId: number; nextDeliveryId: number; nextSecret: number; testStamps: number[]; unconfigured: boolean };

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const body = (path: string, code: string, params?: ApiFieldError["params"]): ApiFieldError => ({ in: "body", path, code, ...(params ? { params } : {}) });
const len = (v: string) => [...v.trim()].length;

export const secretOf = (n: number) => `whsec_${"MockSecretValue".padEnd(41, "x")}${String(n).padStart(2, "0")}`;

// ---- the etag: a hash of the fields the user can edit (+ the reason, the secret generation and the deletion) -------------------------------
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
export function etagOfRow(row: MockWebhook): string {
  const editable = JSON.stringify([row.name, row.url, row.events, row.is_active, row.timeout_ms, row.disabled_reason, row.secret_version, row.deleted_at]);
  return `"${row.id}-${hash(editable)}"`;
}
const view = (row: MockWebhook): Webhook => {
  const { secret_version: _s, deleted_at: _d, ...rest } = row;
  void _s;
  void _d;
  return { ...structuredClone(rest), created_at: withLocalOffset(row.created_at) as string, updated_at: withLocalOffset(row.updated_at) as string, etag: etagOfRow(row) };
};
const state = (db: MockDb): MockWebhookState => db.webhooks;
function findRow(db: MockDb, id: string): MockWebhook {
  const row = state(db).rows.find((r) => String(r.id) === id && !r.deleted_at);
  if (!row) throw notFound();
  return row;
}

// ---- seed -----------------------------------------------------------------------------------------------------------------------------------
export function emptyWebhookState(): MockWebhookState {
  return { rows: [], deliveries: [], nextId: 1, nextDeliveryId: 1, nextSecret: 1, testStamps: [], unconfigured: false };
}

export function seedWebhooks(db: MockDb) {
  const s = emptyWebhookState();
  db.webhooks = s;
  const created = micros(Date.UTC(2026, 9, 28, 4, 0, 0), 120);
  const row = (over: Partial<MockWebhook> & Pick<MockWebhook, "id" | "name" | "url" | "events" | "secret_hint">): MockWebhook => ({
    public_id: `0192d3a4-7c1e-7b52-9d0a-0000000000b${over.id}`,
    is_active: true,
    timeout_ms: 5000,
    max_attempts: MAX_ATTEMPTS,
    consecutive_failures: 0,
    last_success_at: null,
    disabled_reason: null,
    created_by: MOCK_USER,
    updated_by: MOCK_USER,
    created_at: created,
    updated_at: created,
    secret_version: 1,
    deleted_at: null,
    ...over,
  });
  s.rows = [
    row({ id: 1, name: "CRM sync", url: "https://hooks.example.com/materm", events: ["content.published", "form.submitted"], secret_hint: "ab12", last_success_at: micros(Date.UTC(2026, 10, 2, 8, 30, 0), 123) }),
    row({
      id: 2,
      name: "Slack relay",
      url: "https://failing.example.com/hook",
      events: ["form.submitted", "user.created"],
      secret_hint: "9xQz",
      is_active: false,
      disabled_reason: "auto_24h_failure",
      consecutive_failures: 31,
      last_success_at: micros(Date.UTC(2026, 9, 30, 6, 0, 0), 456),
    }),
    row({ id: 3, name: "Backup mirror", url: "https://mirror.example.net/materm", events: ["media.ready"], secret_hint: "k3Lm", is_active: false }),
  ];
  s.nextId = 4;
  s.nextSecret = 4;

  const base = Date.UTC(2026, 10, 2, 9, 0, 0);
  const add = (webhookId: number, minutesAgo: number, over: Partial<WebhookDelivery> & Pick<WebhookDelivery, "event_type" | "status">) => {
    const id = s.nextDeliveryId++;
    const at = micros(base - minutesAgo * 60_000, id);
    s.deliveries.push({
      id,
      webhook_id: webhookId,
      event_id: `0192d3a4-aaaa-7b52-9d0a-${String(id).padStart(12, "0")}`,
      attempt: over.status === "pending" ? 0 : 1,
      max_attempts: MAX_ATTEMPTS,
      next_attempt_at: null,
      last_status_code: null,
      last_error: null,
      response_ms: null,
      response_body: null,
      delivered_at: null,
      created_at: at,
      ...over,
    });
  };
  // webhook 1: 24 rows (two pages of 20 / 4), newest first by creation time
  for (let i = 0; i < 20; i++) {
    add(1, 10 + i * 30, { event_type: i % 3 === 0 ? "form.submitted" : "content.published", status: "succeeded", last_status_code: 200, response_ms: 80 + i, response_body: '{"ok":true}', delivered_at: micros(base - (10 + i * 30) * 60_000, 7) });
  }
  add(1, 2, { event_type: "content.published", status: "pending", next_attempt_at: micros(base + 60_000, 1) });
  add(1, 4, { event_type: "form.submitted", status: "delivering", attempt: 1 });
  add(1, 6, { event_type: "content.published", status: "failed", attempt: 2, last_status_code: 503, last_error: "http_status", response_ms: 212, next_attempt_at: micros(base + 5 * 60_000, 2), response_body: "<img src=x onerror=alert(1)> Service Unavailable" });
  add(1, 700, { event_type: "form.submitted", status: "dead", attempt: 8, last_status_code: 500, last_error: "http_status", response_ms: 301, response_body: "internal error\n<script>alert('x')</script>" });
  add(1, 15, { event_type: "webhook.test", status: "succeeded", last_status_code: 200, response_ms: 95, response_body: '{"received":true}', delivered_at: micros(base - 15 * 60_000, 9) });
  // webhook 2: the failures that switched it off
  for (let i = 0; i < 4; i++) add(2, 1500 + i * 120, { event_type: "form.submitted", status: "dead", attempt: 8, last_status_code: 500, last_error: "http_status", response_ms: 250, response_body: "upstream unavailable" });
  add(2, 1400, { event_type: "user.created", status: "failed", attempt: 3, last_error: "timeout", response_ms: 5000, next_attempt_at: micros(base, 3) });
  s.deliveries.forEach((d) => {
    if (d.attempt === 0) d.attempt = 0;
  });
}

// ---- field rules (16.2): every problem at once ---------------------------------------------------------------------------------------------
const PRIVATE_V4: Array<(a: number[]) => boolean> = [
  (a) => a[0] === 0 || a[0] === 10 || a[0] === 127 || a[0] >= 224,
  (a) => a[0] === 169 && a[1] === 254,
  (a) => a[0] === 172 && a[1] >= 16 && a[1] <= 31,
  (a) => a[0] === 192 && a[1] === 168,
  (a) => a[0] === 100 && a[1] >= 64 && a[1] <= 127,
];
function urlErrors(raw: string): ApiFieldError[] {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return [body("/url", "invalid_url")];
  }
  const errors: ApiFieldError[] = [];
  if (u.protocol !== "https:") errors.push(body("/url", "scheme_not_allowed", { allowed: ["https"] }));
  if (u.username || u.password) errors.push(body("/url", "credentials_not_allowed"));
  if (u.hash) errors.push(body("/url", "invalid_url"));
  if (u.port && u.port !== "443") errors.push(body("/url", "port_not_allowed", { allowed: ["443"] }));
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const lastLabel = host.split(".").pop() ?? "";
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    if (PRIVATE_V4.some((f) => f(ipv4.slice(1).map(Number)))) errors.push(body("/url", "address_not_allowed"));
  } else if (host.includes(":")) {
    if (host === "::1" || host === "::" || host.startsWith("fe80") || host.startsWith("fc") || host.startsWith("fd")) errors.push(body("/url", "address_not_allowed"));
  } else if (
    host === "localhost" ||
    /\.(localhost|local|internal|localdomain|lan)$/.test(host) ||
    host.endsWith(".home.arpa") ||
    /^\d+$/.test(lastLabel) ||
    /^0x/.test(lastLabel)
  ) {
    errors.push(body("/url", "host_not_allowed"));
  } else if (host.endsWith(".invalid")) errors.push(body("/url", "unresolvable_host"));
  else if (host.startsWith("private.")) errors.push(body("/url", "address_not_allowed"));
  return errors;
}

function fieldErrors(b: Record<string, unknown>, mode: "create" | "patch"): ApiFieldError[] {
  const errors: ApiFieldError[] = [];
  const allowed = ["name", "url", "events", "is_active", "timeout_ms"];
  for (const k of Object.keys(b)) if (!allowed.includes(k)) errors.push(body(`/${k}`, "unknown_field"));
  if (mode === "patch" && Object.keys(b).length === 0) errors.push(body("", "min_properties"));
  if (mode === "create" || "name" in b) {
    if (typeof b.name !== "string") errors.push(body("/name", b.name === undefined || b.name === null ? "required" : "invalid_type"));
    else if (b.name.trim() === "") errors.push(body("/name", "required"));
    else if (len(b.name) > MAX_NAME) errors.push(body("/name", "too_long", { max: MAX_NAME }));
  }
  if (mode === "create" || "url" in b) {
    if (typeof b.url !== "string") errors.push(body("/url", b.url === undefined || b.url === null ? "required" : "invalid_type"));
    else if (b.url.trim() === "") errors.push(body("/url", "required"));
    else if ([...b.url.trim()].length > MAX_URL) errors.push(body("/url", "too_long", { max: MAX_URL }));
    else errors.push(...urlErrors(b.url.trim()));
  }
  if (mode === "create" || "events" in b) {
    if (!Array.isArray(b.events)) errors.push(body("/events", b.events === undefined || b.events === null ? "required" : "invalid_type"));
    else if (b.events.length === 0) errors.push(body("/events", "required"));
    else {
      const seen = new Set<string>();
      b.events.forEach((e, i) => {
        if (typeof e !== "string" || !EVENTS.includes(e as WebhookEvent)) errors.push(body(`/events/${i}`, "unknown_value", { allowed: EVENTS }));
        else if (seen.has(e)) errors.push(body(`/events/${i}`, "duplicate"));
        else seen.add(e);
      });
    }
  }
  if ("is_active" in b && typeof b.is_active !== "boolean") errors.push(body("/is_active", "invalid_type"));
  if ("timeout_ms" in b) {
    if (typeof b.timeout_ms !== "number" || !Number.isInteger(b.timeout_ms)) errors.push(body("/timeout_ms", "invalid_type"));
    else if (b.timeout_ms < 1000 || b.timeout_ms > 10000) errors.push(body("/timeout_ms", "out_of_range", { min: 1000, max: 10000 }));
  }
  return errors;
}

const notConfigured = (db: MockDb) => {
  if (state(db).unconfigured) throw fail(503, "SERVICE_UNAVAILABLE", "Webhooks are not configured.", { details: { dependency: "security.webhookSecretKey" } });
};

// ---- list / get -------------------------------------------------------------------------------------------------------------------------------
export function listWebhooks(db: MockDb, params: Params) {
  rejectUnknown(params, ["page", "limit", "keyword", "is_active", "event", "sort"]);
  const active = boolParam(params, "is_active");
  const event = params.get("event");
  if (event !== null && !EVENTS.includes(event as WebhookEvent)) throw validationFailed([{ in: "query", path: "/event", code: "unknown_value", params: { allowed: EVENTS } }]);
  const sort = params.get("sort") ?? "-created_at";
  const m = /^(-?)([a-z_]+)$/.exec(sort);
  if (!m || !SORTABLE.includes(m[2])) throw validationFailed([{ in: "query", path: "/sort", code: "not_in_enum" }]);
  const kw = params.get("keyword")?.trim().toLowerCase();
  const rows = state(db)
    .rows.filter((r) => {
      if (r.deleted_at) return false;
      if (active !== undefined && r.is_active !== active) return false;
      if (event !== null && !r.events.includes(event as WebhookEvent)) return false;
      if (kw && !`${r.name}\n${r.url}`.toLowerCase().includes(kw)) return false;
      return true;
    })
    .map(view);
  const dir = m[1] ? -1 : 1;
  rows.sort((a, b) => {
    const x = (a as unknown as Record<string, string>)[m[2]].toLowerCase();
    const y = (b as unknown as Record<string, string>)[m[2]].toLowerCase();
    return (x < y ? -1 : x > y ? 1 : 0) * dir || b.id - a.id;
  });
  return paginate(rows, params);
}

export function getWebhook(db: MockDb, id: string) {
  const row = findRow(db, id);
  return { data: view(row), etag: etagOfRow(row) };
}

// ---- create / patch / delete / rotate ---------------------------------------------------------------------------------------------------------
export function createWebhook(db: MockDb, input: unknown, idempotencyKey: string | null) {
  if (!isObject(input)) throw badRequest();
  const s = state(db);
  const fingerprint = JSON.stringify(input);
  if (idempotencyKey) {
    const stored = db.idempotency[`webhooks-create:${idempotencyKey}`];
    if (stored) {
      if (stored.fingerprint !== fingerprint) throw fail(422, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used with different data.");
      // The replay carries no secret.
      return { data: { ...(stored.data as Webhook), secret: null } as WebhookWithSecret, etag: stored.etag as string };
    }
  }
  const errors = fieldErrors(input, "create");
  if (errors.length) throw validationFailed(errors);
  notConfigured(db);
  const at = tick(db);
  const secretNo = s.nextSecret++;
  const row: MockWebhook = {
    id: s.nextId++,
    public_id: `0192d3a4-7c1e-7b52-9d0a-${String(s.nextId).padStart(12, "0")}`,
    name: (input.name as string).trim(),
    url: (input.url as string).trim(),
    events: EVENTS.filter((e) => (input.events as string[]).includes(e)),
    is_active: typeof input.is_active === "boolean" ? input.is_active : true,
    timeout_ms: typeof input.timeout_ms === "number" ? input.timeout_ms : 5000,
    max_attempts: MAX_ATTEMPTS,
    secret_hint: secretOf(secretNo).slice(-4),
    consecutive_failures: 0,
    last_success_at: null,
    disabled_reason: null,
    created_by: MOCK_USER,
    updated_by: MOCK_USER,
    created_at: at,
    updated_at: at,
    secret_version: 1,
    deleted_at: null,
  };
  s.rows.push(row);
  const data = view(row);
  if (idempotencyKey) db.idempotency[`webhooks-create:${idempotencyKey}`] = { fingerprint, status: 201, data, etag: data.etag };
  return { data: { ...data, secret: secretOf(secretNo) } as WebhookWithSecret, etag: data.etag };
}

export function patchWebhook(db: MockDb, id: string, input: unknown, ifMatch: string | null) {
  const row = findRow(db, id);
  if (!isObject(input)) throw badRequest();
  const errors = fieldErrors(input, "patch");
  if (errors.length) throw validationFailed(errors);
  requireIfMatch(ifMatch, etagOfRow(row));
  const next = structuredClone(row);
  if ("name" in input) next.name = (input.name as string).trim();
  if ("url" in input) next.url = (input.url as string).trim();
  if ("events" in input) next.events = EVENTS.filter((e) => (input.events as string[]).includes(e));
  if ("timeout_ms" in input) next.timeout_ms = input.timeout_ms as number;
  if ("is_active" in input) {
    next.is_active = input.is_active as boolean;
    // `is_active: true` on a webhook the system switched off = turn it back on: the reason and the failure count are cleared.
    if (next.is_active && next.disabled_reason) {
      next.disabled_reason = null;
      next.consecutive_failures = 0;
    }
  }
  if (etagOfRow(next) === etagOfRow(row)) return { data: view(row), etag: etagOfRow(row) };
  next.updated_at = tick(db);
  next.updated_by = MOCK_USER;
  Object.assign(row, next);
  return { data: view(row), etag: etagOfRow(row) };
}

export function deleteWebhook(db: MockDb, id: string, ifMatch: string | null) {
  const row = findRow(db, id);
  requireIfMatch(ifMatch, etagOfRow(row));
  row.deleted_at = tick(db);
}

export function rotateWebhookSecret(db: MockDb, id: string, ifMatch: string | null) {
  const row = findRow(db, id);
  requireIfMatch(ifMatch, etagOfRow(row));
  notConfigured(db);
  const s = state(db);
  const secretNo = s.nextSecret++;
  row.secret_hint = secretOf(secretNo).slice(-4);
  row.secret_version += 1;
  row.updated_at = tick(db);
  row.updated_by = MOCK_USER;
  const data = view(row);
  return { data: { ...data, secret: secretOf(secretNo) } as WebhookWithSecret, etag: data.etag };
}

// ---- test (16.6) -----------------------------------------------------------------------------------------------------------------------------
export function testWebhook(db: MockDb, id: string): WebhookTestResult {
  const row = findRow(db, id);
  notConfigured(db);
  const s = state(db);
  const now = Date.now();
  s.testStamps = s.testStamps.filter((t) => now - t < 60_000);
  if (s.testStamps.length >= TEST_LIMIT_PER_MINUTE) throw fail(429, "RATE_LIMITED", "Too many requests.", {}, { "Retry-After": "30" });
  s.testStamps.push(now);

  const host = new URL(row.url).hostname;
  let result: Omit<WebhookTestResult, "delivery_id">;
  if (host.includes("slow")) result = { ok: false, status_code: null, latency_ms: row.timeout_ms, response_snippet: null, error_class: "timeout" };
  else if (host.includes("failing")) result = { ok: false, status_code: 500, latency_ms: 212, response_snippet: "internal error <b>not bold</b>", error_class: "http_status" };
  else if (host.startsWith("private.")) result = { ok: false, status_code: null, latency_ms: 3, response_snippet: null, error_class: "blocked_address" };
  else result = { ok: true, status_code: 200, latency_ms: 87, response_snippet: '{"received":true}', error_class: null };

  const id2 = s.nextDeliveryId++;
  s.deliveries.push({
    id: id2,
    webhook_id: row.id,
    event_type: "webhook.test",
    event_id: `0192d3a4-bbbb-7b52-9d0a-${String(id2).padStart(12, "0")}`,
    status: result.ok ? "succeeded" : "dead",
    attempt: 1,
    max_attempts: MAX_ATTEMPTS,
    next_attempt_at: null,
    last_status_code: result.status_code,
    last_error: result.error_class,
    response_ms: result.latency_ms,
    response_body: result.response_snippet,
    delivered_at: result.ok ? tick(db) : null,
    created_at: tick(db),
  });
  return { delivery_id: id2, ...result };
}

// ---- deliveries (16.7) -------------------------------------------------------------------------------------------------------------------------
export function listWebhookDeliveries(db: MockDb, id: string, params: Params) {
  const row = findRow(db, id);
  rejectUnknown(params, ["page", "limit", "status", "event", "sort"]);
  const errors: ApiFieldError[] = [];
  const statusRaw = params.get("status");
  const statuses = statusRaw === null ? null : statusRaw.split(",");
  if (statuses && statuses.some((x) => !DELIVERY_STATUSES.includes(x))) errors.push({ in: "query", path: "/status", code: "unknown_value", params: { allowed: DELIVERY_STATUSES } });
  const event = params.get("event");
  if (event !== null && !DELIVERY_EVENTS.includes(event)) errors.push({ in: "query", path: "/event", code: "unknown_value", params: { allowed: DELIVERY_EVENTS } });
  const sort = params.get("sort") ?? "-created_at";
  if (!/^-?created_at$/.test(sort)) errors.push({ in: "query", path: "/sort", code: "not_in_enum" });
  if (errors.length) throw validationFailed(errors);
  const dir = sort.startsWith("-") ? -1 : 1;
  const rows = state(db)
    .deliveries.filter((d) => d.webhook_id === row.id && (statuses === null || statuses.includes(d.status)) && (event === null || d.event_type === event))
    .map((d) => ({ ...structuredClone(d), created_at: withLocalOffset(d.created_at) as string }))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id) * dir);
  return paginate(rows, params);
}

export function retryWebhookDelivery(db: MockDb, id: string): WebhookDelivery {
  const s = state(db);
  const delivery = s.deliveries.find((d) => String(d.id) === id);
  const hook = delivery ? s.rows.find((r) => r.id === delivery.webhook_id && !r.deleted_at) : undefined;
  if (!delivery || !hook) throw notFound();
  if (delivery.event_type === "webhook.test") throw invalidState("test_delivery");
  const status: WebhookDeliveryStatus = delivery.status;
  if (status === "pending" || status === "delivering" || status === "succeeded") throw invalidState(status);
  if (!hook.is_active) throw invalidState("webhook_inactive");
  if (status === "dead") delivery.attempt = 0;
  delivery.status = "pending";
  delivery.next_attempt_at = tick(db);
  return { ...structuredClone(delivery) };
}

export type { WebhookDeliveryEvent };
