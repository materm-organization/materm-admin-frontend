import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { ApiResponse } from "@/types/api";
import type { EntityOption, MediaAssetOption, MediaFolderOption } from "@/types/cms";

import type { LookupKind, LookupQuery, MediaPageResult, MediaQuery, SchemaFormData } from "./types";

// The CMS list endpoints of 05 section 6 are still a catalogue (their row schemas come with parts 2-4 of the
// "05 continuation"), so rows are read tolerantly: the value is `id` (or `key` / `slug` for FAQ groups and
// forms), the label the first of title / name / filename. When the real shapes differ, THIS is the only file
// to adjust.
type Row = Record<string, unknown>;

type Config = {
  endpoint: (query: LookupQuery) => string;
  value: "id" | "key" | "slug";
  label: string[];
  hint: string[];
};

const CONFIG: Record<LookupKind, Config> = {
  page: { endpoint: () => API_ENDPOINTS.PAGES.LIST, value: "id", label: ["title", "name"], hint: ["path"] },
  post: { endpoint: () => API_ENDPOINTS.POSTS.LIST, value: "id", label: ["title", "name"], hint: ["slug"] },
  album: { endpoint: () => API_ENDPOINTS.ALBUMS.LIST, value: "id", label: ["title", "name"], hint: ["key", "slug"] },
  albumItem: {
    endpoint: (q) => API_ENDPOINTS.ALBUMS.ITEMS(q.albumId ?? 0),
    value: "id",
    label: ["title", "caption", "filename"],
    hint: [],
  },
  category: { endpoint: () => API_ENDPOINTS.CATEGORIES.LIST, value: "id", label: ["name", "title"], hint: ["key", "slug"] },
  faqGroup: { endpoint: () => API_ENDPOINTS.FAQ_GROUPS.LIST, value: "key", label: ["name", "title"], hint: ["key"] },
  form: { endpoint: () => API_ENDPOINTS.FORMS.LIST, value: "slug", label: ["name", "title"], hint: ["slug"] },
};

function firstString(row: Row, names: string[]): string | undefined {
  for (const name of names) {
    const value = row[name];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

// A translated name may come as a plain string or as a locale map / list; take any readable text.
function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const first = Object.values(value as Row).find((v) => typeof v === "string" && v.trim());
    return first as string | undefined;
  }
  return undefined;
}

// A picture of an album (doc/05 13.4.1 `AlbumItem`) has no title of its own: its caption title in the first language that has one, else
// the file name of the picture.
function albumItemLabel(row: Row): string | undefined {
  const translations = row.translations;
  if (translations && typeof translations === "object" && !Array.isArray(translations)) {
    for (const t of Object.values(translations as Record<string, Row>)) {
      const caption = t?.caption_title;
      if (typeof caption === "string" && caption.trim()) return caption;
    }
  }
  const media = row.media as Row | undefined;
  return typeof media?.original_filename === "string" ? media.original_filename : undefined;
}

export function toEntityOption(kind: LookupKind, row: Row): EntityOption | undefined {
  const config = CONFIG[kind];
  const rawValue = row[config.value];
  if (typeof rawValue !== "number" && typeof rawValue !== "string") return undefined;
  const label = firstString(row, config.label) ?? (kind === "albumItem" ? albumItemLabel(row) : undefined) ?? textOf(row[config.label[0]]) ?? String(rawValue);
  const hint = firstString(row, config.hint);
  const status = typeof row.status === "string" ? row.status : undefined;
  return { value: rawValue, label, hint, status };
}

export function toMediaOption(row: Row): MediaAssetOption | undefined {
  if (typeof row.id !== "number") return undefined;
  let alt: Record<string, string> | undefined;
  if (row.alt && typeof row.alt === "object" && !Array.isArray(row.alt)) alt = row.alt as Record<string, string>;
  else if (Array.isArray(row.translations)) {
    alt = {};
    for (const t of row.translations as Row[]) {
      if (typeof t.locale === "string" && typeof t.alt === "string") alt[t.locale] = t.alt;
    }
  } else if (row.translations && typeof row.translations === "object") {
    // doc/05 11.6: `translations` is a map `{ "<locale>": { alt, caption, credit } }`.
    alt = {};
    for (const [locale, t] of Object.entries(row.translations as Record<string, Row>)) {
      if (t && typeof t.alt === "string") alt[locale] = t.alt;
    }
  }
  const url = typeof row.url === "string" ? row.url : null;
  const focal = row.focal as { x?: unknown; y?: unknown } | null | undefined;
  return {
    id: row.id,
    // doc/05 11.6 `original_filename`; the older adapter names stay accepted.
    filename: String(row.original_filename ?? row.filename ?? row.original_name ?? row.id),
    url,
    thumbnail_url: typeof row.thumbnail_url === "string" ? row.thumbnail_url : url,
    mime_type: typeof row.mime_type === "string" ? row.mime_type : undefined,
    status: typeof row.status === "string" ? row.status : undefined,
    width: typeof row.width === "number" ? row.width : null,
    height: typeof row.height === "number" ? row.height : null,
    alt,
    kind: typeof row.kind === "string" ? row.kind : undefined,
    bytes: typeof row.bytes === "number" ? row.bytes : undefined,
    folder_id: typeof row.folder_id === "number" ? row.folder_id : row.folder_id === null ? null : undefined,
    focal: focal && typeof focal.x === "number" && typeof focal.y === "number" ? { x: focal.x, y: focal.y } : null,
    is_decorative: typeof row.is_decorative === "boolean" ? row.is_decorative : undefined,
    usage_count: typeof row.usage_count === "number" ? row.usage_count : undefined,
  };
}

function rowsOf(response: ApiResponse<unknown>): Row[] {
  return Array.isArray(response.data) ? (response.data as Row[]) : [];
}

export const apiSchemaFormData: SchemaFormData = {
  async searchEntities(kind, query) {
    if (kind === "albumItem" && !query.albumId) return [];
    const params: Record<string, unknown> = { limit: query.limit ?? 20 };
    if (query.keyword) params.keyword = query.keyword;
    const { data } = await axiosInstance.get<ApiResponse<unknown>>(CONFIG[kind].endpoint(query), { params });
    return rowsOf(data)
      .map((row) => toEntityOption(kind, row))
      .filter((option): option is EntityOption => Boolean(option));
  },

  async getEntity(kind, value, query = {}) {
    // The documented detail routes exist for ids; for key / slug references the picker lists and finds it.
    if (kind === "post" || kind === "page" || kind === "album" || kind === "category") {
      const detail = {
        post: API_ENDPOINTS.POSTS.DETAIL,
        page: API_ENDPOINTS.PAGES.DETAIL,
        album: API_ENDPOINTS.ALBUMS.DETAIL,
        category: API_ENDPOINTS.CATEGORIES.DETAIL,
      }[kind];
      try {
        const { data } = await axiosInstance.get<ApiResponse<Row>>(detail(value));
        return toEntityOption(kind, data.data);
      } catch {
        return undefined;
      }
    }
    const all = await apiSchemaFormData.searchEntities(kind, { ...query, limit: 200 });
    return all.find((option) => option.value === value);
  },

  async searchMedia(query) {
    const params: Record<string, unknown> = { limit: query.limit ?? 24 };
    if (query.keyword) params.keyword = query.keyword;
    const { data } = await axiosInstance.get<ApiResponse<unknown>>(API_ENDPOINTS.MEDIA.ASSETS, { params });
    return rowsOf(data)
      .map(toMediaOption)
      .filter((option): option is MediaAssetOption => Boolean(option));
  },

  async listMedia(query: MediaQuery): Promise<MediaPageResult> {
    const limit = query.limit ?? 24;
    // `ids` can not be combined with any other filter (422 `unknown_field`): it is sent alone.
    const params: Record<string, unknown> = query.ids
      ? { ids: query.ids.slice(0, 50).join(","), page: 1, limit: Math.min(50, Math.max(1, query.ids.length)) }
      : { limit, page: query.page ?? 1 };
    if (query.keyword && !query.ids) params.keyword = query.keyword;
    if (!query.ids) {
      if (query.folderId !== undefined) params.folder_id = query.folderId;
      if (query.folderId !== undefined && query.folderId !== "root" && query.includeSubfolders) params.include_subfolders = true;
      if (query.kind) params.kind = query.kind;
      if (query.mime) params.mime = query.mime;
    }
    const { data } = await axiosInstance.get<ApiResponse<unknown> & { meta?: { total?: number; page?: number; total_page?: number } }>(
      API_ENDPOINTS.MEDIA.ASSETS,
      { params }
    );
    const items = rowsOf(data)
      .map(toMediaOption)
      .filter((option): option is MediaAssetOption => Boolean(option));
    // The old list shape had no `meta`: then the rows are all there is.
    const total = typeof data.meta?.total === "number" ? data.meta.total : items.length;
    return {
      items,
      total,
      page: data.meta?.page ?? query.page ?? 1,
      totalPages: data.meta?.total_page ?? Math.max(1, Math.ceil(total / limit)),
    };
  },

  async listMediaFolders(): Promise<MediaFolderOption[]> {
    const { data } = await axiosInstance.get<ApiResponse<unknown>>(API_ENDPOINTS.MEDIA.FOLDERS);
    return rowsOf(data)
      .filter((row) => typeof row.id === "number" && typeof row.name === "string")
      .map((row) => ({
        id: row.id as number,
        name: row.name as string,
        path: typeof row.path === "string" ? row.path : (row.name as string),
        depth: typeof row.depth === "number" ? row.depth : 1,
        parentId: typeof row.parent_id === "number" ? row.parent_id : null,
        assetCount: typeof row.asset_count === "number" ? row.asset_count : undefined,
      }));
  },

  async getMedia(id) {
    try {
      const { data } = await axiosInstance.get<ApiResponse<Row>>(API_ENDPOINTS.MEDIA.ASSET(id));
      return toMediaOption(data.data);
    } catch {
      return undefined;
    }
  },
};
