import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { LocalesAPI } from "@/services/locales.api";
import type { UpdateLocalePayload } from "@/types/locales";

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
    mutationFn: ({ code, payload }: { code: string; payload: UpdateLocalePayload }) =>
      LocalesAPI.Update(code, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.LOCALES.LIST] });
    },
  });
};
