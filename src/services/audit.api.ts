import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type { AuditListParams, AuditLogDetail, AuditLogEntry, AuditTabParams } from "@/types/audit";

// GET /audit-logs rejects every query key outside this list with 422 `unknown_field` (and it has no
// `keyword`), so the request is built from an explicit allow-list — never by spreading caller input.
const AUDIT_QUERY_KEYS = [
  "page",
  "limit",
  "sort",
  "actor_id",
  "actor_type",
  "action",
  "result",
  "entity_type",
  "entity_id",
  "request_id",
  "from",
  "to",
] as const satisfies readonly (keyof AuditListParams)[];

export function buildAuditQuery(params: AuditListParams): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  for (const key of AUDIT_QUERY_KEYS) {
    const value = params[key];
    if (value === undefined || value === null || value === "") continue;
    query[key] = value;
  }
  // `entity_id` is only valid together with `entity_type`.
  if (query.entity_id !== undefined && query.entity_type === undefined) delete query.entity_id;
  return query;
}

// The History tab of an entity. Built from its own, narrower allow-list (never from `buildAuditQuery`): an extra filter such as
// `actor_id` or `action` would turn a request that `read` on the entity allows into a 403 for a caller without `ops.audit:read`.
const AUDIT_TAB_QUERY_KEYS = ["entity_type", "entity_id", "from", "to", "page", "limit", "sort"] as const satisfies readonly (keyof AuditTabParams)[];

export function buildAuditTabQuery(params: AuditTabParams): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  for (const key of AUDIT_TAB_QUERY_KEYS) {
    const value = params[key];
    if (value === undefined || value === null || value === "") continue;
    query[key] = value;
  }
  return query;
}

export const AuditAPI = {
  ListForEntity: async (params: AuditTabParams) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<AuditLogEntry[]>>(API_ENDPOINTS.AUDIT.LIST, {
      params: buildAuditTabQuery(params),
    });
    return data;
  },
  List: async (params: AuditListParams) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<AuditLogEntry[]>>(API_ENDPOINTS.AUDIT.LIST, {
      params: buildAuditQuery(params),
    });
    return data;
  },
  // `occurredAt` (from the list row) lets the server read one partition only.
  Get: async (id: number | string, occurredAt?: string) => {
    const { data } = await axiosInstance.get<ApiResponse<AuditLogDetail>>(API_ENDPOINTS.AUDIT.DETAIL(id), {
      params: occurredAt ? { occurred_at: occurredAt } : undefined,
    });
    return data;
  },
};
