import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { WithEtag } from "@/lib/etag";
import { revisionsQueryKey } from "@/lib/revision-resources";
import { FormsAPI } from "@/services/forms.api";
import type { ApiResponse } from "@/types/api";
import type { FormDetail, FormsQuery, ReplaceRecipientsPayload, UpdateFormPayload } from "@/types/forms";

const LIST_KEY = [API_ENDPOINTS.FORMS.LIST] as const;
export const formQueryKey = (id: number | string) => [API_ENDPOINTS.FORMS.DETAIL(id)] as const;

// SCR-31: the list (no trash, no create in P1).
export const useForms = (query: FormsQuery, enabled = true) =>
  useQuery({ queryKey: [...LIST_KEY, "list", query], queryFn: () => FormsAPI.List(query), enabled, placeholderData: keepPreviousData });

// One form with the ETag every PATCH / publish command sends as `If-Match`, and `recipients_etag` (the recipients' own validator).
export const useFormDetail = (id: number | string, enabled = true) => useQuery({ queryKey: formQueryKey(id), queryFn: () => FormsAPI.Get(id), enabled });

type CachedForm = WithEtag<ApiResponse<FormDetail>>;

// A command answers the form in the shape of its own GET plus the NEW ETag: put it in the cache instead of refetching. Lists,
// the history and the schema form's form picker (a status changed) are marked stale. The recipients are NOT part of the
// form's ETag, so a form command keeps whatever `recipients*` the cache already has when the answer lacks them.
export function writeThroughForm(queryClient: QueryClient, id: number | string, result: { data: Partial<FormDetail> | Record<string, unknown>; etag: string | undefined }) {
  if (result.etag) {
    queryClient.setQueryData<CachedForm>(formQueryKey(id), (old) =>
      old ? { etag: result.etag, data: { ...old.data, data: { ...old.data.data, ...(result.data as Partial<FormDetail>) } } } : old
    );
  }
  void queryClient.invalidateQueries({ queryKey: LIST_KEY });
  void queryClient.invalidateQueries({ queryKey: revisionsQueryKey("forms", id) });
  void queryClient.invalidateQueries({ queryKey: ["schema-form"] });
}

// ---- the writes of the form editor ---------------------------------------------------------------------------------------------
// They run ONE AT A TIME and each reads its ETag from the cache when its turn comes. The texts / settings PATCH uses the form's
// ETag; the recipients PUT uses `recipients_etag` of the cached form and moves ONLY that (the form's ETag stays).
const cached = (queryClient: QueryClient, id: number | string) => queryClient.getQueryData<CachedForm>(formQueryKey(id));

export function useFormWrites(formId: number) {
  const queryClient = useQueryClient();
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const run = useCallback(
    <T,>(task: () => Promise<T>): Promise<T> => {
      const result = chain.current.then(task);
      chain.current = result.catch(() => undefined);
      return result;
    },
    []
  );

  return useMemo(
    () => ({
      updateForm: (payload: UpdateFormPayload) =>
        run(async () => {
          const response = await FormsAPI.Update(formId, payload, cached(queryClient, formId)?.etag);
          writeThroughForm(queryClient, formId, { data: response.data.data, etag: response.etag });
          return response.data.data;
        }),
      replaceRecipients: (payload: ReplaceRecipientsPayload) =>
        run(async () => {
          const response = await FormsAPI.ReplaceRecipients(formId, payload, cached(queryClient, formId)?.data.data.recipients_etag);
          const { recipients, recipients_etag } = response.data.data;
          // Only the recipients moved: the form's ETag and `lock_version` stay as they are.
          queryClient.setQueryData<CachedForm>(formQueryKey(formId), (old) =>
            old
              ? {
                  etag: old.etag,
                  data: {
                    ...old.data,
                    data: { ...old.data.data, recipients, recipients_etag, recipient_count: recipients.filter((r) => r.is_active).length },
                  },
                }
              : old
          );
          void queryClient.invalidateQueries({ queryKey: LIST_KEY });
          return response.data.data;
        }),
    }),
    [formId, queryClient, run]
  );
}
