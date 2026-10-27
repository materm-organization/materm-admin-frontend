import { LayoutDashboard, Users, type LucideIcon } from "lucide-react";

import { PERMISSION_KEYS } from "@/lib/constants/permissions";

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
  {
    title: "nav.users",
    url: "/admin/users",
    icon: Users,
    anyPermission: [PERMISSION_KEYS.IAM_USERS],
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

// Flatten every group/item into (url, permissions) pairs, then pick the
// longest matching `url` prefix — a route guard on `/admin/users/5/edit`
// must not be satisfied by the `/admin/users` list's (possibly looser)
// permission entry.
export function getPermissionsForPath(pathname: string): string[] | undefined {
  const entries: { url: string; anyPermission?: string[] }[] = [];
  for (const group of NAV_MAIN_CONFIG) {
    entries.push({ url: group.url, anyPermission: group.anyPermission });
    if (group.items) entries.push(...group.items);
  }

  const match = entries
    .filter((e) => pathname === e.url || pathname.startsWith(`${e.url}/`))
    .sort((a, b) => b.url.length - a.url.length)[0];

  return match?.anyPermission;
}
