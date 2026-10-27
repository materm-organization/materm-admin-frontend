import { describe, expect, it } from "vitest";

import { compileFieldTree } from "./compile-field-tree";
import { SECTION_TYPE_FIXTURES } from "./fixtures";
import { countIssuesByLocale, groupIssuesByPointer, locateIssue, serverErrorsToIssues } from "./issues";
import { escapePointerSegment, getByPointer, joinPointer, pointerFromSegments, setByPointer } from "./pointer";

const about = compileFieldTree(SECTION_TYPE_FIXTURES.about_blocks.json_schema, SECTION_TYPE_FIXTURES.about_blocks.ui_schema);
const hero = compileFieldTree(SECTION_TYPE_FIXTURES.hero_brand.json_schema, SECTION_TYPE_FIXTURES.hero_brand.ui_schema);

describe("server errors -> issues", () => {
  it("keeps body errors, strips a prefix, ignores query / path errors", () => {
    const issues = serverErrorsToIssues(
      [
        { in: "body", path: "/props/items/1/title/la", code: "too_long", params: { max: 120 } },
        { in: "body", path: "/variant", code: "not_in_enum" },
        { in: "query", path: "/include", code: "unknown_field" },
        { in: "body", path: "", code: "invalid_type" },
      ],
      "/props"
    );
    expect(issues.map((i) => [i.path, i.code])).toEqual([["/items/1/title/la", "too_long"]]);
    expect(serverErrorsToIssues([{ in: "body", path: "/a", code: "required", message: "x" }]).map((i) => i.path)).toEqual(["/a"]);
    expect(serverErrorsToIssues([{ in: "body", path: "", code: "invalid_type" }])).toHaveLength(1);
    expect(serverErrorsToIssues(undefined)).toEqual([]);
  });
});

describe("locateIssue (doc/07 section 4.6)", () => {
  it("finds the locale, the field and the array items on the way", () => {
    expect(locateIssue(about, "/items/1/title/la")).toEqual({
      fieldPointer: "/items/1/title",
      fieldPath: "items.1.title",
      locale: "la",
      itemPointers: ["/items/1"],
      matched: true,
    });
    expect(locateIssue(hero, "/background/alt/en")).toMatchObject({ fieldPointer: "/background/alt", locale: "en" });
    expect(locateIssue(hero, "/cta/link/url")).toMatchObject({ fieldPointer: "/cta/link/url", matched: true });
  });

  it("marks a path that matches no field", () => {
    expect(locateIssue(hero, "/nope/deeper").matched).toBe(false);
  });

  it("counts issues per language for the switcher badges", () => {
    const counts = countIssuesByLocale(about, [
      { path: "/items/0/title/la", code: "required" },
      { path: "/items/1/title/la", code: "too_long" },
      { path: "/items/1/title/en", code: "too_long" },
      { path: "/items", code: "too_short" },
    ]);
    expect(counts).toEqual({ byLocale: { la: 2, en: 1 }, other: 1 });
    expect(groupIssuesByPointer([{ path: "/a", code: "x" }, { path: "/a", code: "y" }]).get("/a")).toHaveLength(2);
  });
});

describe("pointer helpers", () => {
  it("escapes, joins and reads", () => {
    expect(escapePointerSegment("a/b~c")).toBe("a~1b~0c");
    expect(joinPointer("/items", 2)).toBe("/items/2");
    expect(pointerFromSegments(["a", 1, "b/c"])).toBe("/a/1/b~1c");
    const value = { a: [{ b: "x" }], "c/d": 1 };
    expect(getByPointer(value, "/a/0/b")).toBe("x");
    expect(getByPointer(value, "/c~1d")).toBe(1);
    expect(getByPointer(value, "/a/5/b")).toBeUndefined();
    expect(getByPointer(value, "")).toBe(value);
  });

  it("writes immutably: only the copied path changes identity, undefined deletes, array gaps are filled", () => {
    const value = { a: { b: 1 }, other: { x: 1 }, list: [{ n: 1 }] };
    const next = setByPointer(value, "/a/b", 2);
    expect(next).toEqual({ a: { b: 2 }, other: { x: 1 }, list: [{ n: 1 }] });
    expect(next.other).toBe(value.other);
    expect(next.list).toBe(value.list);
    expect(value.a.b).toBe(1);
    expect(setByPointer(value, "/a/b", undefined)).toEqual({ a: {}, other: { x: 1 }, list: [{ n: 1 }] });
    expect(setByPointer({}, "/title/la", "x")).toEqual({ title: { la: "x" } });
    expect(setByPointer({ list: [{ n: 1 }] }, "/list/2", { n: 3 })).toEqual({ list: [{ n: 1 }, {}, { n: 3 }] });
    expect(setByPointer({ list: [1, 2, 3] }, "/list/1/n", 5)).toEqual({ list: [1, { n: 5 }, 3] });
  });
});
