// Seed rows for the pickers: the media manifest of doc/content-schemas/examples plus a few pages, posts,
// albums, categories, FAQ groups and forms, so every `x-ref` of the 12 section types has something to pick.
// Served by MSW in tests (`src/test/cms-handlers.ts`) and in memory by the dev playground (`memory-data.ts`).
import type { EntityOption, MediaAssetOption } from "@/types/cms";
import type { Locale } from "@/types/locales";

import manifest from "./examples/media-manifest.json";

// A flat grey tile with the number, as a data: URI (the admin CSP allows `img-src data:`); real thumbnails come
// with the media library (P2).
function tile(id: number, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="hsl(${(id * 47) % 360} 25% 80%)"/><text x="80" y="66" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#333">#${id} ${label.slice(0, 12)}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const MEDIA_FIXTURES: MediaAssetOption[] = (manifest as Array<{ media_id: number; file: string }>).map((m) => {
  const filename = m.file.split("/").pop() ?? String(m.media_id);
  return {
    id: m.media_id,
    filename,
    url: tile(m.media_id, filename),
    thumbnail_url: tile(m.media_id, filename),
    mime_type: filename.endsWith(".svg") ? "image/svg+xml" : "image/jpeg",
    status: "ready",
    width: 1600,
    height: 900,
    // Every third asset has an alt of its own, to exercise "alt falls back to the media's alt".
    alt: (m.media_id % 3 === 0 ? { la: `Alt ${filename}`, en: `Alt ${filename}` } : {}) as Record<string, string>,
  };
});

export const PAGE_FIXTURES: EntityOption[] = [
  { value: 1, label: "Home", hint: "/", status: "published" },
  { value: 2, label: "Our Path", hint: "/our-path", status: "published" },
  { value: 3, label: "Blog", hint: "/blog", status: "published" },
  { value: 4, label: "Gallery", hint: "/gallery", status: "published" },
  { value: 5, label: "Contact", hint: "/contact", status: "published" },
  { value: 6, label: "Spring campaign (draft)", hint: "/spring", status: "draft" },
];

export const POST_FIXTURES: EntityOption[] = [
  { value: 1, label: "Music night under the stars", hint: "music-night-under-the-stars", status: "published" },
  { value: 2, label: "Sunrise paddle on the Mekong", hint: "sunrise-paddle", status: "published" },
  { value: 3, label: "Unfinished trail notes", hint: "trail-notes", status: "draft" },
];

export const ALBUM_FIXTURES: EntityOption[] = [
  { value: 1, label: "Forest photo story", hint: "forest-photo-story", status: "published" },
  { value: 2, label: "Rivers", hint: "rivers", status: "draft" },
];

export const ALBUM_ITEM_FIXTURES: Record<number, EntityOption[]> = {
  1: [1, 2, 3, 4, 5].map((n) => ({ value: n, label: `Forest photo ${n}`, hint: `item ${n}` })),
  2: [6, 7].map((n) => ({ value: n, label: `River photo ${n - 5}`, hint: `item ${n}` })),
};

export const CATEGORY_FIXTURES: EntityOption[] = [
  { value: 1, label: "Journal", hint: "journal" },
  { value: 2, label: "Expeditions", hint: "expeditions" },
];

export const FAQ_GROUP_FIXTURES: EntityOption[] = [
  { value: "contact", label: "Contact", hint: "contact", status: "published" },
  { value: "booking", label: "Booking", hint: "booking", status: "draft" },
];

export const FORM_FIXTURES: EntityOption[] = [
  { value: "contact", label: "Contact form", hint: "contact", status: "published" },
  { value: "newsletter", label: "Newsletter", hint: "newsletter", status: "draft" },
];

export const LOCALE_FIXTURES = [
  { code: "la", name: "Lao", native_name: "ລາວ", short_label: "LO", is_default: true, is_active: true, fallback_code: null, sort_order: 1 },
  { code: "en", name: "English", native_name: "English", short_label: "EN", is_default: false, is_active: true, fallback_code: "la", sort_order: 2 },
  { code: "th", name: "Thai", native_name: "ไทย", short_label: "TH", is_default: false, is_active: false, fallback_code: "en", sort_order: 3 },
];

// `GET /locales` rows as the editor receives them.
export const LOCALE_ROWS: Locale[] = LOCALE_FIXTURES.map((l) => ({
  flag: null,
  text_direction: "ltr" as const,
  search_config: "simple",
  date_formats: null,
  created_at: "",
  updated_at: "",
  ...l,
}));
