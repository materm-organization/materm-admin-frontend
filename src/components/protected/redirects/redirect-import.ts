// Pure helpers of the redirects CSV import dialog (doc/05 section 14.13). No React: the dialog passes the translators in.
import { parseApiError } from "@/lib/api-error";
import { translateFieldError, type ErrorTranslator } from "@/lib/api-error-messages";
import type { ApiFieldError } from "@/types/api";
import type { RedirectImportIssue, RedirectImportReport, RedirectImportRow, RedirectImportStatus } from "@/types/redirects";

export const IMPORT_PAGE_SIZE = 100;

// ---- the report ------------------------------------------------------------------------------------------------------------
export type ImportFilter = "all" | "problems" | RedirectImportStatus | "warnings";

export const IMPORT_FILTERS: readonly ImportFilter[] = ["all", "problems", "error", "created", "updated", "unchanged", "warnings"];

// `problems` = rows with an error or a warning (what the reader has to look at in a file of 50,000 rows).
export function filterImportRows(rows: readonly RedirectImportRow[], filter: ImportFilter): readonly RedirectImportRow[] {
  switch (filter) {
    case "all":
      return rows;
    case "problems":
      return rows.filter((r) => r.errors.length > 0 || r.warnings.length > 0);
    case "warnings":
      return rows.filter((r) => r.warnings.length > 0);
    default:
      return rows.filter((r) => r.status === filter);
  }
}

export function importPageCount(total: number, pageSize = IMPORT_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

// Only this slice is ever rendered: a report may hold 50,000 rows.
export function importPageSlice<T>(rows: readonly T[], page: number, pageSize = IMPORT_PAGE_SIZE): T[] {
  const pages = importPageCount(rows.length, pageSize);
  const safe = Math.min(Math.max(1, page), pages);
  return rows.slice((safe - 1) * pageSize, safe * pageSize);
}

// ---- row issues ------------------------------------------------------------------------------------------------------------
type Values = Record<string, string | number>;

function valuesOf(params: Record<string, unknown> | undefined): Values {
  const out: Values = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (typeof v === "string" || typeof v === "number") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.join(" > ");
  }
  return out;
}

// A row error as the `errors[]` shape of the other redirect screens (`in`, `path`), so the generic fallback texts work too.
export function issueAsFieldError(issue: RedirectImportIssue): ApiFieldError {
  return { in: "body", path: issue.field ? `/${issue.field}` : "", code: issue.code, ...(issue.params ? { params: issue.params } : {}), ...(issue.message ? { message: issue.message } : {}) } as ApiFieldError;
}

// The text of one error of a row. `t` = `redirects.import.errors`, `tRules` = `redirects.fieldErrors.rules`, `tErrors` = `errors`.
// Order: a CSV-specific text for the code (+ `params.rule` for pattern_mismatch) -> the generic `errors.fields.*` text -> the server's English message -> the code.
export function importErrorText(t: ErrorTranslator, tRules: ErrorTranslator, tErrors: ErrorTranslator, issue: RedirectImportIssue): string {
  const params = issue.params;
  // The real backend reports the syntax problems of a row as `pattern_mismatch` + `params.rule` (also `https_only`, `scheme_not_allowed` ...).
  if (issue.code === "pattern_mismatch" && typeof params?.rule === "string") {
    if (tRules.has(params.rule)) return tRules(params.rule);
    if (t.has(params.rule)) return t(params.rule);
  }
  // "at least N steps": the checker stops walking at 64.
  const key = issue.code === "redirect_chain_too_long" && params?.at_least === true && t.has("redirect_chain_too_long_at_least") ? "redirect_chain_too_long_at_least" : issue.code;
  if (t.has(key)) {
    try {
      return t(key, valuesOf(params));
    } catch {
      /* a placeholder is missing: use the generic text */
    }
  }
  const generic = translateFieldError(tErrors, issueAsFieldError(issue));
  return generic || issue.message || issue.code;
}

// `t` = `redirects.import.warnings`.
export function importWarningText(t: ErrorTranslator, issue: RedirectImportIssue): string {
  if (t.has(issue.code)) {
    try {
      return t(issue.code, valuesOf(issue.params));
    } catch {
      /* fall through */
    }
  }
  return issue.message ?? issue.code;
}

// ---- a failed request ------------------------------------------------------------------------------------------------------
// `key` is under `redirects.import.failure.*`; `values` are its ICU arguments.
export type ImportFailure =
  // The apply was refused because rows have errors: `details.report` is the full report (nothing was written).
  | { kind: "report"; report: RedirectImportReport }
  | { kind: "message"; key: string; values: Values; retryAfter?: number };

const FILE_CODES = ["required", "too_many_files", "empty", "no_rows", "header_mismatch", "invalid_csv", "too_many_rows", "has_errors"] as const;

function isReport(value: unknown): value is RedirectImportReport {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Partial<RedirectImportReport>;
  return Array.isArray(r.rows) && typeof r.totals === "object" && r.totals !== null && typeof r.valid === "boolean";
}

export function classifyImportError(error: unknown): ImportFailure {
  const parsed = parseApiError(error);
  const report = parsed.details?.report;
  if (parsed.status === 422 && isReport(report)) return { kind: "report", report };
  if (parsed.isNetworkError) return { kind: "message", key: "network", values: {} };
  switch (parsed.status) {
    case 400:
      return { kind: "message", key: "badRequest", values: {} };
    case 403:
      return { kind: "message", key: "forbidden", values: {} };
    case 413: {
      const max = typeof parsed.details?.max_bytes === "number" ? parsed.details.max_bytes : 0;
      return { kind: "message", key: "tooLarge", values: { max: max ? Math.round(max / (1024 * 1024)) : 8 } };
    }
    case 415:
      return { kind: "message", key: "unsupported", values: {} };
    case 429:
      return { kind: "message", key: parsed.retryAfter ? "rateLimitedRetry" : "rateLimited", values: { seconds: parsed.retryAfter ?? 0, minutes: Math.max(1, Math.ceil((parsed.retryAfter ?? 0) / 60)) }, retryAfter: parsed.retryAfter };
    case 503:
      return { kind: "message", key: "unavailable", values: {}, retryAfter: parsed.retryAfter };
    case 422: {
      const e = parsed.fieldErrors.find((f) => f.path === "/file" || f.path === "/dry_run") ?? parsed.fieldErrors[0];
      if (e?.path === "/file" && (FILE_CODES as readonly string[]).includes(e.code)) {
        return { kind: "message", key: `file.${e.code}`, values: valuesOf(e.params as Record<string, unknown> | undefined) };
      }
      if (e?.path === "/dry_run") return { kind: "message", key: "badRequest", values: {} };
      return { kind: "message", key: "generic", values: {} };
    }
    default:
      return { kind: "message", key: "generic", values: {} };
  }
}

// ---- the file --------------------------------------------------------------------------------------------------------------
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
