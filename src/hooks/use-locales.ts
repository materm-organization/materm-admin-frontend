import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { LocalesAPI } from "@/services/locales.api";
import type { ApiResponse } from "@/types/api";
import type { Locale, UpdateLocalePayload } from "@/types/locales";

export const useLocales = (enabled = true) =>
  useQuery({
    queryKey: [API_ENDPOINTS.LOCALES.LIST],
    queryFn: () => LocalesAPI.List(),
    enabled,
    staleTime: 10 * 60 * 1000,
  });

export const useMutationUpdateLocale = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ code, payload, etag }: { code: string; payload: UpdateLocalePayload; etag: string }) =>
      LocalesAPI.Update(code, payload, etag),
    onSuccess: (answer) => {
      // The answer carries the row's new etag: put it in the list at once, so the next write does not wait for the refetch.
      queryClient.setQueryData<ApiResponse<Locale[]>>([API_ENDPOINTS.LOCALES.LIST], (old) =>
        old ? { ...old, data: old.data.map((l) => (l.code === answer.data.code ? answer.data : l)) } : old
      );
      void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.LOCALES.LIST] });
    },
  });
};

// The default language's code (the one whose alt text decides "missing alt"). `la` until the list is known or when
// the user may not read it (a media-only editor has no `cms.locales:read`).
export const useDefaultLocaleCode = (): string => {
  const { data } = useLocales();
  return data?.data.find((l) => l.is_default)?.code ?? "la";
};
