import { describe, expect, it } from "vitest";

import {
  DEFAULT_ACTION_ORDER as ORDER,
  type Matrix,
  columnState,
  copyPreset,
  diffMatrix,
  grantPointerToKey,
  groupByCategory,
  matrixFromPermissions,
  readOnlyPreset,
  rowState,
  summarizeDiff,
  toGrants,
  toggleAction,
  toggleCategoryFull,
  toggleColumn,
  toggleRowFull,
} from "@/components/protected/roles/matrix-model";
import type { RolePermission } from "@/types/iam";

const perm = (key: string, category: string, available: string[], actions: string[] = []): RolePermission => ({
  permission_id: 1,
  permission_key: key,
  name: key,
  description: "",
  category,
  available_actions: available,
  actions,
});

const PERMS: RolePermission[] = [
  perm("cms.pages", "content", ["read", "create", "update", "delete", "publish"], ["read", "update"]),
  perm("cms.blog", "content", ["read", "create", "update", "update_own", "publish"]),
  perm("iam.users", "iam", ["read", "create", "update", "delete"]),
];

describe("toggleAction", () => {
  it("another action is locked until read is ticked (click does nothing)", () => {
    expect(toggleAction([], "create", PERMS[0].available_actions, ORDER)).toEqual([]);
  });

  it("read can be ticked on its own; other actions then toggle, always in catalog order", () => {
    let row = toggleAction([], "read", PERMS[0].available_actions, ORDER);
    expect(row).toEqual(["read"]);
    row = toggleAction(row, "delete", PERMS[0].available_actions, ORDER);
    row = toggleAction(row, "create", PERMS[0].available_actions, ORDER);
    expect(row).toEqual(["read", "create", "delete"]);
    row = toggleAction(row, "create", PERMS[0].available_actions, ORDER);
    expect(row).toEqual(["read", "delete"]);
  });

  it("unticking read clears the whole row", () => {
    expect(toggleAction(["read", "create", "update"], "read", PERMS[0].available_actions, ORDER)).toEqual([]);
  });

  it("an action the key does not have is ignored (BR-23)", () => {
    expect(toggleAction(["read"], "execute", PERMS[0].available_actions, ORDER)).toEqual(["read"]);
  });
});

describe("row / category / column switches", () => {
  const base = matrixFromPermissions(PERMS, ORDER);

  it("row switch: none -> full access (read included) -> none", () => {
    const avail = PERMS[1].available_actions;
    const full = toggleRowFull([], avail, ORDER);
    expect(full).toEqual(["read", "create", "update", "update_own", "publish"]);
    expect(rowState(full, avail)).toBe("full");
    expect(rowState(["read"], avail)).toBe("partial");
    expect(toggleRowFull(full, avail, ORDER)).toEqual([]);
  });

  it("category switch fills every row of the group, a second click clears it", () => {
    const content = PERMS.slice(0, 2);
    const filled = toggleCategoryFull(base, content, ORDER);
    expect(filled["cms.pages"]).toEqual(["read", "create", "update", "delete", "publish"]);
    expect(filled["cms.blog"]).toEqual(["read", "create", "update", "update_own", "publish"]);
    expect(filled["iam.users"]).toEqual([]);
    const cleared = toggleCategoryFull(filled, content, ORDER);
    expect(cleared["cms.pages"]).toEqual([]);
    expect(cleared["cms.blog"]).toEqual([]);
  });

  it("column switch adds the action (with read) on rows that have it; skips rows without", () => {
    const next = toggleColumn(base, PERMS, "update_own", ORDER);
    expect(next["cms.blog"]).toEqual(["read", "update_own"]);
    expect(next["cms.pages"]).toEqual(["read", "update"]); // no update_own there
    expect(columnState(next, PERMS, "update_own")).toBe("all");
    expect(columnState(next, PERMS, "execute")).toBe("unavailable");
    expect(toggleColumn(next, PERMS, "update_own", ORDER)["cms.blog"]).toEqual(["read"]);
  });

  it("removing the read column clears those rows", () => {
    const withRead = toggleColumn(base, PERMS, "read", ORDER);
    expect(columnState(withRead, PERMS, "read")).toBe("all");
    const cleared = toggleColumn(withRead, PERMS, "read", ORDER);
    expect(Object.values(cleared).every((r) => r.length === 0)).toBe(true);
  });
});

describe("presets", () => {
  it("read-only preset puts read on every key", () => {
    const m = readOnlyPreset(PERMS, ORDER);
    expect(Object.values(m)).toEqual([["read"], ["read"], ["read"]]);
  });

  it("copy preset re-fits another role's grants to this catalog and drops unavailable actions", () => {
    const source = [
      perm("cms.pages", "content", [], ["read", "execute", "create"]),
      perm("zzz.unknown", "x", [], ["read"]),
    ];
    const m = copyPreset(source, PERMS, ORDER);
    expect(m["cms.pages"]).toEqual(["read", "create"]);
    expect(m["cms.blog"]).toEqual([]);
    expect(m["zzz.unknown"]).toBeUndefined();
  });
});

describe("diff, summary, save body", () => {
  const base: Matrix = { "cms.pages": ["read", "update"], "cms.blog": [], "iam.users": ["read"] };

  it("diffMatrix lists only changed keys; summarize counts +/- grants", () => {
    const draft: Matrix = { "cms.pages": ["read", "create", "update"], "cms.blog": [], "iam.users": [] };
    const changes = diffMatrix(base, draft, PERMS);
    expect(changes.map((c) => c.permission_key)).toEqual(["cms.pages", "iam.users"]);
    expect(summarizeDiff(changes, PERMS)).toEqual({ added: 1, removed: 1, keys: 2, categories: 2 });
  });

  it("no change = empty diff", () => {
    expect(diffMatrix(base, { ...base }, PERMS)).toEqual([]);
  });

  it("toGrants sends only rows with actions, in catalog order, and error pointers map back by index", () => {
    const grants = toGrants({ "cms.pages": ["update", "read"], "cms.blog": [], "iam.users": ["read"] }, PERMS, ORDER);
    expect(grants).toEqual([
      { permission_key: "cms.pages", actions: ["read", "update"] },
      { permission_key: "iam.users", actions: ["read"] },
    ]);
    expect(grantPointerToKey("/grants/1/actions/0", grants)).toBe("iam.users");
    expect(grantPointerToKey("/grants/5/actions", grants)).toBeUndefined();
    expect(grantPointerToKey("/name", grants)).toBeUndefined();
  });

  it("groups rows by category in first-seen order", () => {
    expect(groupByCategory(PERMS).map((g) => [g.category, g.permissions.length])).toEqual([
      ["content", 2],
      ["iam", 1],
    ]);
  });
});
