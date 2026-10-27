import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { useListParams } from "@/hooks/use-list-params";
import type { ListParamsConfig } from "@/lib/list-params";

// A tiny fake of the Next router: push() updates the URL that useSearchParams reads.
const nav = vi.hoisted(() => ({ search: "", push: vi.fn() }));

vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    usePathname: () => "/admin/things",
    useRouter: () => ({ push: nav.push, replace: nav.push }),
    useSearchParams: () => React.useMemo(() => new URLSearchParams(nav.search), []),
  };
});

const config = {
  filters: { state: z.enum(["active", "locked"]).optional() },
  sortable: ["name"],
} satisfies ListParamsConfig;

beforeEach(() => {
  nav.search = "";
  nav.push.mockReset();
});

describe("useListParams", () => {
  it("parses the URL into params and an API query", () => {
    nav.search = "page=2&keyword=ann&state=locked&sort=name";
    const { result } = renderHook(() => useListParams(config));
    expect(result.current.params).toMatchObject({ page: 2, keyword: "ann", sort: "name" });
    expect(result.current.query).toEqual({ page: 2, limit: 10, keyword: "ann", sort: "name", state: "locked" });
    expect(result.current.activeFilterCount).toBe(2);
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it("setPage pushes only the changed key", () => {
    const { result } = renderHook(() => useListParams(config));
    act(() => result.current.setPage(3));
    expect(nav.push).toHaveBeenCalledWith("/admin/things?page=3", { scroll: false });
  });

  it.each([
    ["the keyword", (r: ReturnType<typeof useListParams>) => r.setKeyword(" ann "), "keyword=ann"],
    ["a filter", (r: ReturnType<typeof useListParams>) => r.setFilters({ state: "locked" }), "state=locked"],
    ["the sort", (r: ReturnType<typeof useListParams>) => r.setSort("-name"), "sort=-name"],
    ["the limit", (r: ReturnType<typeof useListParams>) => r.setLimit(50), "limit=50"],
  ])("changing %s goes back to page 1", (_name, change, expected) => {
    nav.search = "page=4";
    const { result } = renderHook(() => useListParams(config));
    act(() => change(result.current as ReturnType<typeof useListParams>));
    expect(nav.push).toHaveBeenLastCalledWith(`/admin/things?${expected}`, { scroll: false });
  });

  it("two updates in the same tick both survive", () => {
    const { result } = renderHook(() => useListParams(config));
    act(() => {
      result.current.setKeyword("ann");
      result.current.setFilters({ state: "active" });
    });
    expect(nav.push).toHaveBeenLastCalledWith("/admin/things?keyword=ann&state=active", { scroll: false });
  });

  it("clearFilters drops keyword and filters but keeps the sort and limit", () => {
    nav.search = "keyword=ann&state=locked&sort=name&limit=20&page=3";
    const { result } = renderHook(() => useListParams(config));
    act(() => result.current.clearFilters());
    expect(nav.push).toHaveBeenLastCalledWith("/admin/things?limit=20&sort=name", { scroll: false });
  });

  it("pushes the bare path when everything is default", () => {
    nav.search = "page=2";
    const { result } = renderHook(() => useListParams(config));
    act(() => result.current.setPage(1));
    expect(nav.push).toHaveBeenLastCalledWith("/admin/things", { scroll: false });
  });
});
