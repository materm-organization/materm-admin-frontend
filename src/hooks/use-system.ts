import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { isNoPermissionError } from "@/lib/api-error";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { SystemAPI } from "@/services/system.api";
import type { CachePurgePayload } from "@/types/system";

// Dependency states are cached 5 s by the backend; the page re-reads every 30 s (doc/07 section 3.28).
export const SYSTEM_STATUS_REFETCH_MS = 30_000;

// Polling continues after 5xx / network errors (the page shows the last data) but never after a 403 / auth error.
export const systemRefetchInterval = (error: unknown): number | false =>
  isNoPermissionError(error) ? false : SYSTEM_STATUS_REFETCH_MS;

export const useSystemStatus = () =>
  useQuery({
    queryKey: [API_ENDPOINTS.SYSTEM.STATUS],
    queryFn: () => SystemAPI.Status(),
    // A read that ended in 403 / an auth error is never repeated (CLAUDE.md): polling stops.
    refetchInterval: (query) => systemRefetchInterval(query.state.error),
  });

// SCR-45 "clear cache" (doc/05 section 11.8). The event goes through the outbox, so the status page's outbox card
// is refreshed afterwards.
export const useMutationPurgeCache = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CachePurgePayload) => SystemAPI.PurgeCache(payload),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.SYSTEM.STATUS] }),
  });
};
