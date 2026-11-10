import { Activity, Globe, Images, Inbox, Languages, LayoutDashboard, Newspaper, Type, Users, type LucideIcon } from "lucide-react";

import { PERMISSION_KEYS } from "@/lib/constants/permissions";
import { QUEUE_PERMISSION_KEYS } from "@/lib/publishing-queue";

// Sidebar structure = permission-driven config, single source of truth.
// `title` is a translation key (namespaced under `nav.*`), never display
// text — see components/navbar/nav-main.tsx. `anyPermission` lists the
// `permission_key`s that unlock an entry; the user needs `read` on at least
// one of them (`getReadablePermissionKeys` in lib/permissions.ts builds the
// list passed to the functions below — `actions: []` or no grant = no
// access); omit `anyPermission` to make the entry open to every
// authenticated user. Controls inside a page (create/delete buttons) are
// gated separately with `useHasAction(key, action)`. A group with `items` is a
// collapsible parent (use `url: "#"`).
export type NavMainSubConfig = {
  title: string;
  url: string;
  anyPermission?: string[];
  // Renders a small "Coming Soon" badge next to the label (nav-main.tsx).
  comingSoon?: boolean;
  // A live count shown as a badge (nav-main.tsx `NavBadge`): `submissions.new` = `GET /submissions/summary` `.new`.
  // `publishing.awaiting` = the `awaiting_review` count of `GET /publishing/queue`, for people who may review pages or posts (SCR-39).
  badgeQuery?: "submissions.new" | "publishing.awaiting";
};

export type NavMainGroupConfig = {
  title: string;
  url: string;
  icon: LucideIcon;
  items?: NavMainSubConfig[];
  anyPermission?: string[];
  comingSoon?: boolean;
};

export const NAV_MAIN_CONFIG: NavMainGroupConfig[] = [
  // Dashboard — the `/admin` landing page, open to every authenticated user.
  { title: "nav.dashboard", url: "/admin", icon: LayoutDashboard },
  // Media library (SCR-35/36, doc/07 section 2.1): one entry, a direct link. `/admin/media?asset=<id>` is its sheet.
  {
    title: "nav.media",
    url: "/admin/media",
    icon: Images,
    anyPermission: [PERMISSION_KEYS.MEDIA_LIBRARY],
  },
  // Site content: pages (SCR-19, published through the publish engine), then what is saved live (T1.3.8): menus, blog
  // categories / tags. Each entry is guarded by its own key. `/admin/pages/<id>` is the page editor (SCR-20).
  {
    title: "nav.content",
    url: "#",
    icon: Newspaper,
    items: [
      { title: "nav.pages", url: "/admin/pages", anyPermission: [PERMISSION_KEYS.CMS_PAGES] },
      { title: "nav.posts", url: "/admin/blog/posts", anyPermission: [PERMISSION_KEYS.CMS_BLOG] },
      { title: "nav.galleries", url: "/admin/galleries", anyPermission: [PERMISSION_KEYS.CMS_GALLERIES] },
      { title: "nav.faq", url: "/admin/faq", anyPermission: [PERMISSION_KEYS.CMS_FAQ] },
      // Collections (SCR-40 / SCR-41): content types the administrators define, and their entries.
      { title: "nav.collections", url: "/admin/collections", anyPermission: [PERMISSION_KEYS.CMS_COLLECTIONS] },
      // Shared sections (SCR-22): sections that several pages reference; `/admin/sections/<id>` is the editor.
      { title: "nav.sections", url: "/admin/sections", anyPermission: [PERMISSION_KEYS.CMS_SECTIONS] },
      { title: "nav.menus", url: "/admin/menus", anyPermission: [PERMISSION_KEYS.CMS_MENUS] },
      { title: "nav.categories", url: "/admin/blog/categories", anyPermission: [PERMISSION_KEYS.CMS_CATEGORIES] },
      { title: "nav.tags", url: "/admin/blog/tags", anyPermission: [PERMISSION_KEYS.CMS_CATEGORIES] },
      // Authors (SCR-27): the byline of a post. Guarded by the blog key (Q-A10: there is no `cms.authors`).
      { title: "nav.authors", url: "/admin/blog/authors", anyPermission: [PERMISSION_KEYS.CMS_BLOG] },
      // Publishing queue (SCR-39, FR-PUB-14): awaiting review / scheduled / unpublished changes of every kind the person may read. The entry is
      // open to a person who can read at least one publishable kind; the server leaves out the rest. The badge counts the items to review.
      { title: "nav.publishing", url: "/admin/publishing", anyPermission: QUEUE_PERMISSION_KEYS, badgeQuery: "publishing.awaiting" },
    ],
  },
  // Site-wide settings (SCR-15) and SEO (SCR-16): three keys, `cms.settings`, `cms.seo` and `cms.redirects`.
  {
    title: "nav.site",
    url: "#",
    icon: Globe,
    items: [
      { title: "nav.settings", url: "/admin/settings", anyPermission: [PERMISSION_KEYS.CMS_SETTINGS] },
      { title: "nav.seo", url: "/admin/seo", anyPermission: [PERMISSION_KEYS.CMS_SEO] },
      // Redirects (SCR-42, FR-SEO-05/06): the "seo" section of doc/07 section 2.1.
      { title: "nav.redirects", url: "/admin/redirects", anyPermission: [PERMISSION_KEYS.CMS_REDIRECTS] },
    ],
  },
  // Forms (SCR-31) and the messages they receive (SCR-32, doc/07 section 2.1): two keys, `forms.submissions` and `forms.manage`. The
  // inbox entry carries the badge with the number of new messages (`badgeQuery`, nav-main.tsx). `/admin/forms/submissions` is a
  // sub-page of the Forms URL: the longest prefix wins, so it is guarded by `forms.submissions` and `/admin/forms/<id>` by `forms.manage`.
  {
    title: "nav.formsGroup",
    url: "#",
    icon: Inbox,
    items: [
      { title: "nav.submissions", url: "/admin/forms/submissions", anyPermission: [PERMISSION_KEYS.FORMS_SUBMISSIONS], badgeQuery: "submissions.new" },
      { title: "nav.forms", url: "/admin/forms", anyPermission: [PERMISSION_KEYS.FORMS_MANAGE] },
    ],
  },
  // UI strings (SCR-34): the texts of the website's shell, per language.
  {
    title: "nav.uiStrings",
    url: "/admin/ui-strings",
    icon: Type,
    anyPermission: [PERMISSION_KEYS.CMS_UI_STRINGS],
  },
  // Localization (doc/07 section 2.1): one entry for now (UI strings come later), so a direct link.
  {
    title: "nav.locales",
    url: "/admin/locales",
    icon: Languages,
    anyPermission: [PERMISSION_KEYS.CMS_LOCALES],
  },
  // Access control: users + roles (collapsible parent, `#`).
  {
    title: "nav.iam",
    url: "#",
    icon: Users,
    items: [
      { title: "nav.users", url: "/admin/users", anyPermission: [PERMISSION_KEYS.IAM_USERS] },
      { title: "nav.roles", url: "/admin/roles", anyPermission: [PERMISSION_KEYS.IAM_ROLES] },
    ],
  },
  // Operations: audit log, system status, external webhooks.
  {
    title: "nav.ops",
    url: "#",
    icon: Activity,
    items: [
      { title: "nav.audit", url: "/admin/audit", anyPermission: [PERMISSION_KEYS.OPS_AUDIT] },
      { title: "nav.system", url: "/admin/system", anyPermission: [PERMISSION_KEYS.OPS_SYSTEM] },
      // External webhooks (SCR-43): super_admin only (the backend seed grants `ops.webhooks` to no other role).
      { title: "nav.webhooks", url: "/admin/webhooks", anyPermission: [PERMISSION_KEYS.OPS_WEBHOOKS] },
    ],
  },
];

// `userPermissions` = keys the user can read (see the header comment).
function hasAnyPermission(userPermissions: string[], required?: string[]): boolean {
  if (!required || required.length === 0) return true;
  return required.some((p) => userPermissions.includes(p));
}

export function buildNavMainItemsForUser(
  userPermissions: string[],
  config: NavMainGroupConfig[] = NAV_MAIN_CONFIG
): NavMainGroupConfig[] {
  return config
    .map((group) => {
      if (group.items?.length) {
        const items = group.items.filter((item) =>
          hasAnyPermission(userPermissions, item.anyPermission)
        );
        return items.length ? { ...group, items } : null;
      }
      return hasAnyPermission(userPermissions, group.anyPermission) ? group : null;
    })
    .filter((group): group is NavMainGroupConfig => group !== null);
}

export function getFirstAllowedAdminPath(userPermissions: string[]): string | null {
  for (const group of NAV_MAIN_CONFIG) {
    if (group.items?.length) {
      const firstItem = group.items.find((item) =>
        hasAnyPermission(userPermissions, item.anyPermission)
      );
      if (firstItem) return firstItem.url;
    } else if (hasAnyPermission(userPermissions, group.anyPermission)) {
      return group.url;
    }
  }
  return null;
}

// Routes that are NOT in the sidebar but still need an access rule (doc/07 section 2.3). Every page under
// `/admin` must be covered by a sidebar entry (longest-prefix) or by an entry here, otherwise the guard
// treats it as `unknown` and denies it (default-deny). A sub-page of a sidebar entry (`/admin/users/5`) needs
// no entry of its own: it inherits the entry's keys. `open: true` = any authenticated user;
// `anyPermission` = the user needs `read` on at least one of the keys.
export type RouteOnlyPermission = {
  url: string;
  anyPermission?: string[];
  open?: true;
};

export const ROUTE_ONLY_PERMISSIONS: RouteOnlyPermission[] = [
  // Own profile (SCR-06): open to every authenticated user.
  { url: "/admin/profile", open: true },
  // Developer playgrounds (schema form engine). The pages answer 404 outside `next dev`, so this only lets the
  // guard through; they are not in the sidebar and there is nothing to read behind them.
  { url: "/admin/dev-tools", open: true },
];

// The dashboard URL. It is matched EXACTLY: an `open` entry that is also a prefix of everything under
// `/admin` would let an unregistered route (`/admin/foo`) inherit "open to everyone".
export const ADMIN_ROOT = "/admin";

export type RouteAccess =
  | { kind: "open" }
  | { kind: "requires"; keys: string[] }
  | { kind: "unknown" };

// `/admin/users/` -> `/admin/users`; `/admin//users` -> `/admin/users`; no query/hash (usePathname has none).
export function normalizePathname(pathname: string): string {
  const collapsed = pathname.replace(/\/{2,}/g, "/");
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
}

type RouteEntry = { url: string; keys: string[]; open: boolean };

function routeEntries(): RouteEntry[] {
  const entries: RouteEntry[] = [];
  // Sidebar entries: no `anyPermission` = open to every authenticated user (the dashboard).
  const addNav = (url: string, anyPermission?: string[]) => {
    const keys = anyPermission ?? [];
    entries.push({ url, keys, open: keys.length === 0 });
  };
  for (const group of NAV_MAIN_CONFIG) {
    // `#` = a collapsible parent that has no page of its own.
    if (group.url !== "#") addNav(group.url, group.anyPermission);
    for (const item of group.items ?? []) addNav(item.url, item.anyPermission);
  }
  // Route-only entries must say so explicitly (`open: true`); one with neither `open` nor keys denies.
  for (const entry of ROUTE_ONLY_PERMISSIONS) {
    entries.push({ url: entry.url, keys: entry.anyPermission ?? [], open: entry.open === true });
  }
  return entries;
}

// Default-deny route table. The entry whose `url` is the longest segment-prefix of `pathname` wins (so a
// guard on `/admin/users/5/edit` is decided by `/admin/users`, never by a looser entry); `/admin` itself
// only matches exactly. No match = `unknown` (the guard shows "not found" and warns in dev: a page was
// added without registering its route).
export function getPermissionsForPath(pathname: string): RouteAccess {
  const path = normalizePathname(pathname);
  const match = routeEntries()
    .filter((e) =>
      e.url === ADMIN_ROOT ? path === e.url : path === e.url || path.startsWith(`${e.url}/`)
    )
    .sort((a, b) => b.url.length - a.url.length)[0];

  if (!match) return { kind: "unknown" };
  if (match.keys.length > 0) return { kind: "requires", keys: match.keys };
  // Keys win over `open`; an entry with neither denies (empty key list -> nobody has `read` on it).
  return match.open ? { kind: "open" } : { kind: "requires", keys: [] };
}

// True when a user whose readable keys are `userPermissions` may open `access`.
export function isRouteAllowed(access: RouteAccess, userPermissions: string[]): boolean {
  if (access.kind === "open") return true;
  if (access.kind === "unknown") return false;
  return access.keys.some((key) => userPermissions.includes(key));
}
