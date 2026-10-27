import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { ApiResponse } from "@/types/api";
import type { SectionType, SectionTypeSummary } from "@/types/cms";

export type SectionTypeListParams = {
  // `schema` adds json_schema / ui_schema / default_props / limits to every row (one request for the registry).
  include?: "schema";
  is_active?: boolean;
  scope?: "page" | "shared" | "post" | "collection";
  template?: string;
  keyword?: string;
};

export const SectionTypesAPI = {
  // Not paginated (<= 30 types): `data` is an array and there is no `meta` (doc/05 section 10.6).
  List: async (params: SectionTypeListParams = {}) => {
    const { data } = await axiosInstance.get<ApiResponse<SectionTypeSummary[]>>(API_ENDPOINTS.SECTION_TYPES.LIST, {
      params,
    });
    return data;
  },
  // `version` (optional) asks for the version a section is still bound to; without it the current one.
  Get: async (key: string, version?: number) => {
    const { data } = await axiosInstance.get<ApiResponse<SectionType>>(API_ENDPOINTS.SECTION_TYPES.DETAIL(key), {
      params: version ? { version } : undefined,
    });
    return data;
  },
};
