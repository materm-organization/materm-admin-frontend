import { describe, expect, it } from "vitest";

import {
  IMPORT_PAGE_SIZE,
  classifyImportError,
  filterImportRows,
  importErrorText,
  importPageCount,
  importPageSlice,
  importWarningText,
} from "@/components/protected/redirects/redirect-import";
import type { ErrorTranslator } from "@/lib/api-error-messages";
import { apiError, networkError } from "@/test/api-error";
import type { RedirectImportRow } from "@/types/redirects";

import en from "../../../../i18n/en.json";

// A translator over the real English messages (ICU placeholders `{name}` only, which is all these texts use).
function translator(tree: Record<string, unknown>): ErrorTranslator {
  const find = (key: string) => key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), tree);
  const t = ((key: string, values: Record<string, string | number> = {}) => {
    const text = find(key);
    if (typeof text !== "string") throw new Error(`no message ${key}`);
    return text.replace(/\{(\w+)\}/g, (_m, name: string) => String(values[name]));
  }) as ErrorTranslator;
  t.has = (key: string) => typeof find(key) === "string";
  return t;
}
const tErr = translator(en.redirects.import.errors);
const tWarn = translator(en.redirects.import.warnings);
const tRules = translator(en.redirects.fieldErrors.rules);
const tErrors = translator(en.errors);

const row = (n: number, status: RedirectImportRow["status"], extra: Partial<RedirectImportRow> = {}): RedirectImportRow => ({
  row: n, from: `/p${n}`, to: "/t", code: "301", status, id: null, previous: null, errors: [], warnings: [], ...extra,
});

describe("import report rows", () => {
  const rows = [
    row(2, "created"),
    row(3, "updated", { warnings: [{ code: "redirect_chain", params: { hops: 2, final_target: "/x" } }] }),
    row(4, "unchanged"),
    row(5, "error", { errors: [{ field: "to", code: "https_only" }] }),
  ];
  it("filters by result, by problems and by warnings", () => {
    expect(filterImportRows(rows, "all")).toHaveLength(4);
    expect(filterImportRows(rows, "error").map((r) => r.row)).toEqual([5]);
    expect(filterImportRows(rows, "updated").map((r) => r.row)).toEqual([3]);
    expect(filterImportRows(rows, "problems").map((r) => r.row)).toEqual([3, 5]);
    expect(filterImportRows(rows, "warnings").map((r) => r.row)).toEqual([3]);
  });
  it("pages by 100 and never returns more than a page, also out of range", () => {
    const many = Array.from({ length: 50_000 }, (_v, i) => i);
    expect(importPageCount(many.length)).toBe(500);
    expect(importPageSlice(many, 1)).toHaveLength(IMPORT_PAGE_SIZE);
    expect(importPageSlice(many, 500)[99]).toBe(49_999);
    expect(importPageSlice(many, 9999)).toHaveLength(IMPORT_PAGE_SIZE);
    expect(importPageSlice(many, 0)[0]).toBe(0);
    expect(importPageCount(0)).toBe(1);
    expect(importPageSlice([], 1)).toEqual([]);
  });
});

describe("importErrorText / importWarningText", () => {
  it("prefers the code and params over the server's English message", () => {
    expect(importErrorText(tErr, tRules, tErrors, { field: "from", code: "duplicate_in_file", message: "English", params: { first_row: 7 } })).toBe('The same "from" is already on line 7.');
    expect(importErrorText(tErr, tRules, tErrors, { field: "to", code: "redirect_loop", params: { path: ["/a", "/b", "/a"], locale: "" } })).toBe("This makes a loop: /a > /b > /a.");
    expect(importErrorText(tErr, tRules, tErrors, { field: "to", code: "redirect_chain_too_long", params: { hops: 4, max: 3, final_target: "/e" } })).toContain("4 steps");
    expect(importErrorText(tErr, tRules, tErrors, { field: "to", code: "redirect_chain_too_long", params: { hops: 64, max: 3, at_least: true } })).toContain("at least 64 steps");
    expect(importErrorText(tErr, tRules, tErrors, { field: "from", code: "pattern_mismatch", params: { rule: "protocol_relative" } })).toContain("cannot start with //");
    // the real backend: pattern_mismatch + params.rule for the address rules of 14.2 as well
    expect(importErrorText(tErr, tRules, tErrors, { field: "to", code: "pattern_mismatch", params: { rule: "https_only" } })).toBe("Only https:// addresses are allowed, not http://.");
    expect(importErrorText(tErr, tRules, tErrors, { field: "to", code: "pattern_mismatch", params: { rule: "scheme_not_allowed" } })).toContain("javascript:");
    expect(importErrorText(tErr, tRules, tErrors, { field: "code", code: "not_in_enum", params: { expected: [301, 302, 307, 308] } })).toContain("301, 302, 307 or 308");
    expect(importErrorText(tErr, tRules, tErrors, { field: "code", code: "not_in_enum" })).toContain("301, 302, 307 or 308");
    expect(importErrorText(tErr, tRules, tErrors, { field: "from", code: "csv_formula" })).toContain("formula");
  });
  it("falls back to the generic field text, then to the server's message, for a code it does not know", () => {
    expect(importErrorText(tErr, tRules, tErrors, { field: "from", code: "pattern_mismatch", params: { rule: "new_rule" } })).toBe("The value does not match the required pattern.");
    expect(importErrorText(tErr, tRules, tErrors, { field: "from", code: "brand_new_code", message: "Server says so" })).toBe("Server says so");
  });
  it("warnings: translated, or the server's message", () => {
    expect(importWarningText(tWarn, { code: "redirect_chain", params: { hops: 3, final_target: "/z" } })).toBe("This starts a chain of 3 steps. Point it straight at /z.");
    expect(importWarningText(tWarn, { code: "source_is_published_page" })).toContain("published page");
    expect(importWarningText(tWarn, { code: "other", message: "Fallback" })).toBe("Fallback");
  });
});

describe("classifyImportError", () => {
  it("422 with details.report is the refused apply", () => {
    const report = { dry_run: false, valid: false, applied: false, totals: { rows: 1, created: 0, updated: 0, unchanged: 0, errors: 1 }, rows: [row(2, "error")] };
    expect(classifyImportError(apiError(422, { code: "VALIDATION_FAILED", errors: [{ in: "body", path: "/file", code: "has_errors" }], details: { report } }))).toEqual({ kind: "report", report });
  });
  it("maps each file-level code, 400, 403, 413, 415, 429 and 503", () => {
    const msg = (e: unknown) => classifyImportError(e) as { kind: "message"; key: string; values: Record<string, unknown>; retryAfter?: number };
    const file = (code: string, params?: object) => apiError(422, { code: "VALIDATION_FAILED", errors: [{ in: "body", path: "/file", code, ...(params ? { params } : {}) }] });
    for (const code of ["required", "too_many_files", "empty", "no_rows", "header_mismatch", "invalid_csv", "too_many_rows", "has_errors"]) expect(msg(file(code)).key).toBe(`file.${code}`);
    expect(msg(file("invalid_csv", { line: 9 })).values).toEqual({ line: 9 });
    expect(msg(file("too_many_rows", { max: 50000 })).values).toEqual({ max: 50000 });
    expect(msg(apiError(422, { errors: [{ in: "query", path: "/dry_run", code: "invalid_type" }] })).key).toBe("badRequest");
    expect(msg(apiError(400)).key).toBe("badRequest");
    expect(msg(apiError(403, { code: "FORBIDDEN" })).key).toBe("forbidden");
    expect(msg(apiError(413, { details: { reason: "file_too_large", max_bytes: 8388608 } }))).toMatchObject({ key: "tooLarge", values: { max: 8 } });
    expect(msg(apiError(415)).key).toBe("unsupported");
    expect(msg(apiError(429, { code: "RATE_LIMITED" }, { "retry-after": "1800" }))).toMatchObject({ key: "rateLimitedRetry", retryAfter: 1800, values: { minutes: 30 } });
    expect(msg(apiError(429, { code: "RATE_LIMITED" })).key).toBe("rateLimited");
    expect(msg(apiError(503, {}, { "retry-after": "30" }))).toMatchObject({ key: "unavailable", retryAfter: 30 });
    expect(msg(networkError()).key).toBe("network");
    expect(msg(apiError(500)).key).toBe("generic");
  });
});
