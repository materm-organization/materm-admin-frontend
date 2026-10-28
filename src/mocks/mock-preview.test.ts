import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockHttpError, getMockDb, resetMockDb } from "@/mocks/mock-db";
import { exhaustPreviewRate, createPreviewLink, fillPreviewLinks, listPreviewLinks, revokePreviewLink, setPreviewUnconfigured } from "@/mocks/mock-preview";
import { patchPage, deletePage, getPage } from "@/mocks/mock-pages";

// The preview-link part of the mock API (doc/05 12.9): the contract the dialog may rely on.
const fails = (fn: () => unknown, status: number, code?: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(MockHttpError);
    expect((error as MockHttpError).status).toBe(status);
    if (code) expect((error as MockHttpError).body.code).toBe(code);
    return error as MockHttpError;
  }
  throw new Error("expected the call to fail");
};
const errorsOf = (e: MockHttpError) => e.body.errors as Array<{ path: string; code: string; in: string; params?: Record<string, unknown> }>;
const q = (s = "") => new URLSearchParams(s);

beforeEach(() => resetMockDb());
afterEach(() => vi.useRealTimers());

describe("POST /pages/{id}/preview-links", () => {
  it("issues a link: a 43-character token only inside `url`, 30 minutes by default, the default language", () => {
    const db = getMockDb();
    const before = Date.now();
    const link = createPreviewLink(db, "9", undefined);
    const url = new URL(link.url);
    expect(url.origin).toBe("https://materm.example");
    expect(url.pathname).toBe("/api/preview");
    expect(url.searchParams.get("token")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("path")).toBe("/events");
    expect(url.searchParams.get("locale")).toBe("la");
    expect(link).toMatchObject({ locale: "la", entity: { type: "cms.pages", id: 9 } });
    const minutes = (Date.parse(link.expires_at) - before) / 60_000;
    expect(minutes).toBeGreaterThan(29.9);
    expect(minutes).toBeLessThan(30.1);
    // no token is kept: not in the rows, not in the summary
    const token = url.searchParams.get("token")!;
    expect(JSON.stringify(db.previewLinks)).not.toContain(token);
    expect(JSON.stringify(listPreviewLinks(db, "9", q("state=all")))).not.toContain(token);
  });

  it("freezes the working copy as a hidden `preview` history row and does not move the page's ETag", () => {
    const db = getMockDb();
    const etag = getPage(db, "9").etag;
    const link = createPreviewLink(db, "9", { locale: "en", ttl_minutes: 60 });
    expect(getPage(db, "9").etag).toBe(etag);
    const row = db.revisions["pages/9"].find((r) => r.id === link.revision.id)!;
    expect(row).toMatchObject({ kind: "history", change_note: "preview", is_preview: true });
    // the draft of page 9 ("Events and treks") is what is frozen
    expect(JSON.stringify(row.snapshot)).toContain("Events and treks");
    expect(new URL(link.url).searchParams.get("locale")).toBe("en");
    expect((Date.parse(link.expires_at) - Date.now()) / 60_000).toBeGreaterThan(59.9);
  });

  it("a page that was never published gets links as well", () => {
    expect(createPreviewLink(getMockDb(), "8", {}).entity.id).toBe(8);
  });

  it("is strict about the body: unknown field, types, ttl bounds, locale", () => {
    const db = getMockDb();
    expect(errorsOf(fails(() => createPreviewLink(db, "9", { nope: 1 }), 422, "VALIDATION_FAILED"))).toEqual([{ in: "body", path: "/nope", code: "unknown_field" }]);
    expect(errorsOf(fails(() => createPreviewLink(db, "9", { ttl_minutes: 0 }), 422))[0]).toMatchObject({ path: "/ttl_minutes", code: "out_of_range", params: { min: 1, max: 1440 } });
    expect(errorsOf(fails(() => createPreviewLink(db, "9", { ttl_minutes: 1441 }), 422))[0].code).toBe("out_of_range");
    expect(errorsOf(fails(() => createPreviewLink(db, "9", { ttl_minutes: 1.5 }), 422))[0].code).toBe("invalid_type");
    expect(errorsOf(fails(() => createPreviewLink(db, "9", { ttl_minutes: "30" }), 422))[0].code).toBe("invalid_type");
    expect(errorsOf(fails(() => createPreviewLink(db, "9", { locale: "EN_us" }), 422))[0]).toMatchObject({ path: "/locale", code: "pattern_mismatch" });
    expect(errorsOf(fails(() => createPreviewLink(db, "9", { locale: "th" }), 422))[0]).toMatchObject({ path: "/locale", code: "unknown_reference" }); // exists but is not active
    expect(createPreviewLink(db, "9", { ttl_minutes: 1 })).toBeDefined();
    expect(createPreviewLink(db, "9", { ttl_minutes: 1440 })).toBeDefined();
    fails(() => createPreviewLink(db, "9", [1]), 422);
  });

  it("404 for an unknown page, 409 INVALID_STATE trashed for a page in the trash", () => {
    const db = getMockDb();
    fails(() => createPreviewLink(db, "999", {}), 404);
    const e = fails(() => createPreviewLink(db, "7", {}), 409, "INVALID_STATE");
    expect((e.body.details as { reason: string }).reason).toBe("trashed");
  });

  it("503 SERVICE_UNAVAILABLE with details.dependency before anything is written", () => {
    const db = getMockDb();
    setPreviewUnconfigured(db, true);
    const links = db.previewLinks.length;
    const revisions = db.revisions["pages/9"].length;
    const e = fails(() => createPreviewLink(db, "9", {}), 503, "SERVICE_UNAVAILABLE");
    expect(e.body.details).toEqual({ dependency: "preview.portalUrl" });
    expect(db.previewLinks.length).toBe(links);
    expect(db.revisions["pages/9"].length).toBe(revisions);
    expect(db.previewIssued).toEqual([]);
    setPreviewUnconfigured(db, false);
    expect(createPreviewLink(db, "9", {}).id).toBeGreaterThan(0);
  });

  it("at most 20 live links per user and page: 422 limit_exceeded (path \"\", params.max), another page is unaffected", () => {
    const db = getMockDb();
    // page 8 is seeded with 19 of mine
    createPreviewLink(db, "8", {});
    const e = fails(() => createPreviewLink(db, "8", {}), 422, "VALIDATION_FAILED");
    expect(errorsOf(e)).toEqual([{ in: "body", path: "", code: "limit_exceeded", params: { max: 20 } }]);
    expect(createPreviewLink(db, "9", {})).toBeDefined();
    // a revoked or expired one no longer counts
    revokePreviewLink(db, String(db.previewLinks.find((l) => l.page_id === 8)!.id));
    expect(createPreviewLink(db, "8", {})).toBeDefined();
  });

  it("30 links per hour: 429 RATE_LIMITED with Retry-After; the window rolls over; every attempt that gets that far counts", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T10:00:00Z"));
    const db = getMockDb();
    exhaustPreviewRate(db);
    const e = fails(() => createPreviewLink(db, "9", {}), 429, "RATE_LIMITED");
    expect(Number(e.headers["Retry-After"])).toBeGreaterThan(0);
    expect(Number(e.headers["Retry-After"])).toBeLessThanOrEqual(3600);
    vi.setSystemTime(new Date("2026-10-28T11:30:00Z"));
    expect(createPreviewLink(db, "9", {})).toBeDefined();

    // a refusal after the limiter (cap reached) still used one of the 30
    resetMockDb();
    const fresh = getMockDb();
    createPreviewLink(fresh, "8", {});
    for (let i = 0; i < 29; i++) fails(() => createPreviewLink(fresh, "8", {}), 422);
    fails(() => createPreviewLink(fresh, "8", {}), 429);
  });

  it("a translate-only model has neither update nor review: 403", () => {
    const db = getMockDb();
    db.translateOnly = ["pages"];
    fails(() => createPreviewLink(db, "9", {}), 403, "FORBIDDEN");
  });
});

describe("GET /pages/{id}/preview-links", () => {
  it("lists the active links by default with the OpenAPI row shape and no url; is_stale; state filters", () => {
    const db = getMockDb();
    const { data, meta } = listPreviewLinks(db, "9", q());
    expect(meta.total).toBe(1); // of the three seeded links one is active, one expired, one revoked
    expect(data.every((l) => l.state === "active")).toBe(true);
    const others = data.find((l) => l.created_by?.id === 4)!;
    expect(others).toMatchObject({ locale: "en", use_count: 3, is_stale: true });
    expect(Object.keys(others).sort()).toEqual(
      ["created_at", "created_by", "expires_at", "id", "is_stale", "last_used_at", "locale", "revision", "revoked_at", "state", "use_count"].sort()
    );
    expect(listPreviewLinks(db, "9", q("state=revoked")).data.map((l) => l.state)).toEqual(["revoked"]);
    expect(listPreviewLinks(db, "9", q("state=expired")).data.map((l) => l.state)).toEqual(["expired"]);
    expect(listPreviewLinks(db, "9", q("state=all")).meta.total).toBe(3);
    // a new link is not stale; editing the page makes it stale
    const link = createPreviewLink(db, "9", {});
    const item = () => listPreviewLinks(db, "9", q("limit=100")).data.find((l) => l.id === link.id)!;
    expect(item().is_stale).toBe(false);
    patchPage(db, "9", { sort_order: 7 }, getPage(db, "9").etag);
    expect(item().is_stale).toBe(true);
  });

  it("an expired link turns `expired` with real time", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T10:00:00Z"));
    const db = getMockDb();
    const link = createPreviewLink(db, "9", { ttl_minutes: 5 });
    vi.setSystemTime(new Date("2026-10-28T10:06:00Z"));
    expect(listPreviewLinks(db, "9", q("state=active&limit=100")).data.some((l) => l.id === link.id)).toBe(false);
    expect(listPreviewLinks(db, "9", q("state=expired")).data.some((l) => l.id === link.id)).toBe(true);
  });

  it("is strict about the query and sorts", () => {
    const db = getMockDb();
    expect(errorsOf(fails(() => listPreviewLinks(db, "9", q("state=live")), 422))[0]).toMatchObject({ in: "query", path: "/state", code: "not_in_enum" });
    expect(errorsOf(fails(() => listPreviewLinks(db, "9", q("x=1")), 422))[0]).toMatchObject({ path: "/x", code: "unknown_field" });
    fails(() => listPreviewLinks(db, "9", q("limit=101")), 422);
    fails(() => listPreviewLinks(db, "9", q("sort=id")), 422);
    fails(() => listPreviewLinks(db, "999", q()), 404);
    const asc = listPreviewLinks(db, "9", q("sort=created_at&state=all")).data.map((l) => l.id);
    const desc = listPreviewLinks(db, "9", q("state=all")).data.map((l) => l.id);
    expect(asc).toEqual([...desc].reverse());
  });

  it("a reader without `update` sees only their own links", () => {
    const db = getMockDb();
    db.translateOnly = ["pages"];
    expect(listPreviewLinks(db, "9", q("state=all")).data.every((l) => l.created_by?.id === 6)).toBe(true);
  });

  it("pages and paginates the 19 links of page 8", () => {
    const db = getMockDb();
    fillPreviewLinks(db, 8, 0);
    const { data, meta } = listPreviewLinks(db, "8", q("limit=10&page=2"));
    expect(meta).toMatchObject({ total: 19, page: 2, limit: 10, total_page: 2 });
    expect(data).toHaveLength(9);
  });
});

describe("DELETE /preview-links/{id}", () => {
  it("revokes; a second revoke is a 200 with the same revoked_at; the link leaves the active list", () => {
    const db = getMockDb();
    const link = createPreviewLink(db, "9", {});
    const first = revokePreviewLink(db, String(link.id));
    expect(first).toMatchObject({ id: link.id, state: "revoked" });
    expect(revokePreviewLink(db, String(link.id))).toEqual(first);
    expect(listPreviewLinks(db, "9", q("limit=100")).data.some((l) => l.id === link.id)).toBe(false);
  });

  it("404 for an unknown id; 403 when somebody else's link and no `update`", () => {
    const db = getMockDb();
    fails(() => revokePreviewLink(db, "9999"), 404);
    fails(() => revokePreviewLink(db, "abc"), 404);
    const others = db.previewLinks.find((l) => l.created_by?.id === 4)!;
    db.translateOnly = ["pages"];
    fails(() => revokePreviewLink(db, String(others.id)), 403, "FORBIDDEN");
    const mine = db.previewLinks.find((l) => l.created_by?.id === 6)!;
    expect(revokePreviewLink(db, String(mine.id)).state).toBe("revoked");
  });

  it("a trashed page keeps its links revocable", () => {
    const db = getMockDb();
    const link = createPreviewLink(db, "10", {});
    deletePage(db, "10", q("confirm_references=true"), getPage(db, "10").etag);
    expect(revokePreviewLink(db, String(link.id)).state).toBe("revoked");
  });
});
