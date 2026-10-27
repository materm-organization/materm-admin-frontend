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
    expect(withUsers.map((g) => g.url)).toEqual(["/admin", "/admin/users"]);
  });

  it("first allowed path is the dashboard", () => {
    expect(getFirstAllowedAdminPath([])).toBe("/admin");
    expect(NAV_MAIN_CONFIG.length).toBeGreaterThan(0);
  });
});
