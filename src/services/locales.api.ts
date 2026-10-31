import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatch } from "@/lib/etag";
import type { ApiResponse } from "@/types/api";
import type { Locale, UpdateLocalePayload } from "@/types/locales";

export const LocalesAPI = {
  // Not paginated (<= 10 locales): `data` is an array and there is no `meta`.
  List: async () => {
    const { data } = await axiosInstance.get<ApiResponse<Locale[]>>(API_ENDPOINTS.LOCALES.LIST);
    return data;
  },
  // `If-Match` is REQUIRED (428 without it, 409 CONFLICT_LOCK_VERSION when stale): the row's own `etag` from the list.
  // The answer is the Locale with its new `etag`.
  Update: async (code: string, payload: UpdateLocalePayload, etag: string) => {
    const { data } = await axiosInstance.patch<ApiResponse<Locale>>(
      API_ENDPOINTS.LOCALES.DETAIL(code),
      payload,
      ifMatch(etag, { required: true })
    );
    return data;
  },
};
