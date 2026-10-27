import { describe, expect, it } from "vitest";

import {
  dayRangeToUtcBounds,
  isoToZonedParts,
  startOfZonedDayIso,
  zonedPartsToIso,
} from "@/lib/datetime";

describe("Asia/Vientiane (UTC+7, no DST) <-> UTC", () => {
  it("converts a UTC instant to the wall clock in Vientiane", () => {
    expect(isoToZonedParts("2026-10-27T03:00:00Z")).toEqual({ date: "2026-10-27", time: "10:00" });
    // 18:30 UTC is already the next day in Vientiane.
    expect(isoToZonedParts("2026-10-27T18:30:00.000Z")).toEqual({ date: "2026-10-28", time: "01:30" });
    expect(isoToZonedParts("not a date")).toBeNull();
  });

  it("converts what the user picked (Vientiane wall clock) to UTC", () => {
    expect(zonedPartsToIso("2026-10-27", "10:00")).toBe("2026-10-27T03:00:00.000Z");
    expect(zonedPartsToIso("2026-10-28", "01:30")).toBe("2026-10-27T18:30:00.000Z");
    expect(zonedPartsToIso("2026-01-01", "00:00")).toBe("2025-12-31T17:00:00.000Z");
  });

  it("round-trips", () => {
    const iso = "2026-12-31T16:59:00.000Z";
    const parts = isoToZonedParts(iso)!;
    expect(zonedPartsToIso(parts.date, parts.time)).toBe(iso);
  });

  it("rejects impossible dates and times instead of rolling over", () => {
    expect(zonedPartsToIso("2026-02-30", "10:00")).toBeNull();
    expect(zonedPartsToIso("2026-13-01", "10:00")).toBeNull();
    expect(zonedPartsToIso("2026-10-27", "24:00")).toBeNull();
    expect(zonedPartsToIso("2026-10-27", "9:5")).toBeNull();
    expect(zonedPartsToIso("27/10/2026", "10:00")).toBeNull();
  });

  it("start of a day", () => {
    expect(startOfZonedDayIso("2026-10-27")).toBe("2026-10-26T17:00:00.000Z");
  });
});

describe("dayRangeToUtcBounds (from inclusive, to EXCLUSIVE)", () => {
  it("covers whole Vientiane days", () => {
    expect(dayRangeToUtcBounds("2026-10-27", "2026-10-27")).toEqual({
      from: "2026-10-26T17:00:00.000Z",
      to: "2026-10-27T17:00:00.000Z",
    });
    expect(dayRangeToUtcBounds("2026-10-01", "2026-10-31")).toEqual({
      from: "2026-09-30T17:00:00.000Z",
      to: "2026-10-31T17:00:00.000Z",
    });
  });

  it("rolls the end over a month and a year", () => {
    expect(dayRangeToUtcBounds("2026-12-30", "2026-12-31")?.to).toBe("2026-12-31T17:00:00.000Z");
    expect(dayRangeToUtcBounds("2026-02-27", "2026-02-28")?.to).toBe("2026-02-28T17:00:00.000Z");
  });

  it("rejects bad or reversed ranges", () => {
    expect(dayRangeToUtcBounds("2026-10-28", "2026-10-27")).toBeNull();
    expect(dayRangeToUtcBounds("nope", "2026-10-27")).toBeNull();
  });
});
