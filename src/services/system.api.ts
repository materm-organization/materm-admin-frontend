import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { ApiResponse } from "@/types/api";
import type { CachePurgePayload, CachePurgeResult, SystemStatus } from "@/types/system";

export const SystemAPI = {
  Status: async () => {
    const { data } = await axiosInstance.get<ApiResponse<SystemStatus>>(API_ENDPOINTS.SYSTEM.STATUS);
    return data;
  },
  // `ops.system:execute`. Queued through the outbox; 429 `RATE_LIMITED` (+ Retry-After) when pressed too often.
  PurgeCache: async (payload: CachePurgePayload) => {
    const { data } = await axiosInstance.post<ApiResponse<CachePurgeResult>>(API_ENDPOINTS.SYSTEM.CACHE_PURGE, payload);
    return data;
  },
};
