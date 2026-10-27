import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readAutosavePreference, useAutosave, useAutosavePreference, writeAutosavePreference } from "./use-autosave";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

type Props = Parameters<typeof useAutosave>[0];
const setup = (props: Partial<Props> = {}) => {
  const save = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook((p: Partial<Props>) => useAutosave({ enabled: true, isDirty: true, save, ...p }), { initialProps: props });
  return { save, ...hook };
};

describe("useAutosave", () => {
  it("is off unless enabled: nothing is saved however long the form stays dirty", async () => {
    const { save } = setup({ enabled: false });
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(save).not.toHaveBeenCalled();
  });

  it("saves once 30 s after the form became dirty, then reports saved", async () => {
    const { save, result, rerender } = setup();
    expect(result.current.status).toBe("scheduled");
    await act(async () => vi.advanceTimersByTimeAsync(29_999));
    expect(save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(2));
    expect(save).toHaveBeenCalledTimes(1);
    // the editor marks the form clean after the save: no more timers
    rerender({ isDirty: false });
    expect(result.current.status).toBe("saved");
    expect(result.current.lastSavedAt).toBeInstanceOf(Date);
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does not save while blocked (structural error, conflict dialog open) and not when clean", async () => {
    const { save, rerender } = setup({ blocked: true });
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(save).not.toHaveBeenCalled();
    rerender({ blocked: false });
    await act(async () => vi.advanceTimersByTimeAsync(30_001));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("debounce (default): typing pushes the save back; interval: it does not", async () => {
    const a = setup({ changeToken: 0 });
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    a.rerender({ changeToken: 1 });
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(a.save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(10_001));
    expect(a.save).toHaveBeenCalledTimes(1);

    const b = setup({ strategy: "interval", changeToken: 0 });
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    b.rerender({ strategy: "interval", changeToken: 1 });
    await act(async () => vi.advanceTimersByTimeAsync(10_001));
    expect(b.save).toHaveBeenCalledTimes(1);
  });

  it("a failed save sets 'error' and is retried at the next tick", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave({ enabled: true, isDirty: true, save, delayMs: 1000 }));
    await act(async () => vi.advanceTimersByTimeAsync(1001));
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("error");
    // retried at the next tick
    await act(async () => vi.advanceTimersByTimeAsync(1001));
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.lastSavedAt).toBeInstanceOf(Date);
  });
});

describe("autosave preference (Q-07-7: off by default)", () => {
  it("defaults to off, is remembered per browser, and survives blocked storage", () => {
    expect(readAutosavePreference()).toBe(false);
    const { result } = renderHook(() => useAutosavePreference());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(readAutosavePreference()).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);

    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readAutosavePreference()).toBe(false);
    spy.mockRestore();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeAutosavePreference(true)).not.toThrow();
  });
});
