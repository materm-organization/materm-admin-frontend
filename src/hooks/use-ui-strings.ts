import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { revisionsQueryKey } from "@/lib/revision-resources";
import { UiStringsAPI } from "@/services/ui-strings.api";
import type { PutUiStringPayload, UiStringsBundleManifest, UiStringsListQuery } from "@/types/ui-strings";

const UI_STRINGS_KEY = [API_ENDPOINTS.UI_STRINGS.LIST] as const;

// SCR-34: the table. State comes from the URL; `keepPreviousData` keeps the rows while a filter loads.
export const useUiStrings = (query: UiStringsListQuery, enabled = true) =>
  useQuery({
    queryKey: [...UI_STRINGS_KEY, query],
    queryFn: () => UiStringsAPI.List(query),
    enabled,
    placeholderData: keepPreviousData,
  });

// The cells of one key live in the list; a write refreshes the list and the key's history.
export const useMutationPutUiString = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, locale, payload, etag }: { key: string; locale: string; payload: PutUiStringPayload; etag?: string | null }) =>
      UiStringsAPI.Put(key, locale, payload, etag),
    onSuccess: (_result, { key }) => {
      void queryClient.invalidateQueries({ queryKey: UI_STRINGS_KEY });
      void queryClient.invalidateQueries({ queryKey: revisionsQueryKey("ui-strings", key) });
    },
  });
};

export const useMutationDeleteUiString = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, locale, etag }: { key: string; locale: string; etag?: string | null }) => UiStringsAPI.Delete(key, locale, etag),
    onSuccess: (_result, { key }) => {
      void queryClient.invalidateQueries({ queryKey: UI_STRINGS_KEY });
      void queryClient.invalidateQueries({ queryKey: revisionsQueryKey("ui-strings", key) });
    },
  });
};

// `dryRun: true` reports only; a real sync refreshes the table.
export const useMutationBundleSync = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ manifest, dryRun }: { manifest: UiStringsBundleManifest; dryRun: boolean }) => UiStringsAPI.BundleSync(manifest, dryRun),
    onSuccess: (result) => {
      if (!result.data.dry_run) void queryClient.invalidateQueries({ queryKey: UI_STRINGS_KEY });
    },
  });
};

export const invalidateUiStrings = (queryClient: ReturnType<typeof useQueryClient>) =>
  queryClient.invalidateQueries({ queryKey: UI_STRINGS_KEY });
