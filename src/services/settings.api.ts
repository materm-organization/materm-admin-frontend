import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatch, withEtag } from "@/lib/etag";
import type { ApiResponse } from "@/types/api";
import type { PutSettingsPayload, SettingsGroup } from "@/types/settings";

// Settings groups (doc/05 section 11.3). The ETag is the group's revision number (`"4"`, `"0"` = never edited).
export const SettingsAPI = {
  // Overview only (the editors read one group). Groups the user may not read are left out.
  List: async () => {
    const { data } = await axiosInstance.get<ApiResponse<SettingsGroup[]>>(API_ENDPOINTS.SETTINGS.LIST);
    return data;
  },
  Get: async (group: string) =>
    withEtag(await axiosInstance.get<ApiResponse<SettingsGroup>>(API_ENDPOINTS.SETTINGS.GROUP(group))),
  // Replaces the whole group; `If-Match` is mandatory (428 without it).
  Put: async (group: string, payload: PutSettingsPayload, etag: string | undefined) =>
    withEtag(
      await axiosInstance.put<ApiResponse<SettingsGroup>>(API_ENDPOINTS.SETTINGS.GROUP(group), payload, ifMatch(etag, { required: true }))
    ),
};
