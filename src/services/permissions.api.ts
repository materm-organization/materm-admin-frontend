import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { ApiResponse } from "@/types/api";
import type { PermissionCatalog } from "@/types/iam";

export const PermissionsAPI = {
  // Not paginated (22 keys, 15 actions); `Cache-Control: max-age=300`.
  List: async () => {
    const { data } = await axiosInstance.get<ApiResponse<PermissionCatalog>>(API_ENDPOINTS.PERMISSIONS.LIST);
    return data;
  },
};
