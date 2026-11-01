// Readable text for the error / warning codes of the redirects API (doc/05 14.2, 14.5). Pure: takes the translators.
// Unknown codes fall back to the generic `errors.fields.*` text, then to the server's message.
import { translateFieldError, type ErrorTranslator } from "@/lib/api-error-messages";
import type { ApiFieldError } from "@/types/api";
import type { RedirectCheckWarning } from "@/types/redirects";

type Values = Record<string, string | number>;

function valuesOf(params: Record<string, unknown> | undefined): Values {
  const out: Values = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (typeof v === "string" || typeof v === "number") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.join(" > ");
  }
  return out;
}

// `t` = the `redirects.fieldErrors` namespace, `tErrors` = `errors`.
export function redirectErrorText(t: ErrorTranslator, tErrors: ErrorTranslator, error: ApiFieldError): string {
  const params = error.params as Record<string, unknown> | undefined;
  if (error.code === "pattern_mismatch" && typeof params?.rule === "string" && t.has(`rules.${params.rule}`)) return t(`rules.${params.rule}`);
  const key = `codes.${error.code}`;
  if (t.has(key)) {
    try {
      return t(key, valuesOf(params));
    } catch {
      /* a placeholder is missing: use the generic text */
    }
  }
  return translateFieldError(tErrors, error);
}

// `t` = the `redirects.dialog.check.warnings` namespace.
export function redirectWarningText(t: ErrorTranslator, warning: RedirectCheckWarning): string {
  if (t.has(warning.code)) {
    try {
      return t(warning.code, valuesOf(warning.params));
    } catch {
      /* fall through */
    }
  }
  return warning.message ?? warning.code;
}
