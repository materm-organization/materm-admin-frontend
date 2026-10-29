// Limits and small pure helpers of the posts screens (doc/05 section 13.3, doc/07 section 3.15). Shared by the editor,
// the create dialog and the in-memory API model so the numbers live in one place.

export const MAX_POST_TITLE = 150;
export const MAX_EXCERPT = 300;
export const MAX_LABEL = 80;
// Above this the vertical label of the blog strip may overflow (Q-04-8: a warning only).
export const LABEL_RECOMMENDED = 18;
export const MAX_LOCATION_LABEL = 120;
export const MAX_GALLERY_HEADING = 120;
export const MAX_GALLERY_DESCRIPTION = 400;
export const MAX_HERO_ALT = 250;
export const MAX_SEO_TITLE = 120;
export const MAX_SEO_DESCRIPTION = 320;
export const SERP_TITLE = 60;
export const SERP_DESCRIPTION = 160;
export const MAX_SLUG = 100;
export const MAX_TAGS = 10;
export const MAX_GALLERY_ITEMS = 60;
export const MAX_GALLERY_ALT = 250;
export const MAX_GALLERY_CAPTION = 300;
export const MAX_BODY_BYTES = 204_800;

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const charCount = (s: string) => [...s].length;

// ASCII slug of a title (05 13.3.4): lower case, anything that is not a letter or digit becomes one `-`, no `-` at the
// ends, cut at 100. A title that is all Lao gives "" - the caller then offers the English slug or leaves the field empty.
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, MAX_SLUG).replace(/-+$/g, "");
}

export type SlugProblem = "format" | "too_long";

// What the server's pattern says about a typed slug (before the collision check).
export function slugProblem(slug: string): SlugProblem | null {
  if (slug.length > MAX_SLUG) return "too_long";
  return SLUG_PATTERN.test(slug) ? null : "format";
}

// "2026-10-28T09:00" (the local-time input) is Asia/Vientiane; see `lib/datetime.ts` for the conversion helpers.
export const isFuture = (iso: string, now = Date.now()) => Date.parse(iso) > now;

// Size of a document as the server counts it (serialized JSON, UTF-8 bytes).
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
}
