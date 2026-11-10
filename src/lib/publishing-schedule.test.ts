import { describe, expect, it } from "vitest";

import { isoToZonedParts, zonedPartsToIso } from "@/lib/datetime";
import { SCHEDULE_MIN_LEAD_MS, checkScheduleTime, classifyScheduleError, scheduleBounds, scheduleHealth } from "@/lib/publishing-schedule";
import { apiError } from "@/test/api-error";

const NOW = Date.parse("2026-11-10T03:00:00.000Z");

describe("checkScheduleTime (the browser's mirror of the server's range)", () => {
  it("accepts now + 1 minute up to now + 1 year, both ends included", () => {
    expect(checkScheduleTime(new Date(NOW + SCHEDULE_MIN_LEAD_MS).toISOString(), NOW)).toBe("ok");
    expect(checkScheduleTime("2027-11-10T03:00:00.000Z", NOW)).toBe("ok");
  });
  it("names what is wrong", () => {
    expect(checkScheduleTime(null, NOW)).toBe("empty");
    expect(checkScheduleTime("nonsense", NOW)).toBe("invalid");
    expect(checkScheduleTime(new Date(NOW + SCHEDULE_MIN_LEAD_MS - 1).toISOString(), NOW)).toBe("too_soon");
    expect(checkScheduleTime(new Date(NOW - 1000).toISOString(), NOW)).toBe("too_soon");
    expect(checkScheduleTime("2027-11-10T03:00:00.001Z", NOW)).toBe("too_far");
  });
  it("the bounds are the same two instants", () => {
    const { min, max } = scheduleBounds(NOW);
    expect(min.toISOString()).toBe("2026-11-10T03:01:00.000Z");
    expect(max.toISOString()).toBe("2027-11-10T03:00:00.000Z");
  });
});

describe("the picked time is Vientiane wall-clock time, sent as an instant", () => {
  it("09:30 in Asia/Vientiane (UTC+7) is 02:30 UTC and reads back the same", () => {
    const iso = zonedPartsToIso("2026-12-01", "09:30");
    expect(iso).toBe("2026-12-01T02:30:00.000Z");
    expect(isoToZonedParts(iso!)).toEqual({ date: "2026-12-01", time: "09:30" });
    // across midnight: 01:00 local is the evening before in UTC
    expect(zonedPartsToIso("2026-12-01", "01:00")).toBe("2026-11-30T18:00:00.000Z");
  });
});

describe("scheduleHealth", () => {
  const info = (status: "pending" | "running" | "failed", minutes: number) => ({ status, run_at: new Date(NOW + minutes * 60_000).toISOString() });
  it("ok while waiting, overdue once the time passed, running while firing, failed when the server gave up", () => {
    expect(scheduleHealth(null, NOW)).toBe("ok");
    expect(scheduleHealth(info("pending", 5), NOW)).toBe("ok");
    expect(scheduleHealth(info("pending", -5), NOW)).toBe("overdue");
    expect(scheduleHealth(info("running", -5), NOW)).toBe("running");
    expect(scheduleHealth(info("failed", -5), NOW)).toBe("failed");
  });
});

describe("classifyScheduleError", () => {
  it("reads the machine codes and paths, never the message", () => {
    const field = (status: number, path: string, code: string, params?: Record<string, unknown>) => apiError(status, { code: "VALIDATION_FAILED", message: "anything", errors: [{ in: "body", path, code, params }] });
    expect(classifyScheduleError(field(422, "/scheduled_at", "out_of_range", { min: "a", max: "b" }))).toEqual({ kind: "range", min: "a", max: "b" });
    expect(classifyScheduleError(field(422, "/scheduled_at", "required"))).toEqual({ kind: "required" });
    expect(classifyScheduleError(field(422, "/scheduled_at", "invalid_format"))).toEqual({ kind: "format" });
    expect(classifyScheduleError(field(422, "/comment", "required"))).toEqual({ kind: "commentRequired" });
    expect(classifyScheduleError(field(422, "/comment", "too_long", { max: 200 }))).toEqual({ kind: "commentTooLong" });
    expect(classifyScheduleError(apiError(429, { code: "RATE_LIMITED", message: "x" }, { "retry-after": "90" }))).toEqual({ kind: "rate", retryAfter: 90 });
    expect(classifyScheduleError(apiError(500, { code: "INTERNAL_ERROR", message: "x" }))).toEqual({ kind: "other" });
  });
});
