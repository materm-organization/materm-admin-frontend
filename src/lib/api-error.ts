// Normalises a failed API call. Clients decide on the machine `code`
// (doc/05 section 1.4), never on the human `message`. Pure (no React) so the
// axios layer, hooks and components can all use it.
import axios from "axios";

import type { ApiErrorResponse, ApiFieldError } from "@/types/api";

// Machine codes this app branches on. Everything else is just displayed.
export const API_ERROR_CODES = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  AUTHZ_CHANGED: "AUTHZ_CHANGED",
  SESSION_REVOKED: "SESSION_REVOKED",
  REFRESH_REUSED: "REFRESH_REUSED",
  REFRESH_REPLAY_UNAVAILABLE: "REFRESH_REPLAY_UNAVAILABLE",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  INVALID_OLD_PASSWORD: "INVALID_OLD_PASSWORD",
  PASSWORD_CHANGE_REQUIRED: "PASSWORD_CHANGE_REQUIRED",
  FORBIDDEN: "FORBIDDEN",
  RATE_LIMITED: "RATE_LIMITED",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  CONFLICT_DUPLICATE: "CONFLICT_DUPLICATE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

// 401s after which refreshing is pointless: go straight to sign-in.
export const SESSION_ENDING_CODES: ReadonlySet<string> = new Set([
  API_ERROR_CODES.SESSION_REVOKED,
  API_ERROR_CODES.REFRESH_REUSED,
  API_ERROR_CODES.REFRESH_REPLAY_UNAVAILABLE,
]);

export type ParsedApiError = {
  status?: number;
  // Machine code, e.g. "VALIDATION_FAILED" (undefined for network errors).
  code?: string;
  // Server's human text (already in the requested language) — fallback only.
  message?: string;
  fieldErrors: ApiFieldError[];
  details?: Record<string, unknown>;
  requestId?: string;
  // Seconds, from the Retry-After header (429/503).
  retryAfter?: number;
  isNetworkError: boolean;
};

const CODE_LIKE = /^[A-Z][A-Z0-9_]+$/;

export function parseApiError(error: unknown): ParsedApiError {
  if (!axios.isAxiosError<ApiErrorResponse>(error)) {
    return {
      fieldErrors: [],
      message: error instanceof Error ? error.message : undefined,
      isNetworkError: false,
    };
  }
  const response = error.response;
  if (!response) return { fieldErrors: [], isNetworkError: true };

  const body = response.data && typeof response.data === "object" ? response.data : undefined;
  const message = typeof body?.message === "string" ? body.message : undefined;
  // Some older docs put the code in `message` (UPPER_SNAKE); accept it so the
  // client works whichever the backend does.
  const code =
    typeof body?.code === "string" && body.code
      ? body.code
      : message && CODE_LIKE.test(message)
        ? message
        : undefined;
  const retryHeader = Number(response.headers?.["retry-after"]);

  return {
    status: response.status,
    code,
    message: message && !CODE_LIKE.test(message) ? message : undefined,
    fieldErrors: Array.isArray(body?.errors) ? body.errors : [],
    details: body?.details,
    requestId: body?.request_id,
    retryAfter: Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : undefined,
    isNetworkError: false,
  };
}

// Errors the app shows as a global toast (QueryProvider's caches) instead of
// leaving to the calling form: network failures, 403 (but not
// PASSWORD_CHANGE_REQUIRED, which opens the change-password dialog), 429 and
// 5xx. Form handlers must NOT toast these again — see useApiErrorHandler.
// "No permission" in the UI: a 403 (except PASSWORD_CHANGE_REQUIRED, which opens the forced change-password
// dialog instead) or a 401 that reached the UI without ending the session (the interceptor already refreshed
// once). Such a read is never retried and is shown as the "no permission" state, not as an error to retry.
export function isNoPermissionError(error: unknown): boolean {
  const parsed = parseApiError(error);
  if (parsed.status === 403) return parsed.code !== API_ERROR_CODES.PASSWORD_CHANGE_REQUIRED;
  if (parsed.status === 401) return !(parsed.code && SESSION_ENDING_CODES.has(parsed.code));
  return false;
}

export function isGloballyToasted(parsed: ParsedApiError): boolean {
  if (parsed.isNetworkError) return true;
  if (parsed.status === 403) return parsed.code !== API_ERROR_CODES.PASSWORD_CHANGE_REQUIRED;
  if (parsed.status === 429) return true;
  return parsed.status !== undefined && parsed.status >= 500;
}
