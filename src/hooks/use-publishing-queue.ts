import { keepPreviousData, useQuery, type QueryClient } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { PublishingQueueAPI } from "@/services/publishing-queue.api";
import type { PublishingQueueQuery } from "@/types/publishing-queue";

// Every queue query (the screen, the sidebar badge) lives under this key, so one invalidation refreshes them all.
export const PUBLISHING_QUEUE_KEY = [API_ENDPOINTS.PUBLISHING.QUEUE] as const;

// After ANY command of the publish engine (publish, schedule, reject, ...) the queue and the dashboard cards that count it are stale.
export function invalidatePublishingQueue(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: PUBLISHING_QUEUE_KEY });
  void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.DASHBOARD.SUMMARY] });
}

// SCR-39. The answer is per user and `no-store` on the server: refetch when the window gets focus (default of React Query) and do not
// serve a stale one for long.
export const usePublishingQueue = (query: PublishingQueueQuery, enabled = true) =>
  useQuery({
    queryKey: [...PUBLISHING_QUEUE_KEY, query],
    queryFn: () => PublishingQueueAPI.Get(query),
    enabled,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });

// The sidebar badge: how many pages and posts wait for a review (one row asked for, only the count is read), polled every minute.
export const useAwaitingReviewCount = (enabled: boolean) =>
  useQuery({
    queryKey: [...PUBLISHING_QUEUE_KEY, { tab: "awaiting_review", limit: 1 }],
    queryFn: () => PublishingQueueAPI.Get({ tab: "awaiting_review", limit: 1 }),
    enabled,
    refetchInterval: 60_000,
    staleTime: 15_000,
    select: (q) => q.awaiting_review?.count ?? 0,
  });
