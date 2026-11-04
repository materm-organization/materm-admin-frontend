import { describe, expect, it } from "vitest";

import { PERMISSION_KEYS } from "@/lib/constants/permissions";
import {
  NAV_MAIN_CONFIG,
  type RouteAccess,
  ROUTE_ONLY_PERMISSIONS,
  buildNavMainItemsForUser,
  getFirstAllowedAdminPath,
  getPermissionsForPath,
  isRouteAllowed,
  normalizePathname,
} from "@/lib/nav-main-items";

describe("getPermissionsForPath: the route table is default-deny", () => {
  it("the dashboard is open, matched EXACTLY", () => {
    expect(getPermissionsForPath("/admin")).toEqual({ kind: "open" });
    expect(getPermissionsForPath("/admin/")).toEqual({ kind: "open" });
  });

  it("an unregistered /admin/* route does NOT inherit /admin's open access", () => {
    expect(getPermissionsForPath("/admin/xyz")).toEqual({ kind: "unknown" });
    expect(getPermissionsForPath("/admin/xyz/deep/er")).toEqual({ kind: "unknown" });
    expect(getPermissionsForPath("/admin/usersx")).toEqual({ kind: "unknown" });
    expect(getPermissionsForPath("/admin/user")).toEqual({ kind: "unknown" });
  });

  it("a sidebar entry covers itself and everything below it (longest prefix)", () => {
    const expected = { kind: "requires", keys: [PERMISSION_KEYS.IAM_USERS] };
    expect(getPermissionsForPath("/admin/users")).toEqual(expected);
    expect(getPermissionsForPath("/admin/users/5")).toEqual(expected);
    expect(getPermissionsForPath("/admin/users/5/edit")).toEqual(expected);
  });

  it("route-only entries are honoured", () => {
    expect(ROUTE_ONLY_PERMISSIONS.some((e) => e.url === "/admin/profile")).toBe(true);
    expect(getPermissionsForPath("/admin/profile")).toEqual({ kind: "open" });
    expect(getPermissionsForPath("/admin/profile/sessions")).toEqual({ kind: "open" });
  });

  it("normalises slashes before matching", () => {
    expect(normalizePathname("/admin//users/")).toBe("/admin/users");
    expect(normalizePathname("/")).toBe("/");
    expect(getPermissionsForPath("/admin//users/")).toEqual({
      kind: "requires",
      keys: [PERMISSION_KEYS.IAM_USERS],
    });
    expect(getPermissionsForPath("/admin//xyz")).toEqual({ kind: "unknown" });
  });

  it("anything outside /admin is unknown", () => {
    expect(getPermissionsForPath("/")).toEqual({ kind: "unknown" });
    expect(getPermissionsForPath("/administrator")).toEqual({ kind: "unknown" });
    expect(getPermissionsForPath("/ADMIN/users")).toEqual({ kind: "unknown" });
  });
});

describe("isRouteAllowed", () => {
  it("open for everyone, unknown for no one", () => {
    expect(isRouteAllowed({ kind: "open" }, [])).toBe(true);
    expect(isRouteAllowed({ kind: "unknown" }, Object.values(PERMISSION_KEYS))).toBe(false);
  });

  it("requires read on at least one of the keys", () => {
    const access: RouteAccess = { kind: "requires", keys: ["a", "b"] };
    expect(isRouteAllowed(access, ["b"])).toBe(true);
    expect(isRouteAllowed(access, ["c"])).toBe(false);
    expect(isRouteAllowed(access, [])).toBe(false);
  });

  it("an entry with no keys that is not explicitly open denies everyone", () => {
    expect(isRouteAllowed({ kind: "requires", keys: [] }, Object.values(PERMISSION_KEYS))).toBe(false);
  });
});

describe("sidebar helpers (unchanged behaviour)", () => {
  it("filters the sidebar by readable keys", () => {
    const none = buildNavMainItemsForUser([]);
    expect(none.map((g) => g.url)).toEqual(["/admin"]);
    const withUsers = buildNavMainItemsForUser([PERMISSION_KEYS.IAM_USERS]);
    // Users sits inside the collapsible IAM group (`#`), alone: roles needs `iam.roles`.
    expect(withUsers.map((g) => g.url)).toEqual(["/admin", "#"]);
    expect(withUsers[1].items?.map((i) => i.url)).toEqual(["/admin/users"]);
  });

  it("first allowed path is the dashboard", () => {
    expect(getFirstAllowedAdminPath([])).toBe("/admin");
    expect(NAV_MAIN_CONFIG.length).toBeGreaterThan(0);
  });
});

describe("W1 iam/ops routes (T1.1.10)", () => {
  it.each([
    ["/admin/users/7", PERMISSION_KEYS.IAM_USERS],
    ["/admin/roles", PERMISSION_KEYS.IAM_ROLES],
    ["/admin/roles/3", PERMISSION_KEYS.IAM_ROLES],
    ["/admin/audit", PERMISSION_KEYS.OPS_AUDIT],
    ["/admin/locales", PERMISSION_KEYS.CMS_LOCALES],
    ["/admin/system", PERMISSION_KEYS.OPS_SYSTEM],
  ])("%s needs read on %s", (path, key) => {
    expect(getPermissionsForPath(path)).toEqual({ kind: "requires", keys: [key] });
  });

  it("each entry shows in the sidebar only for its own key; groups with no entry disappear", () => {
    const urls = (keys: string[]) =>
      buildNavMainItemsForUser(keys).flatMap((g) => (g.items ? g.items.map((i) => i.url) : [g.url]));
    expect(urls([PERMISSION_KEYS.IAM_ROLES, PERMISSION_KEYS.OPS_SYSTEM])).toEqual([
      "/admin",
      "/admin/roles",
      "/admin/system",
    ]);
    expect(urls(Object.values(PERMISSION_KEYS))).toEqual([
      "/admin",
      "/admin/media",
      // T1.4.7 pages (first entry of the content group), T1.5.5 blog posts, then the T1.3.8 save-live screens
      "/admin/pages",
      "/admin/blog/posts",
      // T1.5.6 galleries and FAQ
      "/admin/galleries",
      "/admin/faq",
      "/admin/collections",
      "/admin/menus",
      "/admin/blog/categories",
      "/admin/blog/tags",
      // T3 authors
      "/admin/blog/authors",
      "/admin/settings",
      "/admin/seo",
      "/admin/redirects",
      // T1.5.7 the inbox and the forms
      "/admin/forms/submissions",
      "/admin/forms",
      "/admin/ui-strings",
      "/admin/locales",
      "/admin/users",
      "/admin/roles",
      "/admin/audit",
      "/admin/system",
      "/admin/webhooks",
    ]);
  });
});

describe("blog posts routes (SCR-24/25, T1.5.5)", () => {
  it("the list and the editor need read on cms.blog; /admin/blog itself is not a page", () => {
    const expected = { kind: "requires", keys: [PERMISSION_KEYS.CMS_BLOG] };
    expect(getPermissionsForPath("/admin/blog/posts")).toEqual(expected);
    expect(getPermissionsForPath("/admin/blog/posts/12")).toEqual(expected);
    expect(getPermissionsForPath("/admin/blog")).toEqual({ kind: "unknown" });
  });
});

describe("galleries and FAQ routes (SCR-28/29/30, T1.5.6)", () => {
  it("each list and editor needs read on its own key", () => {
    expect(getPermissionsForPath("/admin/galleries")).toEqual({ kind: "requires", keys: [PERMISSION_KEYS.CMS_GALLERIES] });
    expect(getPermissionsForPath("/admin/galleries/4")).toEqual({ kind: "requires", keys: [PERMISSION_KEYS.CMS_GALLERIES] });
    expect(getPermissionsForPath("/admin/faq")).toEqual({ kind: "requires", keys: [PERMISSION_KEYS.CMS_FAQ] });
    expect(getPermissionsForPath("/admin/faq/2")).toEqual({ kind: "requires", keys: [PERMISSION_KEYS.CMS_FAQ] });
  });
});

describe("media library route (SCR-35/36)", () => {
  it("/admin/media and its sheet need read on media.library; sub-paths inherit it", () => {
    const expected = { kind: "requires", keys: [PERMISSION_KEYS.MEDIA_LIBRARY] };
    expect(getPermissionsForPath("/admin/media")).toEqual(expected);
    expect(getPermissionsForPath("/admin/media/anything")).toEqual(expected);
  });

  it("is in the sidebar only for users who can read the library", () => {
    const withMedia = buildNavMainItemsForUser([PERMISSION_KEYS.MEDIA_LIBRARY]);
    expect(withMedia.some((g) => g.url === "/admin/media")).toBe(true);
    expect(buildNavMainItemsForUser([PERMISSION_KEYS.IAM_USERS]).some((g) => g.url === "/admin/media")).toBe(false);
  });

  it("the dev playground of the media screens is covered by the /admin/dev-tools entry", () => {
    expect(getPermissionsForPath("/admin/dev-tools/media")).toEqual({ kind: "open" });
  });
});

describe("T1.3.8 save-live routes", () => {
  it.each([
    ["/admin/menus", PERMISSION_KEYS.CMS_MENUS],
    ["/admin/menus/main", PERMISSION_KEYS.CMS_MENUS],
    ["/admin/settings", PERMISSION_KEYS.CMS_SETTINGS],
    ["/admin/settings/contact", PERMISSION_KEYS.CMS_SETTINGS],
    ["/admin/seo", PERMISSION_KEYS.CMS_SEO],
    ["/admin/redirects", PERMISSION_KEYS.CMS_REDIRECTS],
    ["/admin/blog/categories", PERMISSION_KEYS.CMS_CATEGORIES],
    ["/admin/blog/tags", PERMISSION_KEYS.CMS_CATEGORIES],
    ["/admin/blog/authors", PERMISSION_KEYS.CMS_BLOG],
    ["/admin/ui-strings", PERMISSION_KEYS.CMS_UI_STRINGS],
  ])("%s needs read on %s", (path, key) => {
    expect(getPermissionsForPath(path)).toEqual({ kind: "requires", keys: [key] });
  });

  it("/admin/blog itself is not registered (the posts screens come later)", () => {
    expect(getPermissionsForPath("/admin/blog")).toEqual({ kind: "unknown" });
  });

  it("the seo screen is guarded by cms.seo, not by cms.settings", () => {
    const urls = (keys: string[]) => buildNavMainItemsForUser(keys).flatMap((g) => (g.items ? g.items.map((i) => i.url) : [g.url]));
    expect(urls([PERMISSION_KEYS.CMS_SEO])).toEqual(["/admin", "/admin/seo"]);
    expect(urls([PERMISSION_KEYS.CMS_SETTINGS])).toEqual(["/admin", "/admin/settings"]);
  });
});

describe("T1.4.7 pages route (SCR-19)", () => {
  it("/admin/pages and the page below it need read on cms.pages", () => {
    const expected = { kind: "requires", keys: [PERMISSION_KEYS.CMS_PAGES] };
    expect(getPermissionsForPath("/admin/pages")).toEqual(expected);
    expect(getPermissionsForPath("/admin/pages/9")).toEqual(expected);
    expect(getPermissionsForPath("/admin/pagesx")).toEqual({ kind: "unknown" });
  });

  it("is the first entry of the content group and shows only for users who can read pages", () => {
    const urls = (keys: string[]) => buildNavMainItemsForUser(keys).flatMap((g) => (g.items ? g.items.map((i) => i.url) : [g.url]));
    expect(urls([PERMISSION_KEYS.CMS_PAGES, PERMISSION_KEYS.CMS_MENUS])).toEqual(["/admin", "/admin/pages", "/admin/menus"]);
    expect(urls([PERMISSION_KEYS.CMS_MENUS])).not.toContain("/admin/pages");
  });
});

describe("external webhooks route (SCR-43)", () => {
  const urls = (keys: string[]) => buildNavMainItemsForUser(keys).flatMap((g) => (g.items ? g.items.map((i) => i.url) : [g.url]));

  it("/admin/webhooks needs read on ops.webhooks, and so does anything below it", () => {
    const expected = { kind: "requires", keys: [PERMISSION_KEYS.OPS_WEBHOOKS] };
    expect(getPermissionsForPath("/admin/webhooks")).toEqual(expected);
    expect(getPermissionsForPath("/admin/webhooks/3")).toEqual(expected);
    expect(getPermissionsForPath("/admin/webhooksx")).toEqual({ kind: "unknown" });
  });

  it("is an entry of the Operations group, hidden from everyone without ops.webhooks (the seed gives it to super_admin only)", () => {
    const ops = buildNavMainItemsForUser([PERMISSION_KEYS.OPS_AUDIT, PERMISSION_KEYS.OPS_WEBHOOKS]).find((g) => g.title === "nav.ops");
    expect(ops?.items?.map((i) => i.url)).toEqual(["/admin/audit", "/admin/webhooks"]);
    expect(urls([PERMISSION_KEYS.OPS_AUDIT, PERMISSION_KEYS.OPS_SYSTEM, PERMISSION_KEYS.CMS_PAGES])).not.toContain("/admin/webhooks");
    expect(urls([PERMISSION_KEYS.OPS_WEBHOOKS])).toEqual(["/admin", "/admin/webhooks"]);
  });

  it("the route is denied without the key", () => {
    const access = getPermissionsForPath("/admin/webhooks");
    expect(isRouteAllowed(access, [PERMISSION_KEYS.OPS_AUDIT])).toBe(false);
    expect(isRouteAllowed(access, [PERMISSION_KEYS.OPS_WEBHOOKS])).toBe(true);
  });
});

describe("collections routes (SCR-40 / SCR-41)", () => {
  it("every page below /admin/collections is guarded by cms.collections:read", () => {
    const expected = { kind: "requires", keys: [PERMISSION_KEYS.CMS_COLLECTIONS] };
    for (const path of ["/admin/collections", "/admin/collections/team", "/admin/collections/team/schema", "/admin/collections/team/41"]) {
      expect(getPermissionsForPath(path)).toEqual(expected);
    }
  });
  it("the sidebar shows Collections to a reader of the key and to nobody else", () => {
    const urls = (keys: string[]) => buildNavMainItemsForUser(keys).flatMap((g): Array<{ url: string }> => g.items ?? [g]).map((i) => i.url);
    expect(urls([PERMISSION_KEYS.CMS_COLLECTIONS])).toContain("/admin/collections");
    expect(urls([PERMISSION_KEYS.CMS_FAQ])).not.toContain("/admin/collections");
  });
});
