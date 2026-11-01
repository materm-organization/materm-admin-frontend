import { beforeEach, describe, expect, it } from "vitest";

import { MockHttpError } from "@/mocks/mock-core";
import { createMockDb } from "@/mocks/mock-db";
import { checkRedirect, createRedirect, deleteRedirect, exportRedirects, exportState, listRedirects, patchRedirect, redirectSnapshot, restoreRedirect, restoreRedirectFromTrash } from "@/mocks/mock-redirects";

let db = createMockDb();
beforeEach(() => {
  db = createMockDb();
});
const q = (s = "") => new URLSearchParams(s);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    const err = e as MockHttpError;
    return { status: err.status, code: err.body.code, errors: err.body.errors as Array<{ path: string; code: string }> | undefined };
  }
  return null;
};

describe("redirects mock (doc/05 section 14)", () => {
  it("lists, filters (locale none, no all) and sorts; the trash needs trashed=true", () => {
    expect(listRedirects(db, q()).meta.total).toBe(6);
    expect(listRedirects(db, q("status_code=307")).data.map((r) => r.source_path)).toEqual(["/promo"]);
    expect(listRedirects(db, q("locale_code=en")).data).toHaveLength(1);
    expect(listRedirects(db, q("locale_code=none")).data).toHaveLength(5);
    expect(listRedirects(db, q("is_active=false")).data.map((r) => r.source_path)).toEqual(["/legacy"]);
    expect(listRedirects(db, q("keyword=partner")).data).toHaveLength(1);
    expect(listRedirects(db, q("trashed=true")).data.map((r) => r.source_path)).toEqual(["/old-team"]);
    expect(listRedirects(db, q("trashed=true")).data[0].purge_at).toBeTruthy();
    expect(code(() => listRedirects(db, q("locale_code=1")))?.status).toBe(422);
    expect(code(() => listRedirects(db, q("bogus=1")))?.status).toBe(422);
  });

  it("check always answers the full shape", () => {
    const loop = checkRedirect(db, { source_path: "/our-path", target: "/about" });
    expect(loop.valid).toBe(false);
    expect(loop.errors[0]).toMatchObject({ in: "body", path: "/target", code: "redirect_loop" });
    expect(loop.errors[0].params?.path).toEqual(["/our-path", "/about", "/our-path"]);
    expect(checkRedirect(db, { source_path: "/x", target: "/team" })).toMatchObject({ valid: true, hops: 3, normalized: { source_path: "/x" } });
    createRedirect(db, { source_path: "/x", target: "/team" });
    const long = checkRedirect(db, { source_path: "/y", target: "/x" });
    expect(long.errors[0]).toMatchObject({ code: "redirect_chain_too_long", params: { hops: 4, max: 3, final_target: "/our-path" } });
    expect(checkRedirect(db, { source_path: "/z", target: "/Z/" }).errors[0].code).toBe("self_redirect");
    expect(checkRedirect(db, { source_path: "/old-blog", target: "/blog" }).errors[0]).toMatchObject({ code: "duplicate", path: "/source_path" });
    expect(checkRedirect(db, { source_path: "bad", target: "/b" })).toMatchObject({ valid: false, normalized: null });
    const warn = checkRedirect(db, { source_path: "/", target: "/blog" });
    expect(warn.warnings[0]).toMatchObject({ code: "source_is_published_page", path: "/source_path" });
    expect(checkRedirect(db, { source_path: "/q", target: "/team" }).warnings.map((w) => w.code)).toContain("redirect_chain");
  });

  it("creates with normalised source and warnings[], refuses duplicates, loops and bad targets", () => {
    const { data } = createRedirect(db, { source_path: "/New-Path/", target: "/blog" });
    expect(data.source_path).toBe("/new-path");
    expect(data.warnings).toEqual([]);
    expect(code(() => createRedirect(db, { source_path: "/new-path", target: "/gallery" }))).toMatchObject({ status: 409, code: "CONFLICT_DUPLICATE" });
    expect(code(() => createRedirect(db, { source_path: "/q", target: "http://x.test" }))?.errors?.[0]).toMatchObject({ path: "/target", code: "https_only" });
    expect(code(() => createRedirect(db, { source_path: "/our-path", target: "/about" }))?.errors?.[0]).toMatchObject({ path: "/target", code: "redirect_loop" });
  });

  it("patches with If-Match, no-op keeps the ETag, trashed row is INVALID_STATE", () => {
    const etag = `"${db.redirects[0].updated_at}"`;
    expect(code(() => patchRedirect(db, "1", { note: "x" }, null))?.status).toBe(428);
    expect(code(() => patchRedirect(db, "1", { note: "x" }, '"nope"'))?.code).toBe("CONFLICT_LOCK_VERSION");
    expect(patchRedirect(db, "1", { note: "Blog moved in 2025" }, etag).etag).toBe(etag);
    const { data, etag: next } = patchRedirect(db, "1", { status_code: 308, locale_code: "en" }, etag);
    expect(data).toMatchObject({ status_code: 308, locale_code: "en", warnings: [] });
    expect(next).not.toBe(etag);
    expect(code(() => patchRedirect(db, "7", { note: "x" }, `"${db.redirects[6].updated_at}"`))).toMatchObject({ status: 409, code: "INVALID_STATE" });
  });

  it("soft-deletes, frees the slot and restores with checks", () => {
    const etag = `"${db.redirects[0].updated_at}"`;
    expect(code(() => deleteRedirect(db, "1", null))?.status).toBe(428);
    deleteRedirect(db, "1", etag);
    const row = db.redirects.find((r) => r.id === 1)!;
    expect(row.deleted_at).toBeTruthy();
    expect(row.purge_at).toBeTruthy();
    expect(code(() => restoreRedirectFromTrash(db, "2", `"${db.redirects[1].updated_at}"`))?.code).toBe("INVALID_STATE");
    createRedirect(db, { source_path: "/old-blog", target: "/gallery" });
    expect(code(() => restoreRedirectFromTrash(db, "1", `"${row.updated_at}"`))).toMatchObject({ status: 409, code: "CONFLICT_DUPLICATE" });
    const ok = restoreRedirectFromTrash(db, "7", `"${db.redirects[6].updated_at}"`);
    expect(ok.data.deleted_at).toBeNull();
    expect(ok.data.warnings).toBeDefined();
  });

  it("revision restore reports errors with in:entity and the snapshot is flat", () => {
    const rev = { id: 1, version: 1, schema_version: 1, snapshot: { source_path: "/our-path", locale_code: null, target: "/about", status_code: 301, is_active: true, note: null } };
    const err = code(() => restoreRedirect(db, "1", rev, "", `"${db.redirects[0].updated_at}"`));
    expect(err?.errors?.[0]).toMatchObject({ code: "redirect_loop" });
    expect((err?.errors?.[0] as { in?: string }).in).toBe("entity");
    expect(Object.keys(redirectSnapshot(db.redirects[0]))).toEqual(["source_path", "locale_code", "target", "status_code", "is_active", "note"]);
  });

  it("exports from,to,code with BOM and CRLF; trashed and too large are 422", () => {
    const csv = exportRedirects(db, q("status_code=301"));
    expect(csv.startsWith("\ufefffrom,to,code\r\n")).toBe(true);
    expect(csv).toContain("/old-blog,/blog,301");
    expect(code(() => exportRedirects(db, q("trashed=true")))?.errors?.[0].code).toBe("not_applicable");
    exportState.max = 2;
    try {
      expect(code(() => exportRedirects(db, q())) ).toMatchObject({ status: 422, code: "EXPORT_TOO_LARGE" });
    } finally {
      exportState.max = 50_000;
    }
  });
});
