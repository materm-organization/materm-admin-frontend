// Redirects (SCR-42, doc/05 section 14, doc/07 section 3.26, FR-SEO-05/06). Save-live: a write is live at once; delete is a soft
// delete into the 30-day trash (restore needs `cms.redirects:delete`). ETag = `"<updated_at>"` like the other save-live rows
// (`etagOfRow` converts the +07:00 `updated_at` to UTC micros; the row also carries `etag`).
import type { ApiFieldError } from "@/types/api";
import type { UserRef, SaveLiveWarning } from "@/types/media";

export type RedirectStatusCode = 301 | 302 | 307 | 308;

export type Redirect = {
  id: number;
  public_id: string;
  // A path only: starts with `/`, lower case, no trailing slash (the server normalises too).
  source_path: string;
  // A path inside the site (`/...`) or an `https://` URL.
  target: string;
  status_code: RedirectStatusCode;
  // `null` = every language.
  locale_code: string | null;
  is_active: boolean;
  note: string | null;
  created_by?: UserRef;
  updated_by?: UserRef;
  created_at: string;
  updated_at: string;
  // Only for a row in the trash.
  deleted_at?: string | null;
  purge_at?: string | null;
  etag?: string;
  // Only on the answer of a write (POST, PATCH, restore; always there, maybe empty). Non-blocking: BR-26, a published page wins.
  warnings?: SaveLiveWarning[];
};

export type RedirectsQuery = {
  page?: number;
  limit?: number;
  // Matches source, target and note (contains, any case).
  keyword?: string;
  status_code?: RedirectStatusCode;
  // A language code, or `none` = only the rows that apply to every language.
  locale_code?: string;
  is_active?: boolean;
  // The trash (needs read + delete, else 403).
  trashed?: boolean;
  sort?: string;
};

// The export has the same filters but no paging / sort, and no trash (`trashed=true` is a 422 `not_applicable`).
export type RedirectsExportQuery = Omit<RedirectsQuery, "page" | "limit" | "sort" | "trashed">;

export type CreateRedirectPayload = {
  source_path: string;
  target: string;
  status_code?: RedirectStatusCode;
  locale_code?: string | null;
  is_active?: boolean;
  note?: string | null;
};
export type UpdateRedirectPayload = Partial<CreateRedirectPayload>;

// Dry run (doc/05 14.5). `id` = the row being edited (left out of the graph and of the slot check).
export type RedirectCheckPayload = CreateRedirectPayload & { id?: number };

// An error of the check has the shape of `errors[]` of a 422 / 409 (doc/05 1.5); a warning has no `in`.
// Errors: `redirect_loop` (params.path = the walk, params.locale), `redirect_chain_too_long` (hops, max, final_target),
// `self_redirect`, `duplicate` (the slot is taken) and every syntax code of 14.2.
// Warnings: `source_is_published_page` (page_id, page_key: the page wins), `redirect_chain` (hops, final_target).
export type RedirectCheckWarning = { path: string; code: string; message?: string; params?: Record<string, unknown> };

export type RedirectCheckResult = {
  // `true` when there is no error (warnings do not count).
  valid: boolean;
  // `null` when no source path was usable.
  normalized: { source_path: string; locale_code: string | null; target: string; status_code: RedirectStatusCode; is_active: boolean } | null;
  errors: ApiFieldError[];
  warnings: RedirectCheckWarning[];
  // The length of the chain this redirect would be part of (>= 1 when valid and active, else 0).
  hops: number;
};

// The flat snapshot of a revision (doc/05 14.6).
export type RedirectSnapshot = {
  source_path: string;
  locale_code: string | null;
  target: string;
  status_code: RedirectStatusCode;
  is_active: boolean;
  note: string | null;
};

// ---- CSV import (doc/05 14.13, `POST /redirects/import?dry_run=`) -----------------------------------------------------
// `status` of a row; `error` rows are never written.
export type RedirectImportStatus = "created" | "updated" | "unchanged" | "error";

// An error of one row: `field` is `from | to | code`, or `""` for the whole row. `code` = a field code of 14.2 / 14.4 or one of
// `csv_formula`, `duplicate_in_file`, `wrong_column_count`, `invalid_type`, `redirect_loop`, `redirect_chain_too_long`.
// `message` is English (log / fallback); the UI translates `code` + `params`.
export type RedirectImportIssue = { field?: string; code: string; message?: string; params?: Record<string, unknown> };

// Cells are echoed as sent (cut at 2001 characters): ALWAYS render them as text.
export type RedirectImportRow = {
  // The line in the file (header = 1, first data row = 2).
  row: number;
  from: string;
  to: string;
  code: string;
  status: RedirectImportStatus;
  // Existing row for updated / unchanged; the new row after a real import; `null` in a dry run for created.
  id: number | null;
  // Only for `updated`.
  previous: { to: string; code: number } | null;
  errors: RedirectImportIssue[];
  warnings: RedirectImportIssue[];
};

export type RedirectImportTotals = { rows: number; created: number; updated: number; unchanged: number; errors: number };

export type RedirectImportReport = {
  dry_run: boolean;
  // No row has an error.
  valid: boolean;
  // `true` only for a real import that was committed.
  applied: boolean;
  totals: RedirectImportTotals;
  rows: RedirectImportRow[];
};
