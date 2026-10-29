// Audit log wire shapes (doc/05-api-spec.md section 5).
export type AuditActorType = "user" | "api_key" | "system" | "public";
export type AuditResult = "success" | "denied" | "error";

export type AuditLogEntry = {
  id: number;
  occurred_at: string;
  actor_type: AuditActorType;
  actor_user_id: number | null;
  actor_name: string | null;
  actor_role_key: string | null;
  api_key_id: number | null;
  action: string;
  result: AuditResult;
  entity_type: string | null;
  entity_id: number | null;
  entity_public_id: string | null;
  summary: string | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  has_changes: boolean;
};

// RFC 6902 operation, computed by the server from before -> after.
export type JsonPatchOp = { op: string; path: string; value?: unknown };

// GET /audit-logs/{id}: the entry plus the snapshots (no secrets/hashes).
export type AuditLogDetail = AuditLogEntry & {
  before: unknown;
  after: unknown;
  changes: JsonPatchOp[] | null;
};

// The ONLY query keys GET /audit-logs accepts (anything else is a 422 `unknown_field`; there is no `keyword`).
export type AuditListParams = {
  page?: number;
  limit?: number;
  sort?: string;
  actor_id?: number | string;
  actor_type?: string;
  action?: string;
  result?: string;
  entity_type?: string;
  entity_id?: number | string;
  request_id?: string;
  from?: string;
  to?: string;
};

// The TAB SHAPE of GET /audit-logs: the only shape a caller without `ops.audit:read` may use (then `read` on the entity's own
// permission key is enough; any other shape is 403). Both entity members are required, nothing else filters.
export type AuditTabParams = {
  entity_type: string;
  entity_id: number | string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  sort?: string;
};
