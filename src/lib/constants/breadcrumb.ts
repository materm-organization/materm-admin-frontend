// route -> translation key, consumed by the protected layout's header.
// Keep this in sync with `lib/nav-main-items.ts` when adding a route.
export const BREADCRUMB_CONFIG: Record<string, string> = {
  "/admin": "breadcrumb.admin",
};

export function getBreadcrumbKeyForPath(pathname: string): string | undefined {
  const match = Object.keys(BREADCRUMB_CONFIG)
    .filter((url) => pathname === url || pathname.startsWith(`${url}/`))
    .sort((a, b) => b.length - a.length)[0];

  return match ? BREADCRUMB_CONFIG[match] : undefined;
}
