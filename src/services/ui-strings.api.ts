import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatch, withEtag } from "@/lib/etag";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type {
  BundleSyncResult,
  PutUiStringPayload,
  UiStringDeleteResult,
  UiStringItem,
  UiStringsBundleManifest,
  UiStringsListMeta,
  UiStringsListQuery,
  UiStringWriteResult,
} from "@/types/ui-strings";

// UI strings (doc/05 section 11.4). `If-Match` is OPTIONAL on a cell (when sent it must equal the row's `etag`).
export const UiStringsAPI = {
  List: async (query: UiStringsListQuery = {}) => {
    const { data } = await axiosInstance.get<Omit<ApiResponsePagination<UiStringItem[]>, "meta"> & { meta: UiStringsListMeta }>(
      API_ENDPOINTS.UI_STRINGS.LIST,
      { params: query }
    );
    return data;
  },
  // Upsert one language of one key; takes effect on the website at once.
  Put: async (key: string, locale: string, payload: PutUiStringPayload, etag?: string | null) =>
    withEtag(
      await axiosInstance.put<ApiResponse<UiStringWriteResult>>(API_ENDPOINTS.UI_STRINGS.CELL(key, locale), payload, ifMatch(etag))
    ),
  // "Restore the original": removes the override row; `data: null` when there was none.
  Delete: async (key: string, locale: string, etag?: string | null) => {
    const { data } = await axiosInstance.delete<ApiResponse<UiStringDeleteResult>>(
      API_ENDPOINTS.UI_STRINGS.CELL(key, locale),
      ifMatch(etag)
    );
    return data;
  },
  // `dry_run=true` reports without writing anything. Limited to 10 per hour per user (429).
  BundleSync: async (manifest: UiStringsBundleManifest, dryRun: boolean) => {
    const { data } = await axiosInstance.post<ApiResponse<BundleSyncResult>>(API_ENDPOINTS.UI_STRINGS.BUNDLE_SYNC, manifest, {
      params: dryRun ? { dry_run: true } : undefined,
    });
    return data;
  },
};
