import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { ApiResponse } from "@/types/api";
import type { DashboardSummary } from "@/types/dashboard";

// `GET /dashboard/summary` (doc/05 section 13.8): one request for the whole page; the server leaves out the cards the caller may not see.
export const DashboardAPI = {
  Summary: async () => {
    const { data } = await axiosInstance.get<ApiResponse<DashboardSummary>>(API_ENDPOINTS.DASHBOARD.SUMMARY);
    return data.data;
  },
};
