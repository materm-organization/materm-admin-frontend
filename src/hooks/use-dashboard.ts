import { useQuery } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { DashboardAPI } from "@/services/dashboard.api";

// SCR-05: the whole dashboard comes from ONE request (doc/05 13.8); `private, max-age=30` on the server, so 30 s here too.
// The mock that stands in until the backend exists is `src/mocks/mock-dashboard.ts` (the shape lives in `types/dashboard.d.ts`).
export const useDashboardSummary = (enabled = true) =>
  useQuery({ queryKey: [API_ENDPOINTS.DASHBOARD.SUMMARY], queryFn: () => DashboardAPI.Summary(), enabled, staleTime: 30_000 });
