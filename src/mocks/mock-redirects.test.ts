import { beforeEach, describe, expect, it } from "vitest";

import { MockHttpError } from "@/mocks/mock-core";
import { createMockDb } from "@/mocks/mock-db";
import { checkRedirect, createRedirect, deleteRedirect, exportRedirects, listRedirects, patchRedirect } from "@/mocks/mock-redirects";

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

describe("redirects mock", () => {
  it("lists, filters and sorts", () => {
    expect(listRedirects(db, q()).meta.total).toBe(6);
    expect(listRedirects(db, q("status_code=307")).data.map((r) => r.source_path)).toEqual(["/promo"]);
    expect(listRedirects(db, q("locale_code=en")).data).toHaveLength(1);
    expect(listRedirects(db, q("locale_code=all")).data).toHaveLength(5);
    expect(listRedirects(db, q("is_active=false")).data.map((r) => r.source_path)).toEqual(["/legacy"]);
    expect(listRedirects(db, q("keyword=partner")).data).toHaveLength(1);
    expect(code(() => listRedirects(db, q("bogus=1")))?.status).toBe(422);
  });

  it("detects loops, long chains, self targets and published pages", () => {
    // /about -> /our-path; making /our-path -> /about is a loop
    const loop = checkRedirect(db, { source_path: "/our-path", target: "/about" });
    expect(loop.valid).toBe(false);
    expect(loop.errors[0].code).toBe("redirect_loop");
    // /team -> /about -> /our-path already is 2 hops; /x -> /team makes 3 (ok), /y -> /x makes 4 (too long)
    expect(checkRedirect(db, { source_path: "/x", target: "/team" }).valid).toBe(true);
    createRedirect(db, { source_path: "/x", target: "/team" });
    const long = checkRedirect(db, { source_path: "/y", target: "/x" });
    expect(long.errors[0].code).toBe("redirect_chain_too_long");
    expect(checkRedirect(db, { source_path: "/z", target: "/z" }).errors.map((e) => e.code)).toContain("target_equals_source");
    // the home page is published at "/"
    expect(checkRedirect(db, { source_path: "/", target: "/blog" }).warnings[0].code).toBe("page_published");
  });

  it("creates with normalised source, refuses duplicates, loops and bad targets", () => {
    const { data } = createRedirect(db, { source_path: "/New-Path/", target: "/blog" });
    expect(data.source_path).toBe("/new-path");
    expect(data.status_code).toBe(301);
    expect(code(() => createRedirect(db, { source_path: "/new-path", target: "/gallery" }))?.code).toBe("CONFLICT_DUPLICATE");
    expect(code(() => createRedirect(db, { source_path: "/q", target: "http://x.test" }))?.errors?.[0]).toMatchObject({ path: "/target", code: "pattern_mismatch" });
    expect(code(() => createRedirect(db, { source_path: "/our-path", target: "/about" }))?.errors?.[0]).toMatchObject({ path: "/target", code: "redirect_loop" });
  });

  it("patches with If-Match only, deletes with If-Match", () => {
    const row = db.redirects[0];
    const etag = `"${row.updated_at}"`;
    expect(code(() => patchRedirect(db, "1", { note: "x" }, null))?.status).toBe(428);
    expect(code(() => patchRedirect(db, "1", { note: "x" }, '"nope"'))?.status).toBe(409);
    const { data, etag: next } = patchRedirect(db, "1", { status_code: 308, locale_code: "en" }, etag);
    expect(data.status_code).toBe(308);
    expect(data.locale_code).toBe("en");
    expect(next).not.toBe(etag);
    expect(code(() => deleteRedirect(db, "1", etag))?.status).toBe(409);
    deleteRedirect(db, "1", next);
    expect(db.redirects.find((r) => r.id === 1)).toBeUndefined();
  });

  it("exports from,to,code", () => {
    const csv = exportRedirects(db, q("status_code=301"));
    expect(csv.split("\r\n")[0]).toBe("from,to,code");
    expect(csv).toContain("/old-blog,/blog,301");
  });
});
