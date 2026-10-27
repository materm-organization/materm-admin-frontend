import { useQuery } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { PermissionsAPI } from "@/services/permissions.api";

// The catalog (22 keys) and the 15 actions with their descriptions (tooltips of the matrix header).
export const usePermissions = (enabled = true) =>
  useQuery({
    queryKey: [API_ENDPOINTS.PERMISSIONS.LIST],
    queryFn: () => PermissionsAPI.List(),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
