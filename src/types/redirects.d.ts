// Redirects (SCR-42, doc/05 section 6.10, doc/07 section 3.26, FR-SEO-05/06). Save-live: a write is live at once. Columns follow
// `cms_redirects` (doc/03): no hit count. ETag = `"<updated_at>"` like the other save-live rows (`etagOfRow`).
// PROVISIONAL parts (doc/05 6.10 only lists the paths): the list filters, the body and answer of `POST /redirects/check`, the
// error codes `redirect_loop` / `redirect_chain_too_long` / `target_equals_source` and the CSV export filters. They are
// listed in the hand-over of T-redirects-ui and must be reconciled with the backend.
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
  etag?: string;
  // Only on the answer of a write (non-blocking: a published page wins over the redirect, BR-26).
  warnings?: SaveLiveWarning[];
};

export type RedirectsQuery = {
  page?: number;
  limit?: number;
  // Matches source, target and note.
  keyword?: string;
  status_code?: RedirectStatusCode;
  // A language code, or `all` = the rows without a language (they apply to every language).
  locale_code?: string;
  is_active?: boolean;
  sort?: string;
};

export type RedirectsExportQuery = Omit<RedirectsQuery, "page" | "limit" | "sort">;

export type CreateRedirectPayload = {
  source_path: string;
  target: string;
  status_code?: RedirectStatusCode;
  locale_code?: string | null;
  is_active?: boolean;
  note?: string | null;
};
export type UpdateRedirectPayload = Partial<CreateRedirectPayload>;

// Dry run (FR-SEO-06). `id` = the row being edited (it must not collide with itself).
export type RedirectCheckPayload = {
  source_path: string;
  target: string;
  status_code?: RedirectStatusCode;
  locale_code?: string | null;
  id?: number;
};

export type RedirectCheckIssue = {
  // errors: `redirect_loop` (params.chain), `redirect_chain_too_long` (params.hops, params.final_target), `target_equals_source`,
  // `duplicate`; warnings: `page_published` (params.path)
  code: string;
  message?: string;
  params?: Record<string, unknown>;
};

export type RedirectCheckResult = {
  // `true` when there is no error (warnings do not count).
  valid: boolean;
  errors: RedirectCheckIssue[];
  warnings: RedirectCheckIssue[];
};
