import { describe, expect, it } from "vitest";

import { buildBreadcrumbTrail, getBreadcrumbKeyForPath } from "@/lib/constants/breadcrumb";

describe("buildBreadcrumbTrail", () => {
  it("the dashboard is a single current page", () => {
    expect(buildBreadcrumbTrail("/admin")).toEqual([{ key: "breadcrumb.admin" }]);
  });

  it("a list is Dashboard > List, only the last is not a link", () => {
    expect(buildBreadcrumbTrail("/admin/users")).toEqual([
      { key: "breadcrumb.admin", href: "/admin" },
      { key: "breadcrumb.users" },
    ]);
  });

  it("a detail page adds the item's name; while loading it is a skeleton", () => {
    expect(buildBreadcrumbTrail("/admin/users/5", { title: "somchai" })).toEqual([
      { key: "breadcrumb.admin", href: "/admin" },
      { key: "breadcrumb.users", href: "/admin/users" },
      { title: "somchai" },
    ]);
    expect(buildBreadcrumbTrail("/admin/users/5", { title: undefined }).at(-1)).toEqual({ loading: true });
  });

  it("an unregistered path gives no trail", () => {
    expect(buildBreadcrumbTrail("/nowhere")).toEqual([]);
  });

  it("getBreadcrumbKeyForPath keeps the longest-prefix behaviour", () => {
    expect(getBreadcrumbKeyForPath("/admin/users/5")).toBe("breadcrumb.users");
    expect(getBreadcrumbKeyForPath("/admin/usersx")).toBe("breadcrumb.admin");
  });

  it("the media library has a breadcrumb", () => {
    expect(buildBreadcrumbTrail("/admin/media")).toEqual([
      { key: "breadcrumb.admin", href: "/admin" },
      { key: "breadcrumb.media" },
    ]);
  });
});
