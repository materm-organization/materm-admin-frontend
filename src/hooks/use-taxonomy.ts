import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { revisionsQueryKey } from "@/lib/revision-resources";
import { CategoriesAPI, TagsAPI } from "@/services/taxonomy.api";
import type {
  CategoriesQuery,
  CreateCategoryPayload,
  CreateTagPayload,
  TagsQuery,
  TaxonomyKind,
  UpdateCategoryPayload,
  UpdateTagPayload,
} from "@/types/taxonomy";

const KEYS = {
  categories: [API_ENDPOINTS.CATEGORIES.LIST] as const,
  tags: [API_ENDPOINTS.TAGS.LIST] as const,
};

export const useCategories = (query: CategoriesQuery, enabled = true) =>
  useQuery({ queryKey: [...KEYS.categories, query], queryFn: () => CategoriesAPI.List(query), enabled, placeholderData: keepPreviousData });

export const useTags = (query: TagsQuery, enabled = true) =>
  useQuery({ queryKey: [...KEYS.tags, query], queryFn: () => TagsAPI.List(query), enabled, placeholderData: keepPreviousData });

// A write changes the rows of the list (counts, trash) and adds a history row.
function useRefresh(kind: TaxonomyKind) {
  const queryClient = useQueryClient();
  return (id?: number | string) => {
    void queryClient.invalidateQueries({ queryKey: KEYS[kind] });
    // The schema form's category picker reads the same rows.
    void queryClient.invalidateQueries({ queryKey: ["schema-form"] });
    if (id !== undefined) void queryClient.invalidateQueries({ queryKey: revisionsQueryKey(kind, id) });
  };
}

export const useMutationCreateCategory = () => {
  const refresh = useRefresh("categories");
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: CreateCategoryPayload; idempotencyKey?: string }) => CategoriesAPI.Create(payload, idempotencyKey),
    onSuccess: () => refresh(),
  });
};
export const useMutationUpdateCategory = () => {
  const refresh = useRefresh("categories");
  return useMutation({
    mutationFn: ({ id, payload, etag }: { id: number; payload: UpdateCategoryPayload; etag: string | undefined }) => CategoriesAPI.Update(id, payload, etag),
    onSuccess: (_r, { id }) => refresh(id),
  });
};
export const useMutationDeleteCategory = () => {
  const refresh = useRefresh("categories");
  return useMutation({
    mutationFn: ({ id, etag }: { id: number; etag: string | undefined }) => CategoriesAPI.Delete(id, etag),
    onSuccess: (_r, { id }) => refresh(id),
  });
};
export const useMutationRestoreCategory = () => {
  const refresh = useRefresh("categories");
  return useMutation({
    mutationFn: ({ id, etag }: { id: number; etag: string | undefined }) => CategoriesAPI.Restore(id, etag),
    onSuccess: (_r, { id }) => refresh(id),
  });
};

export const useMutationCreateTag = () => {
  const refresh = useRefresh("tags");
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: CreateTagPayload; idempotencyKey?: string }) => TagsAPI.Create(payload, idempotencyKey),
    onSuccess: () => refresh(),
  });
};
export const useMutationUpdateTag = () => {
  const refresh = useRefresh("tags");
  return useMutation({
    mutationFn: ({ id, payload, etag }: { id: number; payload: UpdateTagPayload; etag: string | undefined }) => TagsAPI.Update(id, payload, etag),
    onSuccess: (_r, { id }) => refresh(id),
  });
};
export const useMutationDeleteTag = () => {
  const refresh = useRefresh("tags");
  return useMutation({
    mutationFn: ({ id, etag }: { id: number; etag: string | undefined }) => TagsAPI.Delete(id, etag),
    onSuccess: (_r, { id }) => refresh(id),
  });
};
export const useMutationRestoreTag = () => {
  const refresh = useRefresh("tags");
  return useMutation({
    mutationFn: ({ id, etag }: { id: number; etag: string | undefined }) => TagsAPI.Restore(id, etag),
    onSuccess: (_r, { id }) => refresh(id),
  });
};
