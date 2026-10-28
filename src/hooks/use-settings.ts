import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { WithEtag } from "@/lib/etag";
import { revisionsQueryKey } from "@/lib/revision-resources";
import { SettingsAPI } from "@/services/settings.api";
import type { ApiResponse } from "@/types/api";
import type { PutSettingsPayload, SettingsGroup } from "@/types/settings";

export const settingsGroupQueryKey = (group: string) => [API_ENDPOINTS.SETTINGS.GROUP(group)] as const;

// One group with its definitions, values and the ETag (`"<revision number>"`) of the `PUT`.
export const useSettingsGroup = (group: string, enabled = true) =>
  useQuery({ queryKey: settingsGroupQueryKey(group), queryFn: () => SettingsAPI.Get(group), enabled });

// The `PUT` answers the whole group with its NEW ETag: it goes straight into the cache.
export const useMutationPutSettings = (group: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, etag }: { payload: PutSettingsPayload; etag: string | undefined }) => SettingsAPI.Put(group, payload, etag),
    onSuccess: (result) => {
      const entry: WithEtag<ApiResponse<SettingsGroup>> = { data: result.data, etag: result.etag };
      queryClient.setQueryData(settingsGroupQueryKey(group), entry);
      void queryClient.invalidateQueries({ queryKey: revisionsQueryKey("settings", group) });
    },
  });
};
