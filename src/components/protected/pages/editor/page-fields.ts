// The page-level fields of the editor (Details + SEO tabs): the draft the forms edit, the client checks and the
// `PATCH /pages/{id}` body built from what changed (doc/05 12.3.1 - 12.3.3, doc/07 SCR-20). The server decides for
// real; these only save a round trip and say what is wrong at the field.
import { MAX_PATH, MAX_TITLE, pathProblem, type PathProblem } from "@/components/protected/pages/page-draft";
import type { PageDetail, UpdatePagePayload } from "@/types/pages";

export const MAX_NAME = 120;
export const MAX_SEO_TITLE = 120;
export const MAX_SEO_DESCRIPTION = 320;
// Recommended lengths of a search result (warnings only, 05 12.3.1).
export const SERP_TITLE = 60;
export const SERP_DESCRIPTION = 160;

export type LocaleDraft = {
  // The page has a translation row for this language.
  exists: boolean;
  title: string;
  seo_title: string;
  seo_title_absolute: boolean;
  seo_description: string;
  og_image_id: number | null;
  canonical_path: string;
  is_enabled: boolean;
};

export type PageFieldsDraft = {
  name: string;
  path: string;
  template: string;
  noindex: boolean;
  in_sitemap: boolean;
  // Text of the input; a whole number >= 0 when valid.
  sort_order: string;
  translations: Record<string, LocaleDraft>;
};

export const emptyLocaleDraft = (): LocaleDraft => ({
  exists: false,
  title: "",
  seo_title: "",
  seo_title_absolute: false,
  seo_description: "",
  og_image_id: null,
  canonical_path: "",
  is_enabled: true,
});

export function draftFromPage(page: PageDetail, localeCodes: string[]): PageFieldsDraft {
  const codes = [...new Set([...localeCodes, ...Object.keys(page.translations ?? {})])];
  const translations: Record<string, LocaleDraft> = {};
  for (const code of codes) {
    const t = page.translations?.[code];
    translations[code] = t
      ? {
          exists: true,
          title: t.title ?? "",
          seo_title: t.seo_title ?? "",
          seo_title_absolute: t.seo_title_absolute ?? false,
          seo_description: t.seo_description ?? "",
          og_image_id: t.og_image_id ?? null,
          canonical_path: t.canonical_path ?? "",
          is_enabled: t.is_enabled ?? true,
        }
      : emptyLocaleDraft();
  }
  return {
    name: page.name,
    path: page.path,
    template: page.template,
    noindex: page.noindex,
    in_sitemap: page.in_sitemap,
    sort_order: String(page.sort_order),
    translations,
  };
}

export const fieldsEqual = (a: PageFieldsDraft, b: PageFieldsDraft) => JSON.stringify(a) === JSON.stringify(b);

const len = (s: string) => [...s].length;
const hasSeo = (t: LocaleDraft) => t.seo_title.trim() !== "" || t.seo_description.trim() !== "" || t.og_image_id !== null || t.canonical_path.trim() !== "";

export type FieldProblemCode = "required" | "too_long" | "title_required" | "format" | "negative" | PathProblem;

// Key: `name`, `path`, `sort_order`, `title.<l>`, `seo_title.<l>`, `seo_description.<l>`, `canonical_path.<l>`.
export type FieldProblems = Record<string, FieldProblemCode>;

export function validateFields(draft: PageFieldsDraft, baseline: PageFieldsDraft, defaultLocale: string): FieldProblems {
  const problems: FieldProblems = {};
  const name = draft.name.trim();
  if (!name) problems.name = "required";
  else if (len(name) > MAX_NAME) problems.name = "too_long";

  // An unchanged address is not checked: the home page keeps `/`, which the creation rules refuse.
  if (draft.path.trim() !== baseline.path) {
    const problem = pathProblem(draft.path.trim());
    if (problem) problems.path = problem;
  }
  if (!/^\d{1,9}$/.test(draft.sort_order.trim())) problems.sort_order = "negative";

  for (const [code, t] of Object.entries(draft.translations)) {
    const title = t.title.trim();
    if (code === defaultLocale && !title) problems[`title.${code}`] = "required";
    else if (!title && hasSeo(t)) problems[`title.${code}`] = "title_required";
    else if (len(title) > MAX_TITLE) problems[`title.${code}`] = "too_long";
    if (len(t.seo_title.trim()) > MAX_SEO_TITLE) problems[`seo_title.${code}`] = "too_long";
    if (len(t.seo_description.trim()) > MAX_SEO_DESCRIPTION) problems[`seo_description.${code}`] = "too_long";
    const canonical = t.canonical_path.trim();
    if (canonical && (!/^\/[^\s]*$/.test(canonical) || len(canonical) > MAX_PATH)) problems[`canonical_path.${code}`] = "format";
  }
  return problems;
}

const orNull = (v: string) => (v.trim() === "" ? null : v.trim());

// Only what changed (05 12.3.3): a language the page did not have is added with its filled fields, a language whose
// title and SEO texts were all cleared is removed (`null`; never the default language), the rest is a field diff.
export function buildPatch(baseline: PageFieldsDraft, draft: PageFieldsDraft, defaultLocale: string): UpdatePagePayload | null {
  const payload: UpdatePagePayload = {};
  if (draft.name.trim() !== baseline.name) payload.name = draft.name.trim();
  if (draft.path.trim() !== baseline.path) payload.path = draft.path.trim();
  if (draft.template !== baseline.template) payload.template = draft.template;
  if (draft.noindex !== baseline.noindex) payload.noindex = draft.noindex;
  if (draft.in_sitemap !== baseline.in_sitemap) payload.in_sitemap = draft.in_sitemap;
  if (Number(draft.sort_order) !== Number(baseline.sort_order)) payload.sort_order = Number(draft.sort_order);

  const translations: NonNullable<UpdatePagePayload["translations"]> = {};
  for (const [code, d] of Object.entries(draft.translations)) {
    const b = baseline.translations[code] ?? emptyLocaleDraft();
    if (JSON.stringify(b) === JSON.stringify(d)) continue;
    const nothing = !d.title.trim() && !hasSeo(d);
    if (b.exists && nothing && code !== defaultLocale) {
      translations[code] = null;
      continue;
    }
    if (!b.exists) {
      if (nothing) continue;
      translations[code] = {
        title: d.title.trim(),
        ...(orNull(d.seo_title) !== null ? { seo_title: orNull(d.seo_title) } : {}),
        ...(d.seo_title_absolute ? { seo_title_absolute: true } : {}),
        ...(orNull(d.seo_description) !== null ? { seo_description: orNull(d.seo_description) } : {}),
        ...(d.og_image_id !== null ? { og_image_id: d.og_image_id } : {}),
        ...(orNull(d.canonical_path) !== null ? { canonical_path: orNull(d.canonical_path) } : {}),
        ...(d.is_enabled ? {} : { is_enabled: false }),
      };
      continue;
    }
    const diff: NonNullable<UpdatePagePayload["translations"]>[string] = {};
    if (d.title.trim() !== b.title.trim()) (diff as Record<string, unknown>).title = d.title.trim();
    if (orNull(d.seo_title) !== orNull(b.seo_title)) diff.seo_title = orNull(d.seo_title);
    if (d.seo_title_absolute !== b.seo_title_absolute) diff.seo_title_absolute = d.seo_title_absolute;
    if (orNull(d.seo_description) !== orNull(b.seo_description)) diff.seo_description = orNull(d.seo_description);
    if (d.og_image_id !== b.og_image_id) diff.og_image_id = d.og_image_id;
    if (orNull(d.canonical_path) !== orNull(b.canonical_path)) diff.canonical_path = orNull(d.canonical_path);
    if (d.is_enabled !== b.is_enabled) diff.is_enabled = d.is_enabled;
    if (diff && Object.keys(diff).length > 0) translations[code] = diff;
  }
  if (Object.keys(translations).length > 0) payload.translations = translations;
  return Object.keys(payload).length > 0 ? payload : null;
}

// 05 12.3.1: changing the address of a page that was ever published leaves the old address without a page.
export const pathChangesPublished = (page: Pick<PageDetail, "first_published_at">, baselinePath: string, path: string) =>
  Boolean(page.first_published_at) && path.trim() !== "" && path.trim() !== baselinePath;

// Which tab a page-level pointer (`/translations/en/seo_title`, `/path` ...) belongs to.
export function pagePointerTab(pointer: string): "details" | "seo" | null {
  if (/^\/translations\/[^/]+\/(seo_title|seo_title_absolute|seo_description|og_image_id|canonical_path)$/.test(pointer)) return "seo";
  if (/^\/(noindex|in_sitemap)$/.test(pointer)) return "seo";
  if (/^\/(path|name|template|sort_order)$/.test(pointer) || /^\/translations\/[^/]+(\/(title|is_enabled))?$/.test(pointer)) return "details";
  return null;
}

// The DOM id of the input a page-level pointer names (the forms put these ids on their inputs).
export function pagePointerFieldId(pointer: string): string | null {
  const m = /^\/translations\/([^/]+)\/([a-z_]+)$/.exec(pointer);
  if (m) return `page-field-${m[2]}-${m[1]}`;
  const top = /^\/([a-z_]+)$/.exec(pointer);
  return top ? `page-field-${top[1]}` : null;
}
