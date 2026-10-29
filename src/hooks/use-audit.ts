import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { AuditAPI } from "@/services/audit.api";
import type { AuditListParams, AuditTabParams } from "@/types/audit";

export const useAuditLogs = (params: AuditListParams, enabled = true) =>
  useQuery({
    queryKey: [API_ENDPOINTS.AUDIT.LIST, params],
    queryFn: () => AuditAPI.List(params),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useAuditLog = (id: number | null, occurredAt?: string) =>
  useQuery({
    queryKey: [API_ENDPOINTS.AUDIT.DETAIL(id ?? 0), occurredAt ?? null],
    queryFn: () => AuditAPI.Get(id as number, occurredAt),
    enabled: id !== null,
  });

// The History tab of one entity (tab shape only, see `AuditTabParams`): works for `read` on the entity without `ops.audit:read`.
export const useEntityAuditLogs = (params: AuditTabParams, enabled = true) =>
  useQuery({
    queryKey: [API_ENDPOINTS.AUDIT.LIST, "tab", params],
    queryFn: () => AuditAPI.ListForEntity(params),
    placeholderData: keepPreviousData,
    enabled,
  });
