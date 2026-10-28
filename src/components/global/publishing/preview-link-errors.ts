import { parseApiError } from "@/lib/api-error";

// What a failed `POST /pages/{id}/preview-links` (doc/05 12.9.2) means for the dialog. Decided on the machine code, the
// status and the field-error codes, never on `message`. Pure (no React).
export type PreviewCreateProblem =
  | { kind: "notConfigured" } // 503 SERVICE_UNAVAILABLE, details.dependency = preview.portalUrl
  | { kind: "unavailable" } // any other 5xx / 503
  | { kind: "limit"; max: number } // 422 limit_exceeded (body, path "")
  | { kind: "locale" } // 422 unknown_reference at /locale (the language is not active)
  | { kind: "ttl"; min: number; max: number } // 422 out_of_range at /ttl_minutes
  | { kind: "rate"; retryAfter: number | undefined } // 429
  | { kind: "trashed" } // 409 INVALID_STATE reason trashed
  | { kind: "invalidState" } // 409 INVALID_STATE, another reason
  | { kind: "notFound" } // 404
  | { kind: "forbidden" } // 403
  | { kind: "network" }
  | { kind: "other" };

export const PORTAL_URL_DEPENDENCY = "preview.portalUrl";

export function classifyPreviewCreateError(error: unknown): PreviewCreateProblem {
  const parsed = parseApiError(error);
  if (parsed.isNetworkError) return { kind: "network" };
  switch (parsed.status) {
    case 503:
      return parsed.details?.dependency === PORTAL_URL_DEPENDENCY ? { kind: "notConfigured" } : { kind: "unavailable" };
    case 429:
      return { kind: "rate", retryAfter: parsed.retryAfter };
    case 404:
      return { kind: "notFound" };
    case 403:
      return { kind: "forbidden" };
    case 409:
      if (parsed.code === "INVALID_STATE") return parsed.details?.reason === "trashed" ? { kind: "trashed" } : { kind: "invalidState" };
      return { kind: "other" };
    case 422: {
      for (const fe of parsed.fieldErrors) {
        if (fe.code === "limit_exceeded") return { kind: "limit", max: Number(fe.params?.max) || 20 };
        if (fe.path === "/locale" && fe.code === "unknown_reference") return { kind: "locale" };
        if (fe.path === "/ttl_minutes" && fe.code === "out_of_range") {
          return { kind: "ttl", min: Number(fe.params?.min) || 1, max: Number(fe.params?.max) || 1440 };
        }
      }
      return { kind: "other" };
    }
    default:
      return parsed.status !== undefined && parsed.status >= 500 ? { kind: "unavailable" } : { kind: "other" };
  }
}

// Only http(s) addresses are put into an `href` (a server bug or a poisoned answer must not become a `javascript:` link).
export function safeHttpUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export const PRESET_TTL_MINUTES = [30, 60, 240, 1440] as const;
export const MIN_TTL_MINUTES = 1;
export const MAX_TTL_MINUTES = 1440;

// A custom value: a whole number of minutes within 1..1440 (an empty field is not valid).
export function parseTtlMinutes(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const n = Number(text);
  return n >= MIN_TTL_MINUTES && n <= MAX_TTL_MINUTES ? n : null;
}
