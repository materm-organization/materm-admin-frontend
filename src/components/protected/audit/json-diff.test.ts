import { describe, expect, it } from "vitest";

import { diffJson } from "@/components/protected/audit/json-diff";

describe("diffJson", () => {
  it("lists changed, added and removed leaves with dotted paths", () => {
    expect(
      diffJson(
        { name: "Ann", role_id: 2, keep: true, old: "x" },
        { name: "Anna", role_id: 2, keep: true, extra: { a: 1 } }
      )
    ).toEqual([
      { path: "extra.a", kind: "added", after: 1 },
      { path: "name", kind: "changed", before: "Ann", after: "Anna" },
      { path: "old", kind: "removed", before: "x" },
    ]);
  });

  it("a create (no before) is all additions, a delete (no after) all removals", () => {
    expect(diffJson(null, { a: 1, b: { c: 2 } })).toEqual([
      { path: "a", kind: "added", after: 1 },
      { path: "b.c", kind: "added", after: 2 },
    ]);
    expect(diffJson({ a: 1 }, null)).toEqual([{ path: "a", kind: "removed", before: 1 }]);
    expect(diffJson(null, null)).toEqual([]);
  });

  it("an action list (array of scalars) is one leaf; equal snapshots give nothing", () => {
    expect(diffJson({ "cms.blog": ["read"] }, { "cms.blog": ["read", "create"] })).toEqual([
      { path: "cms.blog", kind: "changed", before: ["read"], after: ["read", "create"] },
    ]);
    expect(diffJson({ a: [1, 2], b: { c: null } }, { a: [1, 2], b: { c: null } })).toEqual([]);
  });

  it("arrays of objects are compared item by item", () => {
    expect(diffJson({ items: [{ id: 1, v: "a" }] }, { items: [{ id: 1, v: "b" }, { id: 2, v: "c" }] })).toEqual([
      { path: "items[0].v", kind: "changed", before: "a", after: "b" },
      { path: "items[1].id", kind: "added", after: 2 },
      { path: "items[1].v", kind: "added", after: "c" },
    ]);
  });
});
