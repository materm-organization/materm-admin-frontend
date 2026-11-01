import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { WithEtag } from "@/lib/etag";
import { runBulkChunks, toBulkItems } from "@/lib/media-bulk";
import { revisionsQueryKey } from "@/lib/revision-resources";
import { MediaAPI } from "@/services/media.api";
import type { ApiResponse } from "@/types/api";
import type {
  CreateMediaFolderPayload,
  MediaBulkDeleteUpdated,
  MediaBulkMoveUpdated,
  MediaBulkResult,
  MediaAsset,
  MediaAssetDetail,
  MediaListQuery,
  UpdateMediaAssetPayload,
  UpdateMediaFolderPayload,
} from "@/types/media";

export const mediaAssetKey = (id: number | string) => [API_ENDPOINTS.MEDIA.ASSET(id)] as const;
const MEDIA_LISTS_KEY = [API_ENDPOINTS.MEDIA.ASSETS] as const;
const MEDIA_FOLDERS_KEY = [API_ENDPOINTS.MEDIA.FOLDERS] as const;

// SCR-35 list (grid / table): page, filters and sort come from the URL (`useListParams`).
export const useMediaAssets = (query: MediaListQuery, enabled = true) =>
  useQuery({
    queryKey: [API_ENDPOINTS.MEDIA.ASSETS, query],
    queryFn: () => MediaAPI.ListAssets(query),
    enabled,
    placeholderData: keepPreviousData,
  });

// SCR-36 detail with its ETag (`If-Match` of the PATCH / DELETE / restore).
export const useMediaAssetDetail = (id: number | string | undefined, enabled = true) =>
  useQuery({
    queryKey: mediaAssetKey(id ?? 0),
    queryFn: () => MediaAPI.GetAsset(id as number | string),
    enabled: enabled && id !== undefined,
  });

export const useMediaUsages = (id: number | string | undefined, params: { page?: number; limit?: number } = {}, enabled = true) =>
  useQuery({
    queryKey: [API_ENDPOINTS.MEDIA.ASSET_USAGES(id ?? 0), params],
    queryFn: () => MediaAPI.ListUsages(id as number | string, params),
    enabled: enabled && id !== undefined,
  });

// The (small, flat) folder tree. Cached a minute: it changes only when someone edits folders.
export const useMediaFolders = (enabled = true) =>
  useQuery({
    queryKey: MEDIA_FOLDERS_KEY,
    queryFn: () => MediaAPI.ListFolders(),
    enabled,
    staleTime: 60_000,
  });

// A write answered with the asset: its NEW ETag goes straight into the cache (no refetch, otherwise the next save
// would send a stale If-Match); lists, usages, the history and the pickers' lookups are refreshed.
function cacheAsset(queryClient: QueryClient, asset: MediaAssetDetail, etag: string | undefined) {
  if (etag) {
    const entry: WithEtag<ApiResponse<MediaAssetDetail>> = { data: { success: true, data: asset }, etag };
    queryClient.setQueryData(mediaAssetKey(asset.id), entry);
  } else {
    void queryClient.invalidateQueries({ queryKey: mediaAssetKey(asset.id) });
  }
  refreshMediaLists(queryClient, asset.id);
}

function refreshMediaLists(queryClient: QueryClient, id: number | string) {
  void queryClient.invalidateQueries({ queryKey: MEDIA_LISTS_KEY });
  void queryClient.invalidateQueries({ queryKey: MEDIA_FOLDERS_KEY });
  void queryClient.invalidateQueries({ queryKey: revisionsQueryKey("media/assets", id) });
  // The schema form's image fields read the same rows (alt placeholder, focal).
  void queryClient.invalidateQueries({ queryKey: ["schema-form", "media"] });
  void queryClient.invalidateQueries({ queryKey: ["schema-form", "media-list"] });
}

export const useMutationUpdateMediaAsset = (id: number | string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, etag }: { payload: UpdateMediaAssetPayload; etag: string | undefined }) =>
      MediaAPI.UpdateAsset(id, payload, etag),
    onSuccess: (result) => cacheAsset(queryClient, result.data.data, result.etag),
  });
};

// P2 FR-MEDIA-08: replace the file, keep the id. The answer carries the NEW ETag (cached like a PATCH).
export const useMutationReplaceMediaFile = (id: number | string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, etag, onProgress }: { file: File; etag: string | undefined; onProgress?: (percent: number | undefined) => void }) =>
      MediaAPI.ReplaceFile(id, file, etag, { onProgress }),
    onSuccess: (result) => cacheAsset(queryClient, result.data.data, result.etag),
  });
};

// Soft delete. The detail entry is left alone on purpose (see `useMutationDeleteRole`).
export const useMutationDeleteMediaAsset = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, etag }: { id: number | string; etag: string | undefined }) => MediaAPI.DeleteAsset(id, etag),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: mediaAssetKey(id) });
      refreshMediaLists(queryClient, id);
    },
  });
};

export const useMutationRestoreMediaAsset = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, etag }: { id: number | string; etag: string | undefined }) => MediaAPI.RestoreAsset(id, etag),
    onSuccess: (result) => cacheAsset(queryClient, result.data.data, result.etag),
  });
};

export const useMutationCreateMediaFolder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: CreateMediaFolderPayload; idempotencyKey?: string }) =>
      MediaAPI.CreateFolder(payload, idempotencyKey),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: MEDIA_FOLDERS_KEY }),
  });
};

export const useMutationUpdateMediaFolder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload, etag }: { id: number | string; payload: UpdateMediaFolderPayload; etag?: string }) =>
      MediaAPI.UpdateFolder(id, payload, etag),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MEDIA_FOLDERS_KEY });
      void queryClient.invalidateQueries({ queryKey: MEDIA_LISTS_KEY });
    },
  });
};

export const useMutationDeleteMediaFolder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, etag }: { id: number | string; etag?: string }) => MediaAPI.DeleteFolder(id, etag),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MEDIA_FOLDERS_KEY });
      void queryClient.invalidateQueries({ queryKey: MEDIA_LISTS_KEY });
    },
  });
};

// FR-MEDIA-11. The rows come from the loaded list (each row's ETag is its precondition); more than 100 go in chunks. The
// answer is always a merged result (`error` = the request-level failure that stopped the run, if any).
type BulkRows = { rows: Pick<MediaAsset, "id" | "updated_at">[] };
function useBulkMedia<U extends { id: number }, V extends BulkRows>(call: (items: ReturnType<typeof toBulkItems>, variables: V) => Promise<MediaBulkResult<U>>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: V) => runBulkChunks(toBulkItems(variables.rows), (chunk) => call(chunk, variables)),
    onSettled: (data) => {
      for (const u of data?.result.updated ?? []) void queryClient.invalidateQueries({ queryKey: mediaAssetKey(u.id) });
      void queryClient.invalidateQueries({ queryKey: MEDIA_LISTS_KEY });
      void queryClient.invalidateQueries({ queryKey: MEDIA_FOLDERS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["schema-form", "media"] });
      void queryClient.invalidateQueries({ queryKey: ["schema-form", "media-list"] });
    },
  });
}

export const useMutationBulkMoveMedia = () =>
  useBulkMedia<MediaBulkMoveUpdated, BulkRows & { folderId: number | null }>((items, { folderId }) => MediaAPI.BulkMove(items, folderId));
export const useMutationBulkDeleteMedia = () => useBulkMedia<MediaBulkDeleteUpdated, BulkRows>((items) => MediaAPI.BulkDelete(items));
