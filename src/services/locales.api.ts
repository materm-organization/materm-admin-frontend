import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { ApiResponse } from "@/types/api";
import type { Locale, UpdateLocalePayload } from "@/types/locales";

export const LocalesAPI = {
  // Not paginated (<= 10 locales): `data` is an array and there is no `meta`.
  List: async () => {
    const { data } = await axiosInstance.get<ApiResponse<Locale[]>>(API_ENDPOINTS.LOCALES.LIST);
    return data;
  },
  // No ETag / If-Match on locales (last write wins, doc/05 section 10.7).
  Update: async (code: string, payload: UpdateLocalePayload) => {
    const { data } = await axiosInstance.patch<ApiResponse<Locale>>(API_ENDPOINTS.LOCALES.DETAIL(code), payload);
    return data;
  },
};
