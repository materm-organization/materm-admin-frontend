// The post editor's form model (doc/05 section 13.3, doc/07 SCR-25): the draft the forms edit, the client checks and the
// requests built from what changed. The server decides for real; these only save a round trip and say what is wrong at the
// field. ONE draft holds everything (Content, Details, SEO and the gallery), so a tab switch loses nothing.
import {
  MAX_BODY_BYTES,
  MAX_EXCERPT,
  MAX_GALLERY_ALT,
  MAX_GALLERY_CAPTION,
  MAX_GALLERY_DESCRIPTION,
  MAX_GALLERY_HEADING,
  MAX_GALLERY_ITEMS,
  MAX_HERO_ALT,
  MAX_LABEL,
  MAX_LOCATION_LABEL,
  MAX_POST_TITLE,
  MAX_SEO_DESCRIPTION,
  MAX_SEO_TITLE,
  MAX_TAGS,
  charCount,
  jsonBytes,
  slugProblem,
} from "@/lib/posts";
import type { SettingsMediaRef } from "@/types/settings";
import type { PostDetail, PostMediaInput, PostMediaTranslation, UpdatePostPayload } from "@/types/posts";

export type PostLocaleDraft = {
  // The post has a row for this language.
  exists: boolean;
  // A language row that does not exist yet follows the title with its slug until the slug is edited.
  slugAuto: boolean;
  slug: string;
  title: string;
  excerpt: string;
  label: string;
  location_label: string;
  // The document JSON of profile `full`; null = empty.
  body: Record<string, unknown> | null;
  gallery_heading: string;
  gallery_description: string;
  hero_alt: string;
  seo_title: string;
  seo_description: string;
  og_image_id: number | null;
  is_enabled: boolean;
};

export type GalleryRowDraft = {
  // `String(id)` for a row the server has; `new-<n>` for one added in this session.
  key: string;
  id: number | null;
  media_id: number;
  media: SettingsMediaRef;
  translations: Record<string, { alt: string; caption: string }>;
};

export type PostDraft = {
  category_id: number | null;
  tag_ids: number[];
  hero_media_id: number | null;
  teaser_media_id: number | null;
  is_featured: boolean;
  translations: Record<string, PostLocaleDraft>;
  gallery: GalleryRowDraft[];
};

// Which parts of the draft the signed-in user may write (05 13.3.2, 13.3.3).
//  - `full`: `update`, or `update_own` of my own post: everything;
//  - `translate`: texts of the languages that are not the default one, and the alt / caption of the gallery in them;
//  - `none`: read only (the trash, no right).
export type PostEditMode = "full" | "translate" | "none";

export const emptyLocaleDraft = (): PostLocaleDraft => ({
  exists: false,
  slugAuto: true,
  slug: "",
  title: "",
  excerpt: "",
  label: "",
  location_label: "",
  body: null,
  gallery_heading: "",
  gallery_description: "",
  hero_alt: "",
  seo_title: "",
  seo_description: "",
  og_image_id: null,
  is_enabled: true,
});

const str = (v: string | null | undefined) => v ?? "";

export function draftFromPost(post: PostDetail, localeCodes: string[]): PostDraft {
  const codes = [...new Set([...localeCodes, ...Object.keys(post.translations ?? {})])];
  const translations: Record<string, PostLocaleDraft> = {};
  for (const code of codes) {
    const t = post.translations?.[code];
    translations[code] = t
      ? {
          exists: true,
          slugAuto: false,
          slug: t.slug,
          title: t.title,
          excerpt: str(t.excerpt),
          label: str(t.label),
          location_label: str(t.location_label),
          body: (t.body as Record<string, unknown> | null | undefined) ?? null,
          gallery_heading: str(t.gallery_heading),
          gallery_description: str(t.gallery_description),
          hero_alt: str(t.hero_alt),
          seo_title: str(t.seo_title),
          seo_description: str(t.seo_description),
          og_image_id: t.og_image_id ?? null,
          is_enabled: t.is_enabled ?? true,
        }
      : emptyLocaleDraft();
  }
  const gallery = (post.media ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map<GalleryRowDraft>((m) => ({
      key: String(m.id),
      id: m.id,
      media_id: m.media_id,
      media: m.media,
      translations: Object.fromEntries(Object.entries(m.translations ?? {}).map(([code, v]) => [code, { alt: str(v.alt), caption: str(v.caption) }])),
    }));
  return {
    category_id: post.category?.id ?? null,
    tag_ids: [...post.tag_ids],
    hero_media_id: post.hero_media_id,
    teaser_media_id: post.teaser_media_id,
    is_featured: post.is_featured,
    translations,
    gallery,
  };
}

export const draftsEqual = (a: PostDraft, b: PostDraft) => JSON.stringify(a) === JSON.stringify(b);

const blank = (v: string) => v.trim() === "";
const orNull = (v: string) => (v.trim() === "" ? null : v);
const hasBody = (b: Record<string, unknown> | null) => b !== null && JSON.stringify(b) !== "null";
// Something besides the title is filled in this language.
const hasOther = (t: PostLocaleDraft) =>
  [t.excerpt, t.label, t.location_label, t.gallery_heading, t.gallery_description, t.hero_alt, t.seo_title, t.seo_description].some((v) => !blank(v)) || hasBody(t.body) || t.og_image_id !== null;

export type PostProblemCode = "required" | "too_long" | "title_required" | "format" | "too_many" | "taken";

// Key: `title.<l>`, `slug.<l>`, `excerpt.<l>`, `label.<l>`, `location_label.<l>`, `gallery_heading.<l>`, `gallery_description.<l>`,
// `hero_alt.<l>`, `seo_title.<l>`, `seo_description.<l>`, `body.<l>`, `tag_ids`, `gallery`, `gallery.<key>.alt.<l>`,
// `gallery.<key>.caption.<l>`. (The display date is NOT part of the draft: it has its own control and its own save.)
export type PostProblems = Record<string, PostProblemCode>;

export function validateDraft(draft: PostDraft, defaultLocale: string): PostProblems {
  const problems: PostProblems = {};
  for (const [code, t] of Object.entries(draft.translations)) {
    const title = t.title.trim();
    if (code === defaultLocale && !title) problems[`title.${code}`] = "required";
    else if (!title && (hasOther(t) || !blank(t.slug))) problems[`title.${code}`] = "title_required";
    else if (charCount(title) > MAX_POST_TITLE) problems[`title.${code}`] = "too_long";
    // A row that exists (or is being created with a title) needs a valid slug; an empty one on a new row is made by the server.
    if (t.exists || title) {
      const slug = t.slug.trim();
      if (!slug && t.exists) problems[`slug.${code}`] = "required";
      else if (slug) {
        const problem = slugProblem(slug);
        if (problem) problems[`slug.${code}`] = problem === "too_long" ? "too_long" : "format";
      }
    }
    const limits: Array<[keyof PostLocaleDraft, number]> = [
      ["excerpt", MAX_EXCERPT],
      ["label", MAX_LABEL],
      ["location_label", MAX_LOCATION_LABEL],
      ["gallery_heading", MAX_GALLERY_HEADING],
      ["gallery_description", MAX_GALLERY_DESCRIPTION],
      ["hero_alt", MAX_HERO_ALT],
      ["seo_title", MAX_SEO_TITLE],
      ["seo_description", MAX_SEO_DESCRIPTION],
    ];
    for (const [field, max] of limits) if (charCount(String(t[field])) > max) problems[`${field}.${code}`] = "too_long";
    if (t.body && jsonBytes(t.body) > MAX_BODY_BYTES) problems[`body.${code}`] = "too_long";
  }
  if (draft.tag_ids.length > MAX_TAGS) problems.tag_ids = "too_many";
  if (draft.gallery.length > MAX_GALLERY_ITEMS) problems.gallery = "too_many";
  for (const row of draft.gallery) {
    for (const [code, v] of Object.entries(row.translations)) {
      if (charCount(v.alt) > MAX_GALLERY_ALT) problems[`gallery.${row.key}.alt.${code}`] = "too_long";
      if (charCount(v.caption) > MAX_GALLERY_CAPTION) problems[`gallery.${row.key}.caption.${code}`] = "too_long";
    }
  }
  return problems;
}

// ---- requests -------------------------------------------------------------------------------------------------------------
type TextPatch = NonNullable<UpdatePostPayload["translations"]>[string];

// Did the order, the set or the pictures of the gallery change (a `PUT /posts/{id}/media`)? Texts alone are a PATCH.
export function galleryStructureChanged(baseline: PostDraft, draft: PostDraft): boolean {
  if (baseline.gallery.length !== draft.gallery.length) return true;
  return draft.gallery.some((row, i) => row.id === null || row.id !== baseline.gallery[i].id || row.media_id !== baseline.gallery[i].media_id);
}

// Every row of the gallery as the PUT takes it: ids of existing rows kept, the texts of EVERY language sent (an omitted
// `translations` may clear them, 05 13.3.7), languages with neither text left out.
export function buildMediaPayload(draft: PostDraft): PostMediaInput[] {
  return draft.gallery.map((row) => {
    const translations: Record<string, PostMediaTranslation> = {};
    for (const [code, v] of Object.entries(row.translations)) {
      if (blank(v.alt) && blank(v.caption)) continue;
      translations[code] = { alt: orNull(v.alt), caption: orNull(v.caption) };
    }
    return { ...(row.id !== null ? { id: row.id } : {}), media_id: row.media_id, translations };
  });
}

// The alt / caption edits of rows the server already has (PATCH `media_translations`); the default language is not a
// translator's.
function galleryTextPatch(baseline: PostDraft, draft: PostDraft, mode: PostEditMode, defaultLocale: string): NonNullable<UpdatePostPayload["media_translations"]> {
  const out: NonNullable<UpdatePostPayload["media_translations"]> = {};
  for (const row of draft.gallery) {
    const before = baseline.gallery.find((b) => b.id !== null && b.id === row.id);
    if (!before || row.id === null) continue;
    for (const code of new Set([...Object.keys(row.translations), ...Object.keys(before.translations)])) {
      if (mode === "translate" && code === defaultLocale) continue;
      const now = row.translations[code] ?? { alt: "", caption: "" };
      const was = before.translations[code] ?? { alt: "", caption: "" };
      const diff: PostMediaTranslation = {};
      if (orNull(now.alt) !== orNull(was.alt)) diff.alt = orNull(now.alt);
      if (orNull(now.caption) !== orNull(was.caption)) diff.caption = orNull(now.caption);
      if (Object.keys(diff).length > 0) (out[String(row.id)] ??= {})[code] = diff;
    }
  }
  return out;
}

const TEXT_FIELDS = ["excerpt", "label", "location_label", "gallery_heading", "gallery_description", "hero_alt", "seo_title", "seo_description"] as const;

// Only what changed (05 13.3.3). A language the post did not have is added with its title and filled texts; a non-default
// language whose title and texts were all cleared is removed (`null`); the rest is a field diff. In `translate` mode the
// default language, the shared fields, `is_enabled` and the share image are left out.
export function buildPostPatch(
  baseline: PostDraft,
  draft: PostDraft,
  defaultLocale: string,
  mode: PostEditMode,
  options: { galleryViaPut: boolean }
): UpdatePostPayload | null {
  const payload: UpdatePostPayload = {};
  if (mode === "full") {
    if (draft.category_id !== baseline.category_id) payload.category_id = draft.category_id;
    if (JSON.stringify(draft.tag_ids) !== JSON.stringify(baseline.tag_ids)) payload.tag_ids = draft.tag_ids;
    if (draft.hero_media_id !== baseline.hero_media_id) payload.hero_media_id = draft.hero_media_id;
    if (draft.teaser_media_id !== baseline.teaser_media_id) payload.teaser_media_id = draft.teaser_media_id;
    if (draft.is_featured !== baseline.is_featured) payload.is_featured = draft.is_featured;
  }

  const translations: NonNullable<UpdatePostPayload["translations"]> = {};
  for (const [code, d] of Object.entries(draft.translations)) {
    if (mode === "translate" && code === defaultLocale) continue;
    const b = baseline.translations[code] ?? emptyLocaleDraft();
    if (JSON.stringify({ ...b, slugAuto: false }) === JSON.stringify({ ...d, slugAuto: false })) continue;
    const nothing = !d.title.trim() && !hasOther(d);
    if (b.exists && nothing && code !== defaultLocale) {
      if (mode === "full") translations[code] = null;
      continue;
    }
    if (!b.exists) {
      if (nothing || !d.title.trim()) continue;
      const row: NonNullable<TextPatch> = { title: d.title.trim() };
      if (d.slug.trim()) row.slug = d.slug.trim();
      for (const f of TEXT_FIELDS) if (!blank(d[f])) row[f] = d[f];
      if (hasBody(d.body)) row.body = d.body;
      if (mode === "full") {
        if (d.og_image_id !== null) row.og_image_id = d.og_image_id;
        if (!d.is_enabled) row.is_enabled = false;
      }
      translations[code] = row;
      continue;
    }
    const diff: NonNullable<TextPatch> = {};
    if (d.title.trim() !== b.title.trim()) diff.title = d.title.trim();
    if (d.slug.trim() !== b.slug) diff.slug = d.slug.trim();
    for (const f of TEXT_FIELDS) if (orNull(d[f]) !== orNull(b[f])) diff[f] = orNull(d[f]);
    if (JSON.stringify(d.body) !== JSON.stringify(b.body)) diff.body = hasBody(d.body) ? d.body : null;
    if (mode === "full") {
      if (d.og_image_id !== b.og_image_id) diff.og_image_id = d.og_image_id;
      if (d.is_enabled !== b.is_enabled) diff.is_enabled = d.is_enabled;
    }
    if (Object.keys(diff).length > 0) translations[code] = diff;
  }
  if (Object.keys(translations).length > 0) payload.translations = translations;

  // The alt / caption of existing rows ride with the PATCH unless the PUT of the whole gallery follows (it carries them).
  if (!options.galleryViaPut) {
    const media = galleryTextPatch(baseline, draft, mode, defaultLocale);
    if (Object.keys(media).length > 0) payload.media_translations = media;
  }
  return Object.keys(payload).length > 0 ? payload : null;
}

// ---- pointers (Go to field) -----------------------------------------------------------------------------------------------
export type PostTab = "content" | "details" | "seo";

// Which tab a pointer of the server (`/category_id`, `/translations/la/seo_title`, `/media/12/media_id` ...) belongs to.
export function postPointerTab(pointer: string): PostTab | null {
  if (/^\/translations\/[^/]+\/(seo_title|seo_description|og_image_id)$/.test(pointer)) return "seo";
  if (/^\/(category_id|tag_ids|published_at|is_featured)(\/.*)?$/.test(pointer)) return "details";
  if (/^\/translations\/[^/]+\/is_enabled$/.test(pointer)) return "details";
  if (/^\/(hero_media_id|teaser_media_id|media|media_translations)(\/.*)?$/.test(pointer)) return "content";
  if (/^\/translations\/[^/]+(\/.*)?$/.test(pointer)) return "content";
  return null;
}

// The DOM id of the field a pointer names (the forms put these ids on their inputs).
export function postPointerFieldId(pointer: string, galleryKeys: string[] = []): string | null {
  const t = /^\/translations\/([^/]+)\/([a-z_]+)(\/.*)?$/.exec(pointer);
  if (t) return t[2] === "body" ? `post-field-body-${t[1]}` : `post-field-${t[2]}-${t[1]}`;
  const row = /^\/media\/(\d+)(\/.*)?$/.exec(pointer);
  if (row) return galleryKeys.includes(row[1]) ? `post-gallery-item-${row[1]}` : "post-field-gallery";
  if (pointer === "/media") return "post-field-gallery";
  const tag = /^\/tag_ids(\/\d+)?$/.exec(pointer);
  if (tag) return "post-field-tag_ids";
  const top = /^\/([a-z_]+)$/.exec(pointer);
  return top ? `post-field-${top[1]}` : null;
}

// The language a pointer names (`/translations/<l>/...`), if any.
export const postPointerLocale = (pointer: string): string | undefined => /^\/translations\/([^/]+)/.exec(pointer)?.[1];

export { slugProblem };

// The display date (PT-7): its own control, its own save. `null` = "when it is published". A date in the future is refused; a
// published post can not lose its date. Returns the problem code or null.
export function dateProblem(value: string | null, published: boolean, now = Date.now()): "future" | "required" | null {
  if (value === null) return published ? "required" : null;
  return Date.parse(value) > now ? "future" : null;
}
