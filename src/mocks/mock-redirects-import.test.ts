import { beforeEach, describe, expect, it } from "vitest";

import { MockHttpError } from "@/mocks/mock-core";
import { createMockDb } from "@/mocks/mock-db";
import { exportRedirects } from "@/mocks/mock-redirects";
import { IMPORT_MAX_ROWS, importRedirects, importState } from "@/mocks/mock-redirects-import";
import type { RedirectImportReport } from "@/types/redirects";

let db = createMockDb();
beforeEach(() => {
  db = createMockDb();
  importState.unavailable = false;
  importState.limit = 20;
});

// A multipart request built by hand (the mock parses the raw bytes, like the handlers do).
function csvRequest(content: string | Uint8Array, filename = "redirects.csv") {
  const boundary = "----testboundary";
  const enc = new TextEncoder();
  const head = enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/csv\r\n\r\n`);
  const data = typeof content === "string" ? enc.encode(content) : content;
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + data.length + tail.length);
  body.set(head, 0);
  body.set(data, head.length);
  body.set(tail, head.length + data.length);
  return new Request("http://localhost/api/v1/redirects/import", { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body });
}
const run = (content: string | Uint8Array, query = "") => importRedirects(db, csvRequest(content), new URLSearchParams(query));
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as MockHttpError;
  }
  throw new Error("expected a failure");
};
const fileError = async (content: string | Uint8Array) => {
  const e = await fails(run(content));
  expect(e.status).toBe(422);
  return (e.body.errors as Array<{ path: string; code: string; params?: Record<string, unknown> }>)[0];
};
const report = async (content: string, query = "") => (await run(content, query)) as RedirectImportReport;

describe("POST /redirects/import (doc/05 14.13)", () => {
  it("dry run is the default: the per-row report, nothing is written", async () => {
    const before = JSON.stringify(db.redirects);
    const r = await report("from,to,code\n/new,/n,308\n/old-blog,/posts,302\n/about,/our-path,302\n/bad,/y,301\nbad,/y,301\n");
    expect(r).toMatchObject({ dry_run: true, valid: false, applied: false });
    expect(r.totals).toEqual({ rows: 5, created: 2, updated: 1, unchanged: 1, errors: 1 });
    const byRow = Object.fromEntries(r.rows.map((x) => [x.row, x]));
    expect(byRow[2]).toMatchObject({ from: "/new", to: "/n", code: "308", status: "created", id: null, previous: null });
    expect(byRow[3]).toMatchObject({ status: "updated", id: 1, previous: { to: "/blog", code: 301 } });
    expect(byRow[4]).toMatchObject({ status: "unchanged", id: 2 });
    // "/bad" is a valid path (a redirect from it is fine); only the last row (no leading slash) is an error
    expect(byRow[5].status).toBe("created");
    expect(byRow[6]).toMatchObject({ status: "error" });
    expect(byRow[6].errors[0]).toMatchObject({ field: "from", code: "pattern_mismatch", params: { rule: "must_start_with_slash" } });
    expect(JSON.stringify(db.redirects)).toBe(before);
  });

  it("an empty code means 301; a BOM and CRLF are fine; the header is case-insensitive", async () => {
    const r = await report("﻿From , TO,Code\r\n/a,/b,\r\n\r\n/c,/d,307\r\n");
    expect(r.valid).toBe(true);
    expect(r.rows.map((x) => [x.row, x.status])).toEqual([[2, "created"], [4, "created"]]);
  });

  it("explains every kind of row error with a code and params", async () => {
    const r = await report(
      [
        "from,to,code",
        "/dup,/x,301",
        "/dup,/y,301", // duplicate_in_file (first_row 2)
        "=cmd|' /C calc'!A0,/x,301", // csv_formula
        "/only-two,/x", // wrong_column_count
        "/c,/d,abc", // invalid_type
        "/c2,/d,303", // not_in_enum
        "/h,http://insecure.example,301", // https_only
        "/self,/self/,301", // self_redirect
      ].join("\n")
    );
    const codes = r.rows.map((x) => x.errors.map((e) => `${e.field}:${e.code}`));
    expect(codes).toEqual([[], ["from:duplicate_in_file"], ["from:csv_formula"], [":wrong_column_count"], ["code:invalid_type"], ["code:not_in_enum"], ["to:pattern_mismatch"], ["to:self_redirect"]]);
    expect(r.rows[1].errors[0].params).toEqual({ first_row: 2 });
    expect(r.totals.errors).toBe(7);
  });

  it("checks the whole file for loops and chains, and warns about a published page", async () => {
    const loop = await report("from,to,code\n/a,/b,301\n/b,/a,301\n");
    expect(loop.rows.map((x) => x.errors.map((e) => e.code))).toEqual([["redirect_loop"], ["redirect_loop"]]);
    expect(loop.rows[0].errors[0].params).toMatchObject({ path: ["/a", "/b", "/a"] });
    // /team -> /about -> /our-path already (2 hops): a new link in front makes 3 (a warning), a 4th is too long
    const chain = await report("from,to,code\n/x1,/team,301\n");
    expect(chain.rows[0].warnings[0]).toMatchObject({ code: "redirect_chain", params: { hops: 3, final_target: "/our-path" } });
    const tooLong = await report("from,to,code\n/x1,/team,301\n/x0,/x1,301\n");
    expect(tooLong.rows.find((x) => x.from === "/x0")?.errors[0]).toMatchObject({ code: "redirect_chain_too_long", params: { hops: 4, max: 3 } });
    const page = await report("from,to,code\n/,/blog,301\n");
    expect(page.rows[0].warnings.map((w) => w.code)).toContain("source_is_published_page");
  });

  it("file-level problems are 422 at /file with the contract's codes", async () => {
    expect(await fileError("")).toMatchObject({ path: "/file", code: "empty" });
    expect(await fileError("from,to,code\n")).toMatchObject({ code: "no_rows" });
    expect(await fileError("from,to\n/a,/b\n")).toMatchObject({ code: "header_mismatch" });
    expect(await fileError('from,to,code\n"/a,/b,301\n')).toMatchObject({ code: "invalid_csv", params: { line: 2 } });
    const many = "from,to,code\n" + Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_v, i) => `/p${i},/q,301`).join("\n");
    expect(await fileError(many)).toMatchObject({ code: "too_many_rows", params: { max: IMPORT_MAX_ROWS } });
  });

  it("the type is decided by the bytes: zip, NUL and non-UTF-8 are 415; over 8 MiB is 413", async () => {
    expect((await fails(run(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2])))).status).toBe(415);
    expect((await fails(run(new Uint8Array([0x66, 0x72, 0x6f, 0x6d, 0, 0x2c])))).status).toBe(415);
    expect((await fails(run(new Uint8Array([0x66, 0xff, 0xfe, 0x2c])))).status).toBe(415);
    const big = await fails(run(new Uint8Array(8 * 1024 * 1024 + 1).fill(0x61)));
    expect(big.status).toBe(413);
    expect(big.body.details).toMatchObject({ reason: "file_too_large", max_bytes: 8 * 1024 * 1024 });
  });

  it("dry_run must be true or false", async () => {
    const e = await fails(run("from,to,code\n/a,/b,301\n", "dry_run=maybe"));
    expect(e.status).toBe(422);
    expect((e.body.errors as Array<{ path: string; code: string }>)[0]).toMatchObject({ path: "/dry_run", code: "invalid_type" });
  });

  it("apply with one bad row writes nothing and answers 422 with the full report in details.report", async () => {
    const before = JSON.stringify(db.redirects);
    const e = await fails(run("from,to,code\n/ok,/fine,301\nbad,/y,301\n", "dry_run=false"));
    expect(e.status).toBe(422);
    expect((e.body.errors as Array<{ code: string; params: unknown }>)[0]).toMatchObject({ code: "has_errors", params: { errors: 1 } });
    const rep = (e.body.details as { report: RedirectImportReport }).report;
    expect(rep).toMatchObject({ dry_run: false, valid: false, applied: false });
    expect(rep.rows).toHaveLength(2);
    expect(JSON.stringify(db.redirects)).toBe(before);
  });

  it("apply writes created rows and updates (with a revision), then the same file is all unchanged", async () => {
    const file = "from,to,code\n/new-one,/blog,308\n/old-blog,/posts,302\n";
    const applied = await report(file, "dry_run=false");
    expect(applied).toMatchObject({ dry_run: false, valid: true, applied: true });
    expect(applied.totals).toMatchObject({ created: 1, updated: 1, unchanged: 0 });
    expect(applied.rows[0].id).toBeGreaterThan(0);
    expect(db.redirects.find((r) => r.source_path === "/new-one")).toMatchObject({ target: "/blog", status_code: 308, locale_code: null, is_active: true });
    const updated = db.redirects.find((r) => r.source_path === "/old-blog");
    expect(updated).toMatchObject({ target: "/posts", status_code: 302, note: "Blog moved in 2025" });
    expect(db.revisions["redirects/1"].some((r) => r.change_note === "csv import")).toBe(true);
    const again = await report(file);
    expect(again.totals).toMatchObject({ created: 0, updated: 0, unchanged: 2, errors: 0 });
  });

  it("export then import of the same file: every row is unchanged (locale none)", async () => {
    const csv = exportRedirects(db, new URLSearchParams("locale_code=none"));
    const r = await report(csv);
    expect(r.valid).toBe(true);
    expect(r.totals).toMatchObject({ created: 0, updated: 0, errors: 0, unchanged: 5 });
  });

  it("20 imports per hour per user (dry runs count): the 21st is 429 with Retry-After; Redis down is 503", async () => {
    for (let i = 0; i < 20; i += 1) await report("from,to,code\n/a,/b,301\n");
    const e = await fails(run("from,to,code\n/a,/b,301\n"));
    expect(e.status).toBe(429);
    expect(e.headers["Retry-After"]).toBeTruthy();
    importState.used = new WeakMap();
    importState.unavailable = true;
    expect((await fails(run("from,to,code\n/a,/b,301\n"))).status).toBe(503);
  });
});
