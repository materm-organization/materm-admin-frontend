import type { EntityOption } from "@/types/cms";

import {
  ALBUM_FIXTURES,
  ALBUM_ITEM_FIXTURES,
  CATEGORY_FIXTURES,
  FAQ_GROUP_FIXTURES,
  FORM_FIXTURES,
  MEDIA_FIXTURES,
  PAGE_FIXTURES,
  POST_FIXTURES,
} from "../fixtures/lookup";
import type { LookupKind, SchemaFormData } from "./types";

// In-memory pickers over the seed rows: the dev playground (no backend exists yet) and tests of widgets that do
// not care about HTTP. MSW tests exercise `api-data.ts` instead.
function rowsOf(kind: LookupKind, albumId?: number): EntityOption[] {
  switch (kind) {
    case "page":
      return PAGE_FIXTURES;
    case "post":
      return POST_FIXTURES;
    case "album":
      return ALBUM_FIXTURES;
    case "albumItem":
      return albumId ? (ALBUM_ITEM_FIXTURES[albumId] ?? []) : [];
    case "category":
      return CATEGORY_FIXTURES;
    case "faqGroup":
      return FAQ_GROUP_FIXTURES;
    case "form":
      return FORM_FIXTURES;
  }
}

const delay = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 60));

export const memorySchemaFormData: SchemaFormData = {
  searchEntities: (kind, query) => {
    const keyword = query.keyword?.toLowerCase();
    const rows = rowsOf(kind, query.albumId).filter(
      (row) => !keyword || row.label.toLowerCase().includes(keyword) || row.hint?.toLowerCase().includes(keyword)
    );
    return delay(rows.slice(0, query.limit ?? 20));
  },
  getEntity: (kind, value, query) => delay(rowsOf(kind, query?.albumId).find((row) => row.value === value)),
  searchMedia: (query) => {
    const keyword = query.keyword?.toLowerCase();
    return delay(
      MEDIA_FIXTURES.filter((m) => !keyword || m.filename.toLowerCase().includes(keyword)).slice(0, query.limit ?? 24)
    );
  },
  getMedia: (id) => delay(MEDIA_FIXTURES.find((m) => m.id === id)),
  listMedia: (query) => {
    const keyword = query.keyword?.toLowerCase();
    const rows = MEDIA_FIXTURES.filter((m) => (query.ids ? query.ids.includes(m.id) : !keyword || m.filename.toLowerCase().includes(keyword)));
    const limit = query.limit ?? 24;
    const page = Math.max(1, query.page ?? 1);
    return delay({
      items: rows.slice((page - 1) * limit, page * limit),
      total: rows.length,
      page,
      totalPages: Math.max(1, Math.ceil(rows.length / limit)),
    });
  },
  // The fixture set has no folders.
  listMediaFolders: () => delay([]),
};
