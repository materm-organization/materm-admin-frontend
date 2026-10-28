import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMediaView } from "@/components/protected/media/use-media-view";

beforeEach(() => window.localStorage.clear());

describe("useMediaView (grid / list preference)", () => {
  it("starts as grid, remembers the choice in localStorage and tells every user of the hook", () => {
    const a = renderHook(() => useMediaView());
    const b = renderHook(() => useMediaView());
    expect(a.result.current[0]).toBe("grid");
    act(() => a.result.current[1]("list"));
    expect(window.localStorage.getItem("materm-admin:media-view")).toBe("list");
    expect(a.result.current[0]).toBe("list");
    expect(b.result.current[0]).toBe("list");
    act(() => b.result.current[1]("grid"));
    expect(a.result.current[0]).toBe("grid");
  });

  it("a browser without usable storage (private window) still toggles for the page's lifetime", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { result } = renderHook(() => useMediaView());
    expect(result.current[0]).toBe("grid");
    act(() => result.current[1]("list"));
    expect(result.current[0]).toBe("list");
    get.mockRestore();
    set.mockRestore();
  });
});
