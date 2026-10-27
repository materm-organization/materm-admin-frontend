import { describe, expect, it } from "vitest";

import { getReadablePermissionKeys, userCan, userHasAction } from "@/lib/permissions";
import type { PermissionGrant } from "@/types/user";

const grant = (key: string, actions: string[]): PermissionGrant => ({
  id: 1,
  permission_key: key,
  name: key,
  description: "",
  category: "x",
  actions,
});

describe("userHasAction", () => {
  it("empty actions or a missing key = no access", () => {
    expect(userHasAction([grant("a", [])], "a", "read")).toBe(false);
    expect(userHasAction([], "a", "read")).toBe(false);
    expect(userHasAction(undefined, "a", "read")).toBe(false);
  });

  it("matches the exact action", () => {
    const p = [grant("a", ["read", "update"])];
    expect(userHasAction(p, "a", "update")).toBe(true);
    expect(userHasAction(p, "a", "delete")).toBe(false);
  });
});

describe("userCan", () => {
  const permissions = [grant("cms.blog", ["read", "update_own", "delete_own"]), grant("iam.users", ["read", "create"])];

  it("any-of by default, all-of on request", () => {
    expect(userCan(permissions, "iam.users", ["create", "delete"])).toBe(true);
    expect(userCan(permissions, "iam.users", ["create", "delete"], { match: "all" })).toBe(false);
    expect(userCan(permissions, "iam.users", ["create", "read"], { match: "all" })).toBe(true);
    expect(userCan(permissions, "iam.users", [])).toBe(false);
  });

  it("the _own variant counts only for the creator", () => {
    expect(userCan(permissions, "cms.blog", "update")).toBe(false);
    expect(userCan(permissions, "cms.blog", "update", { ownerId: 7, currentUserId: 7 })).toBe(true);
    expect(userCan(permissions, "cms.blog", "update", { ownerId: 7, currentUserId: "7" })).toBe(true);
    expect(userCan(permissions, "cms.blog", "update", { ownerId: 8, currentUserId: 7 })).toBe(false);
    expect(userCan(permissions, "cms.blog", "update", { ownerId: null, currentUserId: 7 })).toBe(false);
    expect(userCan(permissions, "cms.blog", "create", { ownerId: 7, currentUserId: 7 })).toBe(false);
  });

  it("readable keys only include grants with read", () => {
    expect(getReadablePermissionKeys([grant("a", ["read"]), grant("b", ["create"]), grant("c", [])])).toEqual(["a"]);
  });
});
