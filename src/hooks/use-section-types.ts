import { useQuery } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { SectionTypesAPI, type SectionTypeListParams } from "@/services/section-types.api";
import type { SectionType } from "@/types/cms";

// A schema never changes under a given `key@version` (the registry changes by seed / migration only, doc/05
// section 10.6), so the detail is cached for the whole session (doc/07 section 3.13).
export const useSectionType = (key: string | undefined, version?: number) =>
  useQuery({
    queryKey: [API_ENDPOINTS.SECTION_TYPES.DETAIL(key ?? ""), version ?? "current"],
    queryFn: async (): Promise<SectionType> => (await SectionTypesAPI.Get(key as string, version)).data,
    enabled: Boolean(key),
    staleTime: Infinity,
  });

export const useSectionTypes = (params: SectionTypeListParams = {}, enabled = true) =>
  useQuery({
    queryKey: [API_ENDPOINTS.SECTION_TYPES.LIST, params],
    queryFn: () => SectionTypesAPI.List(params),
    enabled,
    staleTime: 10 * 60 * 1000,
  });
