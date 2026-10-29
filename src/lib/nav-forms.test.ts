import { describe, expect, it } from "vitest";

import { BREADCRUMB_CONFIG, buildBreadcrumbTrail } from "@/lib/constants/breadcrumb";
import { PERMISSION_KEYS } from "@/lib/constants/permissions";
import { buildNavMainItemsForUser, getPermissionsForPath, isRouteAllowed } from "@/lib/nav-main-items";

// The forms and inbox entries (T1.5.7): two keys, one group, the longest URL prefix decides which key guards a page.
describe("forms navigation and route guard", () => {
  it("the group shows only the entries the person can read; with neither key there is no group", () => {
    const groupOf = (keys: string[]) => buildNavMainItemsForUser(keys).find((g) => g.title === "nav.formsGroup");
    expect(groupOf([PERMISSION_KEYS.FORMS_SUBMISSIONS, PERMISSION_KEYS.FORMS_MANAGE])?.items?.map((i) => i.url)).toEqual(["/admin/forms/submissions", "/admin/forms"]);
    expect(groupOf([PERMISSION_KEYS.FORMS_MANAGE])?.items?.map((i) => i.url)).toEqual(["/admin/forms"]);
    expect(groupOf([PERMISSION_KEYS.FORMS_SUBMISSIONS])?.items?.map((i) => i.url)).toEqual(["/admin/forms/submissions"]);
    expect(groupOf([])).toBeUndefined();
  });

  it("only the inbox entry carries the badge", () => {
    const group = buildNavMainItemsForUser([PERMISSION_KEYS.FORMS_SUBMISSIONS, PERMISSION_KEYS.FORMS_MANAGE]).find((g) => g.title === "nav.formsGroup")!;
    expect(group.items?.map((i) => i.badgeQuery)).toEqual(["submissions.new", undefined]);
  });

  it("the inbox and its detail need forms.submissions; the forms list and an editor need forms.manage; nothing else under /admin/forms is open", () => {
    expect(getPermissionsForPath("/admin/forms/submissions")).toEqual({ kind: "requires", keys: ["forms.submissions"] });
    expect(getPermissionsForPath("/admin/forms/submissions/12")).toEqual({ kind: "requires", keys: ["forms.submissions"] });
    expect(getPermissionsForPath("/admin/forms")).toEqual({ kind: "requires", keys: ["forms.manage"] });
    expect(getPermissionsForPath("/admin/forms/3")).toEqual({ kind: "requires", keys: ["forms.manage"] });
    // a person with only the inbox cannot open a form editor, and the other way round
    const inboxOnly = ["forms.submissions"];
    expect(isRouteAllowed(getPermissionsForPath("/admin/forms/3"), inboxOnly)).toBe(false);
    expect(isRouteAllowed(getPermissionsForPath("/admin/forms/submissions/3"), inboxOnly)).toBe(true);
    expect(isRouteAllowed(getPermissionsForPath("/admin/forms/submissions"), ["forms.manage"])).toBe(false);
  });

  it("the breadcrumb trail of a message is Dashboard > Forms > Messages > #id", () => {
    expect(BREADCRUMB_CONFIG["/admin/forms"]).toBe("breadcrumb.forms");
    expect(buildBreadcrumbTrail("/admin/forms/submissions/5", { title: "#5" }).map((c) => c.key ?? c.title)).toEqual(["breadcrumb.admin", "breadcrumb.forms", "breadcrumb.submissions", "#5"]);
  });
});
