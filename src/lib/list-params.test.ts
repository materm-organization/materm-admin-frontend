import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type ListParamsConfig,
  countActiveFilters,
  parseListParams,
  sanitizeSort,
  serializeListParams,
  sortToSortingState,
  sortingStateToSort,
  toApiQuery,
} from "@/lib/list-params";

const config = {
  filters: {
    role_id: z.coerce.number().int().positive().optional(),
    state: z.enum(["active", "disabled", "locked"]).optional(),
    scope: z.enum(["all", "mine"]).default("all"),
    ids: z
      .string()
      .transform((v) => v.split(",").filter(Boolean))
      .optional(),
  },
  sortable: ["name", "created_at"],
  defaultSort: "-created_at",
} satisfies ListParamsConfig;

const parse = (qs: string) => parseListParams(config, new URLSearchParams(qs));

describe("parseListParams", () => {
  it("gives the defaults for an empty URL", () => {
    expect(parse("")).toEqual({
      page: 1,
      limit: 10,
      keyword: "",
      sort: "-created_at",
      filters: { scope: "all" },
    });
  });

  it("reads valid values", () => {
    const p = parse("page=3&limit=50&keyword=%20ann%20&sort=name&role_id=4&state=locked&ids=1,2,3");
    expect(p).toMatchObject({ page: 3, limit: 50, keyword: "ann", sort: "name" });
    expect(p.filters).toEqual({ role_id: 4, state: "locked", scope: "all", ids: ["1", "2", "3"] });
  });

  it("drops what does not validate (never lets a typed URL cause a 422)", () => {
    const p = parse("page=0&limit=101&sort=password&role_id=abc&state=hacked&scope=nope");
    expect(p.page).toBe(1);
    expect(p.limit).toBe(10);
    expect(p.sort).toBe("-created_at");
    expect(p.filters).toEqual({ scope: "all" });
    expect(parse("page=-2").page).toBe(1);
    expect(parse("page=1.5").page).toBe(1);
    expect(parse("limit=0").limit).toBe(10);
    expect(parse("limit=100").limit).toBe(100);
  });

  it("a too long keyword is dropped", () => {
    expect(parse(`keyword=${"a".repeat(101)}`).keyword).toBe("");
    expect(parse(`keyword=${"a".repeat(100)}`).keyword).toHaveLength(100);
  });

  it("a page without a sort allow-list ignores `sort`", () => {
    expect(parseListParams({}, new URLSearchParams("sort=name")).sort).toBeUndefined();
  });
});

describe("sanitizeSort", () => {
  it("accepts allow-listed fields, with a leading minus for descending", () => {
    expect(sanitizeSort("-name,created_at", ["name", "created_at"])).toBe("-name,created_at");
  });

  it("rejects anything outside the allow-list, duplicates and junk", () => {
    expect(sanitizeSort("name,evil", ["name"])).toBeUndefined();
    expect(sanitizeSort("name,-name", ["name"])).toBeUndefined();
    expect(sanitizeSort("Name", ["name"])).toBeUndefined();
    expect(sanitizeSort("--name", ["name"])).toBeUndefined();
    expect(sanitizeSort("", ["name"])).toBeUndefined();
    expect(sanitizeSort("name", [])).toBeUndefined();
    expect(sanitizeSort("a,b,c,d", ["a", "b", "c", "d"])).toBeUndefined();
  });
});

describe("serializeListParams", () => {
  it("omits defaults and keeps a stable key order", () => {
    expect(serializeListParams(config, parse("")).toString()).toBe("");
    const p = parse("state=locked&keyword=ann&page=2&limit=20&sort=name");
    expect(serializeListParams(config, p).toString()).toBe("page=2&limit=20&keyword=ann&sort=name&state=locked");
  });

  it("round-trips", () => {
    const qs = "page=4&limit=50&keyword=x&sort=-name&role_id=9&state=active&scope=mine&ids=1%2C2";
    const p = parse(qs);
    expect(parse(serializeListParams(config, p).toString())).toEqual(p);
  });

  it("changing a filter to its default removes it from the URL", () => {
    const p = parse("scope=mine");
    expect(serializeListParams(config, { ...p, filters: { ...p.filters, scope: "all" } }).toString()).toBe("");
  });
});

describe("toApiQuery / countActiveFilters", () => {
  it("builds a clean API query without undefined values", () => {
    const query = toApiQuery(parse("keyword=ann&role_id=4&ids=1,2"));
    expect(query).toEqual({
      page: 1,
      limit: 10,
      keyword: "ann",
      sort: "-created_at",
      role_id: 4,
      scope: "all",
      ids: "1,2",
    });
    expect(toApiQuery(parse(""))).not.toHaveProperty("keyword");
  });

  it("caps comma lists at 10 values", () => {
    const p = parse("");
    const query = toApiQuery({ ...p, filters: { ...p.filters, ids: Array.from({ length: 15 }, (_, i) => String(i)) } });
    expect(String(query.ids).split(",")).toHaveLength(10);
  });

  it("counts the keyword and non-default filters, not page/limit/sort", () => {
    expect(countActiveFilters(config, parse("page=3&limit=50&sort=name"))).toBe(0);
    expect(countActiveFilters(config, parse("keyword=a&state=locked&scope=mine"))).toBe(3);
  });
});

describe("sort <-> TanStack sorting state", () => {
  it("converts both ways", () => {
    expect(sortToSortingState("-created_at,name")).toEqual([
      { id: "created_at", desc: true },
      { id: "name", desc: false },
    ]);
    expect(sortingStateToSort([{ id: "created_at", desc: true }, { id: "name", desc: false }])).toBe(
      "-created_at,name"
    );
    expect(sortToSortingState(undefined)).toEqual([]);
    expect(sortingStateToSort([])).toBeUndefined();
  });
});
