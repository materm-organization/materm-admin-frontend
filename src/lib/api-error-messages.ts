// Turns a ParsedApiError into text for the UI using the `errors` i18n
// namespace (keys: `codes.<CODE>` and `fields.<field code>` — field codes with
// a dot, e.g. `password_policy.min_length`, are NESTED JSON in the message
// files). Order: i18n key for the machine code -> the server's own `message`
// (already localised, `Accept-Language` is not sent so it is English) -> a
// generic fallback. Pure (takes `t`) so it can be used from hooks and from
// QueryProvider's global error toasts.
import { API_ERROR_CODES, type ParsedApiError } from "@/lib/api-error";
import type { ApiFieldError } from "@/types/api";

export type ErrorTranslator = {
  (key: string, values?: Record<string, string | number>): string;
  has: (key: string) => boolean;
};

// ICU values from `details`/`params`: only primitives (arrays/objects are
// not valid message arguments).
function toValues(
  source: Record<string, unknown> | undefined,
  extra: Record<string, string | number> = {}
): Record<string, string | number> {
  const out: Record<string, string | number> = { ...extra };
  if (source) {
    for (const [k, v] of Object.entries(source)) {
      if (typeof v === "string" || typeof v === "number") out[k] = v;
      else if (Array.isArray(v)) out[k] = v.join(", ");
    }
  }
  return out;
}

export function translateApiError(
  t: ErrorTranslator,
  parsed: ParsedApiError,
  fallback?: string
): string {
  if (parsed.isNetworkError) return t("codes.NETWORK_ERROR");

  const { code } = parsed;
  if (code) {
    let key = `codes.${code}`;
    // "Try again in N seconds" variant when the server sent Retry-After.
    if (code === API_ERROR_CODES.RATE_LIMITED && parsed.retryAfter && t.has("codes.RATE_LIMITED_RETRY")) {
      key = "codes.RATE_LIMITED_RETRY";
    }
    if (t.has(key)) {
      try {
        const text = t(key, toValues(parsed.details, { seconds: parsed.retryAfter ?? 0 }));
        if (code === API_ERROR_CODES.INTERNAL_ERROR && parsed.requestId) {
          return t("withRequestId", { message: text, requestId: parsed.requestId });
        }
        return text;
      } catch {
        /* fall through to the server message */
      }
    }
  }
  return parsed.message || fallback || t("codes.UNKNOWN");
}

export function translateFieldError(t: ErrorTranslator, fieldError: ApiFieldError): string {
  const key = `fields.${fieldError.code}`;
  if (t.has(key)) {
    try {
      return t(key, toValues(fieldError.params));
    } catch {
      /* fall through */
    }
  }
  return fieldError.message || t("fields.invalid");
}
