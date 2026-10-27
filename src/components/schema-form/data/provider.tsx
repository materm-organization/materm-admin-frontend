"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";

import type { EntityOption, MediaAssetOption } from "@/types/cms";

import { apiSchemaFormData } from "./api-data";
import type { LookupKind, LookupQuery, SchemaFormData } from "./types";

const DataContext = createContext<SchemaFormData>(apiSchemaFormData);

// Swap where the pickers read from (the dev playground and tests use in-memory rows; the editors use the API).
export function SchemaFormDataProvider({ data, children }: { data: SchemaFormData; children: ReactNode }) {
  return <DataContext.Provider value={data}>{children}</DataContext.Provider>;
}

export function useSchemaFormData(): SchemaFormData {
  return useContext(DataContext);
}

// Lookups are picked from lazily (only when a popover opens) and small, so a short stale time is plenty.
const STALE = 30_000;

export function useEntityOptions(kind: LookupKind, keyword: string, enabled: boolean, albumId?: number) {
  const data = useSchemaFormData();
  return useQuery<EntityOption[]>({
    queryKey: ["schema-form", "entities", kind, keyword, albumId ?? null],
    queryFn: () => data.searchEntities(kind, { keyword: keyword || undefined, limit: 20, albumId }),
    enabled,
    staleTime: STALE,
  });
}

export function useEntity(kind: LookupKind, value: number | string | undefined, query?: LookupQuery) {
  const data = useSchemaFormData();
  return useQuery<EntityOption | null>({
    queryKey: ["schema-form", "entity", kind, value ?? null, query?.albumId ?? null],
    queryFn: async () => (await data.getEntity(kind, value as number | string, query)) ?? null,
    enabled: value !== undefined && value !== "",
    staleTime: STALE,
  });
}

export function useMediaSearch(keyword: string, enabled: boolean) {
  const data = useSchemaFormData();
  return useQuery<MediaAssetOption[]>({
    queryKey: ["schema-form", "media-search", keyword],
    queryFn: () => data.searchMedia({ keyword: keyword || undefined, limit: 24 }),
    enabled,
    staleTime: STALE,
  });
}

export function useMediaAsset(id: number | undefined) {
  const data = useSchemaFormData();
  return useQuery<MediaAssetOption | null>({
    queryKey: ["schema-form", "media", id ?? null],
    queryFn: async () => (await data.getMedia(id as number)) ?? null,
    enabled: typeof id === "number" && id > 0,
    staleTime: STALE,
  });
}
