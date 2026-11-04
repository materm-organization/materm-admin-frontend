import { ENTRY_SLUG_RE, MAX_ENTRY_SLUG, MAX_ENTRY_TITLE, MAX_SORT_ORDER } from "@/lib/collections/constants";
import { canonicalJson } from "@/lib/collections/schema-builder";
import type { CollectionEntryDetail, UpdateCollectionEntryPayload } from "@/types/collections";

// The form model of the entry editor (SCR-41): the shared `data`, the sort order and one row per language. Pure; the editor keeps one
// `EntryDraft`, `null` = untouched (the baseline is derived from the entry in the cache, so a saved entry re-bases itself).

export type EntryRow = { exists: boolean; title: string; slug: string; is_enabled: boolean; data: Record<string, unknown> };
export type EntryDraft = { sort_order: string; data: Record<string, unknown>; rows: Record<string, EntryRow> };
export type EntryEditMode = "full" | "translate" | "none";
export type EntryProblemCode = "required" | "too_long" | "pattern_mismatch" | "out_of_range";

export const emptyRow = (): EntryRow => ({ exists: false, title: "", slug: "", is_enabled: true, data: {} });

export function draftFromEntry(entry: CollectionEntryDetail, localeCodes: string[]): EntryDraft {
  const rows: Record<string, EntryRow> = {};
  for (const code of new Set([...localeCodes, ...Object.keys(entry.translations)])) {
    const t = entry.translations[code];
    rows[code] = t ? { exists: true, title: t.title, slug: t.slug ?? "", is_enabled: t.is_enabled, data: t.data ?? {} } : emptyRow();
  }
  return { sort_order: String(entry.sort_order), data: entry.data ?? {}, rows };
}

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

export function draftsEqual(a: EntryDraft, b: EntryDraft): boolean {
  if (a.sort_order !== b.sort_order || !same(a.data, b.data)) return false;
  const codes = new Set([...Object.keys(a.rows), ...Object.keys(b.rows)]);
  for (const code of codes) {
    const x = a.rows[code] ?? emptyRow();
    const y = b.rows[code] ?? emptyRow();
    if (x.exists !== y.exists) return false;
    if (x.exists && (x.title !== y.title || x.slug !== y.slug || x.is_enabled !== y.is_enabled || !same(x.data, y.data))) return false;
  }
  return true;
}

// Keys are `title.<l>`, `slug.<l>`, `sort_order`.
export function validateDraft(draft: EntryDraft, defaultLocale: string, hasSlug: boolean): Record<string, EntryProblemCode> {
  const out: Record<string, EntryProblemCode> = {};
  const order = Number(draft.sort_order);
  if (draft.sort_order.trim() === "" || !Number.isInteger(order) || order < 0 || order > MAX_SORT_ORDER) out.sort_order = "out_of_range";
  for (const [code, row] of Object.entries(draft.rows)) {
    if (!row.exists) {
      if (code === defaultLocale) out[`title.${code}`] = "required";
      continue;
    }
    const title = row.title.trim();
    if (title === "") out[`title.${code}`] = "required";
    else if ([...title].length > MAX_ENTRY_TITLE) out[`title.${code}`] = "too_long";
    if (hasSlug && row.slug !== "") {
      if (row.slug.length > MAX_ENTRY_SLUG) out[`slug.${code}`] = "too_long";
      else if (!ENTRY_SLUG_RE.test(row.slug)) out[`slug.${code}`] = "pattern_mismatch";
    }
  }
  return out;
}

// PATCH body: only what changed (05 17.8). `data` of the entry and of a language REPLACE the whole object, so they are sent whole and only when
// they differ. A translator (`translate`) sends title / slug / data of rows that exist and nothing else (C-8). `null` = nothing to send.
export function buildEntryPatch(baseline: EntryDraft, draft: EntryDraft, mode: EntryEditMode): UpdateCollectionEntryPayload | null {
  if (mode === "none") return null;
  const patch: UpdateCollectionEntryPayload = {};
  if (mode === "full") {
    if (Number(draft.sort_order) !== Number(baseline.sort_order)) patch.sort_order = Number(draft.sort_order);
    if (!same(draft.data, baseline.data)) patch.data = draft.data;
  }
  const translations: NonNullable<UpdateCollectionEntryPayload["translations"]> = {};
  for (const code of Object.keys(draft.rows)) {
    const now = draft.rows[code];
    const was = baseline.rows[code] ?? emptyRow();
    if (was.exists && !now.exists) {
      if (mode === "full") translations[code] = null;
    } else if (!was.exists && now.exists) {
      if (mode === "full") {
        translations[code] = { title: now.title.trim(), ...(now.slug !== "" ? { slug: now.slug } : {}), ...(Object.keys(now.data).length ? { data: now.data } : {}), is_enabled: now.is_enabled };
      }
    } else if (was.exists && now.exists) {
      const row: NonNullable<UpdateCollectionEntryPayload["translations"]>[string] & object = {};
      if (now.title.trim() !== was.title) row.title = now.title.trim();
      if (now.slug !== was.slug) row.slug = now.slug === "" ? null : now.slug;
      if (!same(now.data, was.data)) row.data = now.data;
      if (mode === "full" && now.is_enabled !== was.is_enabled) row.is_enabled = now.is_enabled;
      if (Object.keys(row).length > 0) translations[code] = row;
    }
  }
  if (Object.keys(translations).length > 0) patch.translations = translations;
  return Object.keys(patch).length === 0 ? null : patch;
}

// A server pointer -> where the editor shows it: `/translations/en/slug` -> {kind: "row", locale: "en", field: "slug"}.
export type PointerTarget =
  | { kind: "shared"; pointer: string }
  | { kind: "localized"; locale: string; pointer: string }
  | { kind: "row"; locale: string; field: "title" | "slug" | "is_enabled" | "language" }
  | { kind: "sort_order" }
  | { kind: "other" };
export function pointerTarget(path: string): PointerTarget {
  if (path === "/data" || path.startsWith("/data/")) return { kind: "shared", pointer: path };
  if (path === "/sort_order") return { kind: "sort_order" };
  const m = /^\/translations\/([^/]+)(?:\/(.*))?$/.exec(path);
  if (!m) return { kind: "other" };
  const [, locale, rest = ""] = m;
  if (rest === "data" || rest.startsWith("data/")) return { kind: "localized", locale, pointer: path };
  if (rest === "title" || rest === "slug" || rest === "is_enabled") return { kind: "row", locale, field: rest };
  return { kind: "row", locale, field: "language" };
}
