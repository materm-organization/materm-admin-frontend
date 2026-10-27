import type { EntityOption, MediaAssetOption } from "@/types/cms";

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

export type SchemaFormData = {
  searchEntities: (kind: LookupKind, query: LookupQuery) => Promise<EntityOption[]>;
  // One row by the value stored in props (id, key or slug); `undefined` when it does not exist (any more).
  getEntity: (kind: LookupKind, value: number | string, query?: LookupQuery) => Promise<EntityOption | undefined>;
  searchMedia: (query: { keyword?: string; limit?: number }) => Promise<MediaAssetOption[]>;
  getMedia: (id: number) => Promise<MediaAssetOption | undefined>;
};
