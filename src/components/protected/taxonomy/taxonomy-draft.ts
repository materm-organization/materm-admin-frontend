// Form state of a category / tag and what leaves it (doc/05 section 11.5, doc/07 section 3.16). Pure.
import type { ApiFieldError } from "@/types/api";
import type { Category, Tag, TaxonomyKind } from "@/types/taxonomy";

export const CATEGORY_KEY = /^[a-z][a-z0-9_-]{0,39}$/;
export const TAG_KEY = /^[a-z0-9][a-z0-9_-]{0,59}$/;
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_NAME = 60;
export const MAX_DESCRIPTION = 300;
export const MAX_SLUG = 100;

export type TranslationDraft = { name: string; slug: string; description: string };
export type TaxonomyDraft = {
  key: string;
  sortOrder: string;
  isActive: boolean;
  translations: Record<string, TranslationDraft>;
};

export const emptyTaxonomyDraft = (locales: readonly string[], nextSort = 1): TaxonomyDraft => ({
  key: "",
  sortOrder: String(nextSort),
  isActive: true,
  translations: Object.fromEntries(locales.map((c) => [c, { name: "", slug: "", description: "" }])),
});

export function draftFromRow(row: Category | Tag, locales: readonly string[]): TaxonomyDraft {
  const translations: Record<string, TranslationDraft> = {};
  for (const code of locales) {
    const t = row.translations[code] as { name?: string; slug?: string; description?: string | null } | undefined;
    translations[code] = { name: t?.name ?? "", slug: t?.slug ?? "", description: t?.description ?? "" };
  }
  return {
    key: row.key,
    sortOrder: "sort_order" in row ? String(row.sort_order) : "0",
    isActive: "is_active" in row ? row.is_active : true,
    translations,
  };
}

const norm = (t: TranslationDraft) => ({ name: t.name.trim(), slug: t.slug.trim(), description: t.description.trim() });

export function changedLocales(saved: TaxonomyDraft, draft: TaxonomyDraft): string[] {
  return Object.keys(draft.translations).filter((c) => JSON.stringify(norm(draft.translations[c])) !== JSON.stringify(norm(saved.translations[c] ?? { name: "", slug: "", description: "" })));
}

export const isChanged = (saved: TaxonomyDraft, draft: TaxonomyDraft, kind: TaxonomyKind) =>
  changedLocales(saved, draft).length > 0 ||
  (kind === "categories" && (saved.isActive !== draft.isActive || saved.sortOrder.trim() !== draft.sortOrder.trim()));

function translationPayload(kind: TaxonomyKind, t: TranslationDraft) {
  const n = norm(t);
  return {
    name: n.name,
    ...(n.slug ? { slug: n.slug } : {}),
    ...(kind === "categories" ? { description: n.description === "" ? null : n.description } : {}),
  };
}

export function buildCreatePayload(kind: TaxonomyKind, draft: TaxonomyDraft) {
  const translations: Record<string, ReturnType<typeof translationPayload>> = {};
  for (const [code, t] of Object.entries(draft.translations)) if (t.name.trim()) translations[code] = translationPayload(kind, t);
  return kind === "categories"
    ? { key: draft.key.trim(), is_active: draft.isActive, ...(draft.sortOrder.trim() ? { sort_order: Number(draft.sortOrder) } : {}), translations }
    : { key: draft.key.trim(), translations };
}

// PATCH: changed languages only (a non-default language whose name was cleared is deleted: `null`).
export function buildUpdatePayload(kind: TaxonomyKind, saved: TaxonomyDraft, draft: TaxonomyDraft, defaultLocale: string, options: { translateOnly?: boolean } = {}) {
  const out: { sort_order?: number; is_active?: boolean; translations?: Record<string, ReturnType<typeof translationPayload> | null> } = {};
  if (kind === "categories" && !options.translateOnly) {
    if (saved.sortOrder.trim() !== draft.sortOrder.trim()) out.sort_order = Number(draft.sortOrder);
    if (saved.isActive !== draft.isActive) out.is_active = draft.isActive;
  }
  const codes = changedLocales(saved, draft);
  if (codes.length) {
    out.translations = {};
    for (const code of codes) {
      const t = draft.translations[code];
      out.translations[code] = !t.name.trim() && code !== defaultLocale ? null : translationPayload(kind, t);
    }
  }
  return out;
}

export function validate(kind: TaxonomyKind, draft: TaxonomyDraft, defaultLocale: string, mode: "create" | "edit"): ApiFieldError[] {
  const errors: ApiFieldError[] = [];
  const add = (path: string, code: string, params?: ApiFieldError["params"]) => errors.push({ in: "body", path, code, ...(params ? { params } : {}) });
  if (mode === "create") {
    if (!draft.key.trim()) add("/key", "required");
    else if (!(kind === "categories" ? CATEGORY_KEY : TAG_KEY).test(draft.key.trim())) add("/key", "pattern_mismatch");
  }
  if (!draft.translations[defaultLocale]?.name.trim()) add(`/translations/${defaultLocale}/name`, "required");
  for (const [code, t] of Object.entries(draft.translations)) {
    if ([...t.name.trim()].length > MAX_NAME) add(`/translations/${code}/name`, "too_long", { max: MAX_NAME });
    const slug = t.slug.trim();
    if (slug && !SLUG.test(slug)) add(`/translations/${code}/slug`, "pattern_mismatch");
    else if (slug.length > MAX_SLUG) add(`/translations/${code}/slug`, "too_long", { max: MAX_SLUG });
    if (kind === "categories" && [...t.description.trim()].length > MAX_DESCRIPTION) add(`/translations/${code}/description`, "too_long", { max: MAX_DESCRIPTION });
  }
  if (kind === "categories" && draft.sortOrder.trim() !== "" && !(/^\d{1,5}$/.test(draft.sortOrder.trim()) && Number(draft.sortOrder) <= 10000)) {
    add("/sort_order", "out_of_range");
  }
  return errors;
}

// The row in the shape of a revision snapshot (05 11.7 item 3).
export function rowSnapshot(kind: TaxonomyKind, row: Category | Tag): Record<string, unknown> {
  const translations = Object.entries(row.translations).map(([locale_code, t]) => {
    const x = t as { name: string; slug?: string; description?: string | null };
    return kind === "categories"
      ? { locale_code, name: x.name, slug: x.slug ?? row.key, description: x.description ?? null }
      : { locale_code, name: x.name, slug: x.slug ?? row.key };
  });
  return kind === "categories"
    ? { category: { key: row.key, sort_order: (row as Category).sort_order, is_active: (row as Category).is_active }, translations }
    : { tag: { key: row.key }, translations };
}
