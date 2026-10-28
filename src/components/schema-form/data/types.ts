import type { EntityOption, MediaAssetOption, MediaFolderOption } from "@/types/cms";

import type { EntityKind } from "../types";

// Where the pickers get their rows (doc/07 sections 4.3, 5.2). The default implementation calls the CMS API
// (`api-data.ts`); the dev playground plugs in an in-memory one, tests use MSW against the default.
export type LookupKind = EntityKind | "page";

export type LookupQuery = {
  keyword?: string;
  limit?: number;
  // `albumItem`: the album whose items are listed.
  albumId?: number;
};

// The MediaPicker's query (doc/05 11.6: `GET /media/assets`). `folderId: "root"` = assets without a folder.
export type MediaQuery = {
  keyword?: string;
  limit?: number;
  page?: number;
  folderId?: number | "root";
  includeSubfolders?: boolean;
  // Comma separated `kind` / `mime` filters (`image/*`).
  kind?: string;
  mime?: string;
  // Fetch exactly these rows (<= 50; the API takes `ids` alone, no other filter): the picker uses it to resolve the
  // images already chosen, wherever they are in the library.
  ids?: number[];
};

export type MediaPageResult = {
  items: MediaAssetOption[];
  total: number;
  page: number;
  totalPages: number;
};

export type SchemaFormData = {
  searchEntities: (kind: LookupKind, query: LookupQuery) => Promise<EntityOption[]>;
  // One row by the value stored in props (id, key or slug); `undefined` when it does not exist (any more).
  getEntity: (kind: LookupKind, value: number | string, query?: LookupQuery) => Promise<EntityOption | undefined>;
  searchMedia: (query: { keyword?: string; limit?: number }) => Promise<MediaAssetOption[]>;
  getMedia: (id: number) => Promise<MediaAssetOption | undefined>;
  // The MediaPicker (components/protected/media/media-picker.tsx) browses the library with these two.
  listMedia: (query: MediaQuery) => Promise<MediaPageResult>;
  listMediaFolders: () => Promise<MediaFolderOption[]>;
};
