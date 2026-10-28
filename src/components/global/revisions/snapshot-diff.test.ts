import { describe, expect, it } from "vitest";

import { diffSnapshots, flattenSnapshot, humanizeSegment, pointerToSegments, splitLocale } from "./snapshot-diff";

describe("flattenSnapshot", () => {
  it("turns nested objects into leaves addressed by JSON Pointer", () => {
    const { leaves } = flattenSnapshot({ asset: { folder_id: 3, focal_x: null }, key: "main" });
    expect(leaves).toEqual([
      { pointer: "/asset/folder_id", segments: ["asset", "folder_id"], value: 3 },
      { pointer: "/asset/focal_x", segments: ["asset", "focal_x"], value: null },
      { pointer: "/key", segments: ["key"], value: "main" },
    ]);
  });

  it("keys arrays of rows by their identity (locale_code, public_id, key, id), not by position", () => {
    const { leaves, positions } = flattenSnapshot({
      translations: [
        { locale_code: "la", alt: "a" },
        { locale_code: "en", alt: "b" },
      ],
      items: [{ public_id: "u1", url: "/" }, { public_id: "u2", url: "/x" }],
    });
    expect(leaves.map((l) => l.pointer)).toEqual([
      "/translations/la/locale_code",
      "/translations/la/alt",
      "/translations/en/locale_code",
      "/translations/en/alt",
      "/items/u1/public_id",
      "/items/u1/url",
      "/items/u2/public_id",
      "/items/u2/url",
    ]);
    expect(positions["/items/u2"]).toBe(2);
  });

  it("falls back to positions when rows have no unique identity, and escapes pointer characters", () => {
    expect(flattenSnapshot({ list: [{ a: 1 }, { a: 2 }] }).leaves.map((l) => l.pointer)).toEqual(["/list/0/a", "/list/1/a"]);
    expect(flattenSnapshot({ "a/b": { "c~d": 1 } }).leaves[0].pointer).toBe("/a~1b/c~0d");
    expect(flattenSnapshot({ rows: [{ id: 1 }, { id: 1 }] }).leaves.map((l) => l.pointer)).toEqual(["/rows/0/id", "/rows/1/id"]);
  });

  it("an empty list is a visible leaf (so adding the first item is a difference)", () => {
    expect(flattenSnapshot({ items: [] }).leaves).toEqual([{ pointer: "/items", segments: ["items"], value: "[]" }]);
  });
});

describe("diffSnapshots", () => {
  const before = { asset: { folder_id: 1, is_decorative: false }, translations: [{ locale_code: "la", alt: "ເກົ່າ" }] };
  const after = { asset: { folder_id: 2, is_decorative: false }, translations: [{ locale_code: "la", alt: "ໃໝ່" }, { locale_code: "en", alt: "New" }] };

  it("reports changed, added and removed fields; unchanged ones stay out", () => {
    const { changes } = diffSnapshots(before, after);
    expect(changes.map((c) => [c.pointer, c.op])).toEqual([
      ["/asset/folder_id", "changed"],
      ["/translations/la/alt", "changed"],
      ["/translations/en/locale_code", "added"],
      ["/translations/en/alt", "added"],
    ]);
    expect(changes[0]).toMatchObject({ before: 1, after: 2 });
    const reverse = diffSnapshots(after, before).changes;
    expect(reverse.filter((c) => c.op === "removed").map((c) => c.pointer)).toEqual(["/translations/en/locale_code", "/translations/en/alt"]);
  });

  it("identical snapshots have no changes; reordering identity-keyed rows is not a change", () => {
    expect(diffSnapshots(before, structuredClone(before)).changes).toEqual([]);
    const a = { translations: [{ locale_code: "la", alt: "x" }, { locale_code: "en", alt: "y" }] };
    const b = { translations: [{ locale_code: "en", alt: "y" }, { locale_code: "la", alt: "x" }] };
    expect(diffSnapshots(a, b).changes).toEqual([]);
  });
});

describe("path helpers", () => {
  it("splitLocale takes the language out of /translations/<code>/..., /values/<code>, /notes/<code>", () => {
    expect(splitLocale(["translations", "la", "alt"])).toEqual({ locale: "la", segments: ["alt"] });
    expect(splitLocale(["items", "u1", "translations", "en", "label"])).toEqual({ locale: "en", segments: ["items", "u1", "label"] });
    expect(splitLocale(["values", "la"])).toEqual({ locale: "la", segments: ["values"] });
    expect(splitLocale(["asset", "folder_id"])).toEqual({ segments: ["asset", "folder_id"] });
    expect(splitLocale(["translations", "NOT_A_LOCALE", "x"])).toEqual({ segments: ["translations", "NOT_A_LOCALE", "x"] });
  });

  it("humanizeSegment and pointerToSegments", () => {
    expect(humanizeSegment("open_in_new_tab")).toBe("Open in new tab");
    expect(pointerToSegments("/items/2/page_id")).toEqual(["items", "2", "page_id"]);
    expect(pointerToSegments("/a~1b/c~0d")).toEqual(["a/b", "c~d"]);
    expect(pointerToSegments("")).toEqual([]);
  });
});
