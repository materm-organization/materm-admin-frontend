// The cache tags the admin may ask the website to drop (doc/05 section 11.8, doc/08 section 7.2). Exactly the
// public allow-list of the API - the server rejects everything else (internal tags, `*`) with 422 `pattern_mismatch`
// on `/tags/<i>`; checking here only saves the round trip.
export const PURGE_TAG_PATTERN =
  /^(page:\d+|pages|post:\d+|posts:list|album:\d+|albums:list|faq:\d+|form:\d+|menu:[a-z0-9_-]{1,40}|settings|ui:[a-z]{2,3}(-[A-Za-z0-9]{2,8})*|locales|sitemap|redirects|collection:[a-z0-9_-]{1,40})$/;

export const MAX_PURGE_TAGS = 50;
export const MAX_PURGE_REASON = 200;

export function isAllowedPurgeTag(tag: string): boolean {
  return PURGE_TAG_PATTERN.test(tag);
}

// Tags without a parameter: one click each in the dialog.
export const FIXED_PURGE_TAGS = ["settings", "locales", "sitemap", "redirects", "pages", "posts:list", "albums:list"] as const;

// The system menus (doc/05 11.2: `main`, `footer`, `social`).
export const MENU_PURGE_TAGS = ["menu:main", "menu:footer", "menu:social"] as const;

// Free-entry tags that need an id or a key: `page:3`, `post:12`, `ui:en` ...
export const PARAMETERISED_PURGE_PREFIXES = ["page", "post", "album", "faq", "form", "menu", "ui", "collection"] as const;
