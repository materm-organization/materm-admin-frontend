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

// ---- P2 upload / replace -------------------------------------------------------------------------------------------
import { http, HttpResponse } from "msw";
import { beforeEach } from "vitest";

import { MissingEtagError } from "@/lib/etag";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { MediaAPI, parseDuplicate } from "@/services/media.api";
import { server } from "@/test/msw-server";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngFile = (name = "new.png", extra = 0) => new File([new Uint8Array([...PNG, extra])], name, { type: "image/png" });
const API = "*/api/v1";

describe("MediaAPI.UploadFile / ReplaceFile (against the strict mock)", () => {
  useMockApi();
  beforeEach(() => undefined);

  it("sends ONE multipart `file` (+ folder_id) and returns the created asset with its ETag", async () => {
    const result = await MediaAPI.UploadFile(pngFile("fresh.png", 1), { folderId: 1 });
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.asset).toMatchObject({ original_filename: "fresh.png", folder_id: 1, status: "ready", mime_type: "image/png" });
    expect(result.etag).toBe(`"${result.asset.updated_at}"`);
    expect(getMockDb().assets.some((a) => a.id === result.asset.id)).toBe(true);
  });

  it("reports a duplicate checksum as a result, and `allowDuplicate` sends ?allow_duplicate=true", async () => {
    const first = await MediaAPI.UploadFile(pngFile("one.png", 2));
    const dup = await MediaAPI.UploadFile(pngFile("copy.png", 2));
    expect(first.kind).toBe("created");
    expect(dup).toMatchObject({ kind: "duplicate", existing: { original_filename: "one.png" } });
    const forced = await MediaAPI.UploadFile(pngFile("copy.png", 2), { allowDuplicate: true });
    expect(forced.kind).toBe("created");
  });

  it("rejects by magic bytes (415) and by size (413), whatever the name says", async () => {
    await expect(MediaAPI.UploadFile(new File(["hello"], "fake.png", { type: "image/png" }))).rejects.toMatchObject({ response: { status: 415 } });
    const big = new File([new Uint8Array([...PNG, ...new Uint8Array(21 * 1024 * 1024)])], "big.png", { type: "image/png" });
    await expect(MediaAPI.UploadFile(big)).rejects.toMatchObject({ response: { status: 413 } });
  });

  it("passes the progress callback (0..100)", async () => {
    const seen: Array<number | undefined> = [];
    await MediaAPI.UploadFile(pngFile("p.png", 3), { onProgress: (p) => seen.push(p) });
    for (const p of seen) {
      if (p === undefined) continue;
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });

  it("replace: If-Match is required (client side), stale = 409, fresh = the asset with a NEW ETag and the same id", async () => {
    await expect(MediaAPI.ReplaceFile(2, pngFile("r.png", 4), undefined)).rejects.toBeInstanceOf(MissingEtagError);
    const current = await MediaAPI.GetAsset(2);
    await expect(MediaAPI.ReplaceFile(2, pngFile("r.png", 4), '"stale"')).rejects.toMatchObject({
      response: { status: 409, data: { code: "CONFLICT_LOCK_VERSION" } },
    });
    const replaced = await MediaAPI.ReplaceFile(2, pngFile("r.png", 4), current.etag);
    expect(replaced.data.data).toMatchObject({ id: 2, original_filename: "r.png", usage_count: current.data.data.usage_count });
    expect(replaced.etag).toBeDefined();
    expect(replaced.etag).not.toBe(current.etag);
  });

  it("replace without If-Match reaches the server as 428 (strict mock)", async () => {
    let status = 0;
    server.use(
      http.post(`${API}/media/assets/:id/file`, ({ request }) => {
        status = request.headers.get("If-Match") ? 200 : 428;
        return HttpResponse.json({ success: false, code: "PRECONDITION_REQUIRED" }, { status });
      })
    );
    await expect(MediaAPI.ReplaceFile(2, pngFile(), '"x"')).resolves.toBeDefined();
    expect(status).toBe(200);
  });
});

describe("parseDuplicate (the one place that knows the duplicate shape)", () => {
  const existing = { id: 12, original_filename: "old.png" };
  it("reads the plausible shapes", () => {
    expect(parseDuplicate({ code: "DUPLICATE_MEDIA", details: { duplicate_of: existing } })).toMatchObject({ existingId: 12, existing });
    expect(parseDuplicate({ details: { duplicate_of: 12 } })).toEqual({ kind: "duplicate", existingId: 12, existing: null });
    expect(parseDuplicate({ details: { existing } })).toMatchObject({ existingId: 12 });
    expect(parseDuplicate({ success: true, duplicate_of: 12 })).toMatchObject({ existingId: 12 });
    expect(parseDuplicate({ success: true, data: { duplicate_of: "12" } })).toMatchObject({ existingId: 12 });
    expect(parseDuplicate({ warnings: [{ code: "duplicate_checksum", params: { duplicate_of: 12 } }] })).toMatchObject({ existingId: 12 });
  });
  it("is null for anything else", () => {
    expect(parseDuplicate(null)).toBeNull();
    expect(parseDuplicate({ success: false, code: "VALIDATION_FAILED", errors: [] })).toBeNull();
    expect(parseDuplicate({ success: true, data: { id: 3 } })).toBeNull();
  });
  it("a 2xx duplicate warning from the server is a duplicate result, not a created asset", async () => {
    server.use(http.post(`${API}/media/uploads`, () => HttpResponse.json({ success: true, data: null, duplicate_of: 5 }, { status: 200 })));
    await expect(MediaAPI.UploadFile(pngFile())).resolves.toMatchObject({ kind: "duplicate", existingId: 5 });
  });
});
