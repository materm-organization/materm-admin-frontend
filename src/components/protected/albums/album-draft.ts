// The form model of an album (T1.5.6, doc/05 13.4): the Details tab (title and description per language, the cover). The pictures are NOT
// part of it: each picture command is written at once through its own endpoint, so there is no draft of them to lose.
import { MAX_ALBUM_DESCRIPTION, MAX_ALBUM_TITLE, charCount } from "@/lib/albums";
import type { AlbumDetail, UpdateAlbumPayload } from "@/types/albums";
import type { SettingsMediaRef } from "@/types/settings";

export type AlbumEditMode = "full" | "translate" | "none";
export type AlbumRowDraft = { title: string; description: string };
export type AlbumDraft = {
  // One entry per active language ("" / "" = no row yet).
  translations: Record<string, AlbumRowDraft>;
  cover_media_id: number | null;
  cover: SettingsMediaRef | null;
};

export type AlbumProblemCode = "required" | "too_long" | "titleRequired";

export function draftFromAlbum(album: AlbumDetail, localeCodes: readonly string[]): AlbumDraft {
  const translations: Record<string, AlbumRowDraft> = {};
  for (const code of localeCodes) {
    const row = album.translations[code];
    translations[code] = { title: row?.title ?? "", description: row?.description ?? "" };
  }
  return { translations, cover_media_id: album.cover_media_id, cover: album.cover_media };
}

export function draftsEqual(a: AlbumDraft, b: AlbumDraft): boolean {
  if (a.cover_media_id !== b.cover_media_id) return false;
  const codes = new Set([...Object.keys(a.translations), ...Object.keys(b.translations)]);
  for (const code of codes) {
    const x = a.translations[code] ?? { title: "", description: "" };
    const y = b.translations[code] ?? { title: "", description: "" };
    if (x.title !== y.title || x.description !== y.description) return false;
  }
  return true;
}

const hasRow = (row: AlbumRowDraft | undefined) => Boolean(row && (row.title.trim() !== "" || row.description.trim() !== ""));

// Keys: `title.<l>`, `description.<l>`.
export function validateDraft(draft: AlbumDraft, baseline: AlbumDraft, defaultLocale: string): Record<string, AlbumProblemCode> {
  const problems: Record<string, AlbumProblemCode> = {};
  for (const [code, row] of Object.entries(draft.translations)) {
    const title = row.title.trim();
    if (charCount(row.title) > MAX_ALBUM_TITLE) problems[`title.${code}`] = "too_long";
    if (charCount(row.description) > MAX_ALBUM_DESCRIPTION) problems[`description.${code}`] = "too_long";
    // A language row has a title; the default language always has one (the server refuses an empty one).
    if (title === "" && (row.description.trim() !== "" || code === defaultLocale || hasRow(baseline.translations[code])) && !problems[`title.${code}`]) {
      // A non-default language the person emptied completely is removed, not refused.
      const removing = code !== defaultLocale && row.description.trim() === "" && hasRow(baseline.translations[code]);
      if (!removing) problems[`title.${code}`] = code === defaultLocale ? "required" : "titleRequired";
    }
  }
  return problems;
}

// Only what changed; a language whose texts are all cleared is removed (`null`), never the default one; a cleared description is `null`.
export function buildAlbumPatch(baseline: AlbumDraft, edit: AlbumDraft, defaultLocale: string, mode: AlbumEditMode): UpdateAlbumPayload | null {
  if (mode === "none") return null;
  const patch: UpdateAlbumPayload = {};
  const translations: NonNullable<UpdateAlbumPayload["translations"]> = {};
  for (const [code, row] of Object.entries(edit.translations)) {
    const base = baseline.translations[code] ?? { title: "", description: "" };
    if (row.title === base.title && row.description === base.description) continue;
    if (row.title.trim() === "" && row.description.trim() === "") {
      if (mode === "full" && code !== defaultLocale && hasRow(base)) translations[code] = null;
      continue;
    }
    const part: { title?: string; description?: string | null } = {};
    if (row.title !== base.title) part.title = row.title.trim();
    if (row.description !== base.description) part.description = row.description.trim() === "" ? null : row.description;
    translations[code] = part;
  }
  if (Object.keys(translations).length > 0) patch.translations = translations;
  if (mode === "full" && edit.cover_media_id !== baseline.cover_media_id) patch.cover_media_id = edit.cover_media_id;
  return Object.keys(patch).length > 0 ? patch : null;
}

// Where a server field error belongs: `/translations/la/title` -> `title.la`; `/cover_media_id` -> `cover`.
export function problemKeyOf(path: string): string {
  const t = /^\/translations\/([^/]+)\/([a-z_]+)/.exec(path);
  if (t) return `${t[2]}.${t[1]}`;
  if (path.startsWith("/cover_media_id")) return "cover";
  return path.replace(/^\//, "") || "album";
}

// "Go to field": which tab and language a publish blocker pointer belongs to.
export type AlbumPointerTarget = { tab: "items" | "details"; locale?: string; itemId?: number; field: string };
export function pointerTarget(pointer: string, itemIdOf: (publicId: string) => number | undefined): AlbumPointerTarget {
  const item = /^\/items\/([^/]+)/.exec(pointer);
  if (item) return { tab: "items", itemId: itemIdOf(item[1]), field: "item" };
  const t = /^\/translations\/([^/]+)\/([a-z_]+)/.exec(pointer);
  if (t) return { tab: "details", locale: t[1], field: `${t[2]}.${t[1]}` };
  if (pointer.startsWith("/cover_media_id")) return { tab: "details", field: "cover" };
  return { tab: "details", field: "title" };
}
