// Limits and small pure helpers of the albums screens (doc/05 section 13.4, doc/07 section 3.17). Shared by the editor, the
// create dialog and the in-memory API model so the numbers live in one place (app code never imports `@/mocks`).

export const MAX_ALBUM_TITLE = 120;
export const MAX_ALBUM_DESCRIPTION = 400;
export const MAX_CAPTION_TITLE = 120;
export const MAX_CAPTION_DESCRIPTION = 400;
export const MAX_ITEM_ALT = 250;
// At most 200 pictures in an album; at most 50 in one `POST .../items` (05 13.4.4).
export const MAX_ALBUM_ITEMS = 200;
export const MAX_ITEMS_PER_REQUEST = 50;

// `cms_albums_key_check` (05 13.4.1): starts with a letter; the key can not be changed after the album is created.
export const ALBUM_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,59}$/;
export const MAX_ALBUM_KEY = 60;
// `cms_album_items_layout_hint_check`.
export const LAYOUT_HINT_PATTERN = /^[a-z0-9_-]{1,40}$/;

export const charCount = (s: string) => [...s].length;

export type KeyProblem = "format" | "too_long";

// What the server's pattern says about a typed key (before the "taken" answer of the server).
export function keyProblem(key: string): KeyProblem | null {
  if (charCount(key) > MAX_ALBUM_KEY) return "too_long";
  return ALBUM_KEY_PATTERN.test(key) ? null : "format";
}

// A key suggested from a title: lower case ASCII, a letter first, `-` between words, cut at 60. Empty when the title has
// no Latin letter (an all-Lao title): the person types the key.
export function keyFromTitle(title: string): string {
  const key = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/g, "");
  return key.slice(0, MAX_ALBUM_KEY).replace(/-+$/g, "");
}
