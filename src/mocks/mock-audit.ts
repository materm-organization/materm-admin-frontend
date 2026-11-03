// `GET /audit-logs` of the mock (doc/05 section 5.1). Strict like the backend: an unknown query key is 422 `unknown_field`.
//
// WHO may ask (the rule the backend has since the History tab for non-auditors):
//   - `ops.audit:read` may use any filter;
//   - a caller WITHOUT it may ask only the TAB SHAPE: `entity_type` + `entity_id` (both), plus `from`, `to`, `page`, `limit` and
//     `sort`, and only for an entity type whose permission key the caller can `read` (`iam.user` -> `iam.users:read`). Any other shape
//     (a filter such as `action` / `actor_id`, `entity_type` alone, no entity at all) is 403.
// The mock does not know the caller (the browser mock and the tests keep the user elsewhere), so the grants are set with
// `setAuditCaller(db, ...)`; the default is a caller who holds everything.
import { fail, forbidden, pageOf, rejectUnknown, validationFailed, type MockDb, type Params } from "@/mocks/mock-core";
import type { AuditLogEntry } from "@/types/audit";

export const AUDIT_ALL_KEYS = ["page", "limit", "sort", "actor_id", "actor_type", "action", "result", "entity_type", "entity_id", "request_id", "from", "to"] as const;
export const AUDIT_TAB_KEYS = ["entity_type", "entity_id", "from", "to", "page", "limit", "sort"] as const;

// The permission key whose `read` opens the History tab of an entity type.
export const AUDIT_ENTITY_PERMISSION: Record<string, string> = {
  "iam.user": "iam.users",
  "iam.role": "iam.roles",
  "cms.page": "cms.pages",
  "cms.post": "cms.posts",
  "cms.album": "cms.albums",
  "cms.author": "cms.blog",
  "ops.webhook": "ops.webhooks",
  "cms.faq_group": "cms.faq",
  "forms.form": "cms.forms",
  "cms.locale": "cms.locales",
  "cms.ui_string": "cms.ui_strings",
  "cms.ui_strings_bundle": "cms.ui_strings",
};

// The collection tabs: `entity_id=0` means "every row of this entity type" and is valid for exactly these three types.
export const AUDIT_COLLECTION_TYPES = ["cms.locale", "cms.ui_string", "cms.ui_strings_bundle"] as const;

type Grants = Record<string, readonly string[]>;
const callers = new WeakMap<MockDb, Grants | null>();

/** `null` = holds everything (the default); otherwise the grants as `{ "iam.users": ["read"], "ops.audit": ["read"] }`. */
export function setAuditCaller(db: MockDb, grants: Grants | null) {
  callers.set(db, grants);
}
const can = (grants: Grants | null, key: string) => grants === null || (grants[key] ?? []).includes("read");

const entry = (id: number, minute: number, over: Partial<AuditLogEntry>): AuditLogEntry => ({
  id,
  occurred_at: `2026-10-27T03:${String(minute).padStart(2, "0")}:00Z`,
  actor_type: "user",
  actor_user_id: 6,
  actor_name: "Noy Keomany",
  actor_role_key: "super_admin",
  api_key_id: null,
  action: "iam.user.updated",
  result: "success",
  entity_type: "iam.user",
  entity_id: 1,
  entity_public_id: null,
  summary: null,
  ip: "203.0.113.5",
  user_agent: "Mozilla/5.0",
  request_id: `0192d3a4-${String(id).padStart(4, "0")}`,
  has_changes: true,
  ...over,
});

const ROWS: AuditLogEntry[] = [
  entry(1, 1, { action: "iam.user.created", summary: "User created" }),
  entry(2, 5, { action: "iam.user.updated", summary: "Profile updated" }),
  entry(3, 9, { action: "iam.user.deactivated", summary: "User deactivated", entity_id: 2 }),
  entry(4, 12, { action: "iam.role.permissions_updated", entity_type: "iam.role", entity_id: 3, summary: "Editor grants updated" }),
  entry(5, 15, { action: "cms.page.published", entity_type: "cms.page", entity_id: 4, summary: "Page published" }),
  entry(6, 18, { action: "authz.denied", result: "denied", entity_type: null, entity_id: null, has_changes: false }),
  entry(7, 21, { action: "cms.locale.updated", entity_type: "cms.locale", entity_id: 2, summary: "locale lo updated: is_active, fallback_code" }),
  entry(8, 24, { action: "cms.ui_string.restored", entity_type: "cms.ui_string", entity_id: 11, summary: "nav.home: restore of v2" }),
  entry(9, 27, { action: "cms.ui_string.bundle_synced", entity_type: "cms.ui_string", entity_id: null, summary: "bundle 3f9c2ab: inserted=2 source_updated=1 kept_override=4", has_changes: false }),
  entry(10, 27, { action: "cms.ui_strings_bundle.synced", entity_type: "cms.ui_strings_bundle", entity_id: null, summary: "bundle 3f9c2ab: inserted=2 source_updated=1 kept_override=4", has_changes: false }),
  entry(11, 30, { action: "cms.author.created", entity_type: "cms.author", entity_id: 1, summary: "Author Somchai Vongsa created" }),
  // Webhooks (doc/05 16.9): the audit `after` never holds the secret; `disabled` is written by the system.
  entry(12, 33, { action: "ops.webhook.created", entity_type: "ops.webhook", entity_id: 1, summary: "Webhook CRM sync created" }),
  entry(13, 36, { action: "ops.webhook.updated", entity_type: "ops.webhook", entity_id: 1, summary: "events changed" }),
  entry(14, 39, { action: "ops.webhook.tested", entity_type: "ops.webhook", entity_id: 1, summary: "test sent: ok" }),
  entry(15, 42, { action: "ops.webhook.secret_rotated", entity_type: "ops.webhook", entity_id: 1, summary: "secret rotated", has_changes: false }),
  entry(16, 45, { action: "ops.webhook.disabled", entity_type: "ops.webhook", entity_id: 2, actor_type: "system", actor_user_id: null, actor_name: null, actor_role_key: null, summary: "switched off: auto_24h_failure", ip: null, user_agent: null }),
];

export function listAuditLogs(db: MockDb, params: Params) {
  rejectUnknown(params, AUDIT_ALL_KEYS);
  const grants = callers.has(db) ? (callers.get(db) ?? null) : null;
  const entityType = params.get("entity_type");
  const entityId = params.get("entity_id");
  if (entityId !== null && entityType === null) throw validationFailed([{ in: "query", path: "/entity_type", code: "required" }]);
  const collection = entityType !== null && (AUDIT_COLLECTION_TYPES as readonly string[]).includes(entityType);
  // `0` = the collection tab, accepted for exactly the three collection types.
  if (entityId !== null && !(collection && entityId === "0") && !/^[1-9]\d*$/.test(entityId)) throw validationFailed([{ in: "query", path: "/entity_id", code: "invalid_format" }]);

  if (!can(grants, "ops.audit")) {
    const keys = [...new Set(params.keys())];
    const tabShape = entityType !== null && entityId !== null && keys.every((k) => (AUDIT_TAB_KEYS as readonly string[]).includes(k));
    if (!tabShape) throw forbidden("ops.audit:read is required for this filter");
    const key = AUDIT_ENTITY_PERMISSION[entityType];
    if (!key || !can(grants, key)) throw fail(403, "FORBIDDEN", "You do not have permission to perform this action.", { details: { summary: `${key ?? entityType}:read is required` } });
  }

  const from = params.get("from");
  const to = params.get("to");
  const rows = ROWS.filter(
    (r) =>
      (entityType === null || r.entity_type === entityType) &&
      (entityId === null || (collection && entityId === "0") || r.entity_id === Number(entityId)) &&
      (params.get("action") === null || r.action === params.get("action")) &&
      (params.get("result") === null || r.result === params.get("result")) &&
      (from === null || r.occurred_at >= from) &&
      (to === null || r.occurred_at <= to)
  ).sort((a, b) => (params.get("sort") === "occurred_at" ? a.id - b.id : b.id - a.id));
  const { page, limit } = pageOf(params, 20);
  return { data: rows.slice((page - 1) * limit, page * limit), meta: { total: rows.length, page, limit, total_page: Math.ceil(rows.length / limit) } };
}
