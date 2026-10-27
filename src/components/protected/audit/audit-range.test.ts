import { describe, expect, it } from "vitest";

import { checkAuditRange, dayFilterToBounds, toAuditParams } from "@/components/protected/audit/audit-range";

const NOW = new Date("2026-10-27T05:00:00Z");

describe("dayFilterToBounds: days in Asia/Vientiane -> UTC, `to` exclusive", () => {
  it("a day range becomes [00:00 first day, 00:00 day after last day)", () => {
    expect(dayFilterToBounds("2026-10-01", "2026-10-27")).toEqual({
      from: "2026-09-30T17:00:00.000Z",
      to: "2026-10-27T17:00:00.000Z",
    });
  });
  it("one side alone", () => {
    expect(dayFilterToBounds("2026-10-01")).toEqual({ from: "2026-09-30T17:00:00.000Z" });
    expect(dayFilterToBounds(undefined, "2026-10-01")).toEqual({ to: "2026-10-01T17:00:00.000Z" });
    expect(dayFilterToBounds()).toEqual({});
  });
  it("garbage or reversed ranges give no bounds", () => {
    expect(dayFilterToBounds("nope", "2026-10-01")).toEqual({});
    expect(dayFilterToBounds("2026-10-05", "2026-10-01")).toEqual({});
  });
});

describe("toAuditParams", () => {
  it("replaces the day filters by UTC bounds and keeps the rest", () => {
    expect(toAuditParams({ page: 2, limit: 10, action: "iam.user.*", from: "2026-10-01", to: "2026-10-02" })).toEqual({
      page: 2,
      limit: 10,
      action: "iam.user.*",
      from: "2026-09-30T17:00:00.000Z",
      to: "2026-10-02T17:00:00.000Z",
    });
  });
});

describe("checkAuditRange (doc/05 section 5.1)", () => {
  it("no dates = the server default (30 days): fine", () => {
    expect(checkAuditRange({}, NOW)).toEqual({ ok: true });
  });
  it("broad query: up to 92 days", () => {
    expect(checkAuditRange({ from: "2026-07-28", to: "2026-10-27" }, NOW)).toEqual({ ok: true }); // 92 days
    expect(checkAuditRange({ from: "2026-07-27", to: "2026-10-27" }, NOW)).toEqual({ ok: false, max: "days" });
  });
  it("a narrow filter allows up to 24 months", () => {
    const wide = { from: "2025-01-01", to: "2026-10-27" };
    expect(checkAuditRange(wide, NOW)).toEqual({ ok: false, max: "days" });
    expect(checkAuditRange({ ...wide, action: "iam.user.*" }, NOW)).toEqual({ ok: true });
    expect(checkAuditRange({ ...wide, entity_type: "iam.user", entity_id: 3 }, NOW)).toEqual({ ok: true });
    expect(checkAuditRange({ from: "2024-01-01", to: "2026-10-27", request_id: "abcdefgh" }, NOW)).toEqual({
      ok: false,
      max: "months",
    });
  });
  it("entity_type alone is not narrow", () => {
    expect(checkAuditRange({ from: "2025-01-01", to: "2026-10-27", entity_type: "iam.user" }, NOW)).toEqual({
      ok: false,
      max: "days",
    });
  });
});
