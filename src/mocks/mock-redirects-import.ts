// `POST /redirects/import?dry_run=` (doc/05 14.13), strict to the contract: multipart `file`, the file checked by its BYTES (zip, NUL, not
// UTF-8 -> 415; over 8 MiB -> 413), header `from,to,code`, <= 50,000 rows, per-row rules of 14.2, formulas refused, duplicates in the file,
// the whole-file loop / chain check, `created | updated | unchanged | error`, all-or-nothing apply (422 with the full report in
// `details.report`), 20 imports per hour per user (dry runs count; 429 + Retry-After), Redis down = 503 (a knob).
// Simplified: the graph walk ignores language-specific redirects (the file only holds "every language" rows).
import {
  MOCK_USER,
  fail,
  tick,
  validationFailed,
  pushRevision,
  type MockDb,
  type Params,
} from "@/mocks/mock-core";
import { normInternal, normSource, redirectSnapshot, sourceErrors, targetErrors } from "@/mocks/mock-redirects";
import { parseMultipart } from "@/mocks/mock-media-upload";
import type { ApiFieldError } from "@/types/api";
import type { Redirect, RedirectImportIssue, RedirectImportReport, RedirectImportRow, RedirectStatusCode } from "@/types/redirects";

export const IMPORT_MAX_BYTES = 8 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 50_000;
const MAX_HOPS = 3;
const CODES = [301, 302, 307, 308];
// Knobs for tests: the imports used so far, and a Redis outage.
export const importState = { used: new WeakMap<MockDb, number>(), limit: 20, unavailable: false };

const FORMULA = /^[\s​-‏﻿\u0000-\u001f]*[=+\-@＝＋－＠]|^[\t\r]/;

function parseCsv(text: string): { rows: Array<{ line: number; cells: string[] }> } | { error: number } {
  const rows: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let startLine = 1;
  let any = false;
  const endRow = () => {
    cells.push(cell);
    // A blank line is skipped.
    if (!(cells.length === 1 && cells[0] === "" && !any)) rows.push({ line: startLine, cells });
    cells = [];
    cell = "";
    any = false;
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else {
        if (ch === "\n") line += 1;
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
      any = true;
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
      any = true;
    } else if (ch === "\r") {
      continue;
    } else if (ch === "\n") {
      endRow();
      line += 1;
      startLine = line;
    } else {
      cell += ch;
      any = true;
    }
  }
  if (quoted) return { error: startLine };
  if (cell !== "" || cells.length > 0 || any) endRow();
  return { rows };
}

const issue = (field: string, code: string, params?: Record<string, unknown>): RedirectImportIssue => ({ field, code, message: code, ...(params ? { params } : {}) });
const fieldOf = (e: ApiFieldError) => (e.path === "/source_path" ? "from" : e.path === "/target" ? "to" : "");

export async function importRedirects(db: MockDb, request: Request, params: Params) {
  if (importState.unavailable) throw fail(503, "SERVICE_UNAVAILABLE", "The service is unavailable.", {}, { "Retry-After": "30" });
  const used = importState.used.get(db) ?? 0;
  if (used >= importState.limit) throw fail(429, "RATE_LIMITED", "Too many requests.", {}, { "Retry-After": "1800" });
  importState.used.set(db, used + 1);

  const raw = params.get("dry_run");
  if (raw !== null && raw !== "true" && raw !== "false") throw validationFailed([{ in: "query", path: "/dry_run", code: "invalid_type" }]);
  const dryRun = raw !== "false";

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > IMPORT_MAX_BYTES + 4096) throw fail(413, "PAYLOAD_TOO_LARGE", "The file is too large.", { details: { reason: "file_too_large", max_bytes: IMPORT_MAX_BYTES } });
  const parts = parseMultipart(bytes, request.headers.get("content-type")).filter((p) => p.filename !== undefined || p.name === "file");
  if (parts.length === 0) throw validationFailed([{ in: "body", path: "/file", code: "required" }]);
  if (parts.length > 1) throw validationFailed([{ in: "body", path: "/file", code: "too_many_files" }]);
  const data = parts[0].bytes;
  if (data.length > IMPORT_MAX_BYTES) throw fail(413, "PAYLOAD_TOO_LARGE", "The file is too large.", { details: { reason: "file_too_large", max_bytes: IMPORT_MAX_BYTES } });
  let text: string;
  try {
    if (data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04) throw new Error("zip");
    if (data.includes(0)) throw new Error("nul");
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw fail(415, "UNSUPPORTED_MEDIA_TYPE", "The file is not a UTF-8 CSV.");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const file = (code: string, p?: Record<string, unknown>) => validationFailed([{ in: "body", path: "/file", code, ...(p ? { params: p } : {}) } as ApiFieldError]);
  if (text.trim() === "") throw file("empty");
  const parsed = parseCsv(text);
  if ("error" in parsed) throw file("invalid_csv", { line: parsed.error });
  const [header, ...dataRows] = parsed.rows;
  if (!header || header.cells.map((c) => c.trim().toLowerCase()).join(",") !== "from,to,code") throw file("header_mismatch");
  if (dataRows.length === 0) throw file("no_rows");
  if (dataRows.length > IMPORT_MAX_ROWS) throw file("too_many_rows", { max: IMPORT_MAX_ROWS });

  const report = plan(db, dataRows);
  report.dry_run = dryRun;
  if (dryRun) return report;
  if (!report.valid) {
    report.applied = false;
    throw fail(422, "VALIDATION_FAILED", "The submitted data is not valid.", {
      errors: [{ in: "body", path: "/file", code: "has_errors", params: { errors: report.totals.errors } }],
      details: { report },
    });
  }
  apply(db, report);
  report.applied = true;
  return report;
}

function plan(db: MockDb, dataRows: Array<{ line: number; cells: string[] }>): RedirectImportReport {
  const live = db.redirects.filter((r) => !r.deleted_at && r.locale_code === null);
  const rows: RedirectImportRow[] = [];
  const firstOf = new Map<string, number>();
  for (const { line, cells } of dataRows) {
    const [from = "", to = "", code = ""] = cells;
    const row: RedirectImportRow = { row: line, from: from.slice(0, 2001), to: to.slice(0, 2001), code: code.slice(0, 2001), status: "created", id: null, previous: null, errors: [], warnings: [] };
    rows.push(row);
    if (cells.length !== 3) {
      row.errors.push(issue("", "wrong_column_count", { expected: 3, got: cells.length }));
      continue;
    }
    for (const [field, value] of [["from", from], ["to", to], ["code", code]] as const) {
      if (FORMULA.test(value)) row.errors.push(issue(field, "csv_formula"));
    }
    if (row.errors.length) continue;
    // Like the real backend: a syntax problem of the address is `pattern_mismatch` + `params.rule`.
    const asIssue = (e: ApiFieldError) =>
      ["https_only", "scheme_not_allowed", "userinfo_not_allowed", "host_required", "path_or_https_url"].includes(e.code)
        ? issue(fieldOf(e), "pattern_mismatch", { rule: e.code })
        : issue(fieldOf(e), e.code, e.params as Record<string, unknown> | undefined);
    for (const e of sourceErrors(from)) row.errors.push(asIssue(e));
    for (const e of targetErrors(to)) row.errors.push(asIssue(e));
    let status: RedirectStatusCode = 301;
    if (code.trim() !== "") {
      if (!/^-?\d+$/.test(code.trim())) row.errors.push(issue("code", "invalid_type"));
      else if (!CODES.includes(Number(code.trim()))) row.errors.push(issue("code", "not_in_enum", { expected: CODES.join(", ") }));
      else status = Number(code.trim()) as RedirectStatusCode;
    }
    if (row.errors.length) continue;
    const source = normSource(from);
    if (to.trim().startsWith("/") && normInternal(to) === source) {
      row.errors.push(issue("to", "self_redirect", { path: source }));
      continue;
    }
    const first = firstOf.get(source);
    if (first !== undefined) {
      row.errors.push(issue("from", "duplicate_in_file", { first_row: first }));
      continue;
    }
    firstOf.set(source, line);
    const existing = live.find((r) => r.source_path === source);
    const target = to.trim();
    if (existing) {
      row.id = existing.id;
      row.status = existing.target === target && existing.status_code === status ? "unchanged" : "updated";
      if (row.status === "updated") row.previous = { to: existing.target, code: existing.status_code };
    }
    (row as RedirectImportRow & { _n?: { source: string; target: string; status: RedirectStatusCode } })._n = { source, target, status };
  }

  // The graph: active redirects for every language, overlaid with the rows of the file that are not errors.
  const edges = new Map<string, string>();
  for (const r of live) if (r.is_active) edges.set(r.source_path, r.target);
  const okRows = rows.filter((r) => r.errors.length === 0) as Array<RedirectImportRow & { _n: { source: string; target: string; status: RedirectStatusCode } }>;
  for (const r of okRows) edges.set(r._n.source, r._n.target);
  for (const r of okRows) {
    if (r.status === "unchanged" && live.find((x) => x.id === r.id && !x.is_active)) continue;
    const walk = [r._n.source];
    let current = r._n.target;
    let hops = 1;
    let loop = false;
    while (current.startsWith("/") && hops <= 64) {
      const key = normSource(current.replace(/[?#].*$/, ""));
      walk.push(key);
      const next = edges.get(key);
      if (!next) break;
      if (walk.slice(0, -1).includes(key)) {
        loop = true;
        break;
      }
      hops += 1;
      current = next;
    }
    if (loop) {
      r.errors.push(issue("to", "redirect_loop", { path: walk, locale: "" }));
    } else if (hops > MAX_HOPS) {
      r.errors.push(issue("to", "redirect_chain_too_long", { hops, max: MAX_HOPS, final_target: current, ...(hops > 64 ? { at_least: true } : {}) }));
    } else if (hops >= 2) {
      r.warnings.push({ code: "redirect_chain", message: "redirect_chain", params: { hops, final_target: current } });
    }
    const page = db.pages.find((p) => p.status === "published" && !p.deleted_at && p.live.page.path === r._n.source);
    if (page) r.warnings.push({ code: "source_is_published_page", message: "source_is_published_page", params: { page_id: page.id, page_key: page.live.page.key } });
  }
  const planned = okRows.filter((r) => r.errors.length === 0).map((r) => ({ row: r.row, ...r._n }));
  for (const r of rows) {
    if (r.errors.length) r.status = "error";
    delete (r as unknown as Record<string, unknown>)._n;
  }
  const totals = { rows: rows.length, created: 0, updated: 0, unchanged: 0, errors: 0 };
  for (const r of rows) totals[r.status === "error" ? "errors" : r.status] += 1;
  // Keep the private plan for `apply`.
  const report: RedirectImportReport & { _plan?: unknown } = { dry_run: true, valid: totals.errors === 0, applied: false, totals, rows };
  Object.defineProperty(report, "_plan", { value: planned, enumerable: false });
  return report;
}

function apply(db: MockDb, report: RedirectImportReport) {
  const planned = (report as unknown as { _plan: Array<{ row: number; source: string; target: string; status: RedirectStatusCode }> })._plan;
  for (const item of planned) {
    const row = report.rows.find((r) => r.row === item.row)!;
    if (row.status === "unchanged") continue;
    const at = tick(db);
    if (row.status === "updated") {
      const existing = db.redirects.find((r) => r.id === row.id) as Redirect;
      pushRevision(db, "redirects", existing.id, "cms.redirects", "history", redirectSnapshot(existing) as unknown as Record<string, unknown>, "csv import", at, MOCK_USER);
      Object.assign(existing, { target: item.target, status_code: item.status, updated_at: at, updated_by: MOCK_USER });
    } else {
      const created: Redirect = {
        id: db.nextRedirectId++,
        public_id: `0192d3a4-7c1e-7b52-9d0a-${String(db.nextRedirectId).padStart(12, "0")}`,
        source_path: item.source,
        target: item.target,
        status_code: item.status,
        locale_code: null,
        is_active: true,
        note: null,
        created_by: MOCK_USER,
        updated_by: MOCK_USER,
        created_at: at,
        updated_at: at,
        deleted_at: null,
        purge_at: null,
      };
      db.redirects.push(created);
      row.id = created.id;
    }
  }
}

