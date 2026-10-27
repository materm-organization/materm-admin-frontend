import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { ApiResponse } from "@/types/api";
import type { SystemStatus } from "@/types/system";

export const SystemAPI = {
  Status: async () => {
    const { data } = await axiosInstance.get<ApiResponse<SystemStatus>>(API_ENDPOINTS.SYSTEM.STATUS);
    return data;
  },
};
