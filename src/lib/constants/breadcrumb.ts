// route -> translation key, consumed by the protected layout's header.
// Keep this in sync with `lib/nav-main-items.ts` when adding a route.
export const BREADCRUMB_CONFIG: Record<string, string> = {
  "/admin": "breadcrumb.admin",
  "/admin/users": "breadcrumb.users",
  "/admin/roles": "breadcrumb.roles",
  "/admin/audit": "breadcrumb.audit",
  "/admin/pages": "breadcrumb.pages",
  "/admin/publishing": "breadcrumb.publishing",
  "/admin/media": "breadcrumb.media",
  "/admin/menus": "breadcrumb.menus",
  "/admin/settings": "breadcrumb.settings",
  "/admin/seo": "breadcrumb.seo",
  "/admin/redirects": "breadcrumb.redirects",
  "/admin/blog/posts": "breadcrumb.posts",
  "/admin/galleries": "breadcrumb.galleries",
  "/admin/faq": "breadcrumb.faq",
  "/admin/collections": "breadcrumb.collections",
  "/admin/sections": "breadcrumb.sections",
  "/admin/blog/categories": "breadcrumb.categories",
  "/admin/blog/tags": "breadcrumb.tags",
  "/admin/blog/authors": "breadcrumb.authors",
  "/admin/ui-strings": "breadcrumb.uiStrings",
  "/admin/locales": "breadcrumb.locales",
  "/admin/system": "breadcrumb.system",
  "/admin/webhooks": "breadcrumb.webhooks",
  "/admin/forms": "breadcrumb.forms",
  "/admin/forms/submissions": "breadcrumb.submissions",
  "/admin/profile": "breadcrumb.profile",
};

function matchesPrefix(pathname: string, url: string): boolean {
  return pathname === url || pathname.startsWith(`${url}/`);
}

export function getBreadcrumbKeyForPath(pathname: string): string | undefined {
  const match = Object.keys(BREADCRUMB_CONFIG)
    .filter((url) => matchesPrefix(pathname, url))
    .sort((a, b) => b.length - a.length)[0];

  return match ? BREADCRUMB_CONFIG[match] : undefined;
}

export type BreadcrumbCrumb = {
  // Translation key (config levels) — mutually exclusive with `title`.
  key?: string;
  // The real name of the item a detail page shows (`useBreadcrumbTitle`); `undefined` while it loads.
  title?: string;
  loading?: boolean;
  // Absent on the last crumb (it is the current page).
  href?: string;
};

// `Dashboard › Users › somchai` (doc/07 section 2.4): every config entry that is a prefix of the pathname, in
// order of length, each a link except the last; a detail page appends its own item (`detail`) as the last
// crumb — `{ title: undefined }` means "set but still loading" (a skeleton), `null`/absent means the page sets none.
export function buildBreadcrumbTrail(
  pathname: string,
  detail: { title: string | undefined } | null = null
): BreadcrumbCrumb[] {
  const levels = Object.keys(BREADCRUMB_CONFIG)
    .filter((url) => matchesPrefix(pathname, url))
    .sort((a, b) => a.length - b.length);

  const trail: BreadcrumbCrumb[] = levels.map((url) => ({
    key: BREADCRUMB_CONFIG[url],
    href: url,
  }));

  if (detail) {
    trail.push(
      detail.title ? { title: detail.title } : { loading: true }
    );
  } else if (trail.length > 0) {
    delete trail[trail.length - 1].href;
  }
  return trail;
}
