import { describe, expect, it } from "vitest";

import { etagOfRow, toUtcMicros } from "@/services/media.api";

describe("etagOfRow: the If-Match of a list row", () => {
  it("uses the row's own `etag` as received", () => {
    expect(etagOfRow({ updated_at: "2026-10-29T13:43:36.053927+07:00", etag: '"2026-10-29T06:43:36.053927Z"' })).toBe('"2026-10-29T06:43:36.053927Z"');
  });

  it("without `etag` it is `updated_at` in UTC, microseconds kept (the server writes its own offset: +07:00 is not the ETag)", () => {
    expect(etagOfRow({ updated_at: "2026-10-29T13:43:36.053927+07:00" })).toBe('"2026-10-29T06:43:36.053927Z"');
    expect(etagOfRow({ updated_at: "2026-10-29T06:43:36.053927Z" })).toBe('"2026-10-29T06:43:36.053927Z"');
  });

  it("shifts across midnight and negative offsets", () => {
    expect(toUtcMicros("2026-01-01T03:00:00.000001+07:00")).toBe("2025-12-31T20:00:00.000001Z");
    expect(toUtcMicros("2026-12-31T22:30:00.5-05:30")).toBe("2027-01-01T04:00:00.5Z");
    expect(toUtcMicros("2026-10-29T13:43:36+07:00")).toBe("2026-10-29T06:43:36Z");
    expect(toUtcMicros("not a date")).toBe("not a date");
  });
});
