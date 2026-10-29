import { describe, expect, it } from "vitest";

import { MockHttpError, pageOf, paginate } from "@/mocks/mock-core";

const q = (s: string) => new URLSearchParams(s);
const fails = (s: string) => {
  try {
    pageOf(q(s));
  } catch (e) {
    expect(e).toBeInstanceOf(MockHttpError);
    return (e as MockHttpError).body.errors;
  }
  throw new Error("expected a 422");
};

describe("pageOf is as strict as the real list endpoints (limit 1..100, page >= 1, integers)", () => {
  it("accepts the defaults and the edges", () => {
    expect(pageOf(q(""))).toEqual({ page: 1, limit: 20 });
    expect(pageOf(q("limit=100&page=3"))).toEqual({ page: 3, limit: 100 });
    expect(paginate([1, 2, 3], q("limit=100")).meta).toMatchObject({ total: 3, limit: 100 });
  });

  it("refuses what the backend refuses instead of clamping it", () => {
    expect(fails("limit=101")).toEqual([{ in: "query", path: "/limit", code: "out_of_range", params: { min: 1, max: 100 } }]);
    expect(fails("limit=200")).toHaveLength(1);
    expect(fails("limit=0")).toHaveLength(1);
    expect(fails("page=0")).toEqual([{ in: "query", path: "/page", code: "out_of_range", params: { min: 1 } }]);
    expect(fails("limit=abc")).toEqual([{ in: "query", path: "/limit", code: "invalid_type", params: { expected: "integer" } }]);
  });
});
