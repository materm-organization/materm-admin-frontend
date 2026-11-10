import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { ApiResponse } from "@/types/api";
import type { PublishingQueue, PublishingQueueQuery } from "@/types/publishing-queue";

// `GET /publishing/queue` (doc/05 12.12). `kind` goes out as a comma list; absent `tab` = the three tabs. `to` is sent as given (the offset of an
// RFC 3339 time carries a `+`, which axios percent-encodes in a query value).
export const PublishingQueueAPI = {
  Get: async (query: PublishingQueueQuery = {}) => {
    const params: Record<string, string | number> = {};
    if (query.tab) params.tab = query.tab;
    if (query.kind && query.kind.length > 0) params.kind = query.kind.join(",");
    if (query.page && query.page > 1) params.page = query.page;
    if (query.limit) params.limit = query.limit;
    if (query.to) params.to = query.to;
    const { data } = await axiosInstance.get<ApiResponse<PublishingQueue>>(API_ENDPOINTS.PUBLISHING.QUEUE, { params });
    return data.data;
  },
};
