// Client mirror of the PATCH /locales/{code} rules (doc/05 section 10.7; FR-LOC-03/04/09). The server decides —
// these checks only save a round trip and keep the pickers honest.
import type { Locale } from "@/types/locales";

export type FallbackProblem = "self" | "cycle" | "not_default" | "unknown";

// Would `code` get a valid fallback chain if its fallback were `candidate`? The chain must not loop back to
// `code` (or loop at all) and must END AT THE DEFAULT locale (BR-04). `null` = fine.
export function fallbackProblem(locales: readonly Locale[], code: string, candidate: string): FallbackProblem | null {
  if (candidate === code) return "self";
  const byCode = new Map(locales.map((l) => [l.code, l]));
  const seen = new Set<string>([code]);
  let current: string | null = candidate;
  while (current !== null) {
    if (current === code || seen.has(current)) return "cycle";
    seen.add(current);
    const locale = byCode.get(current);
    if (!locale) return "unknown";
    if (locale.is_default) return null;
    current = locale.fallback_code;
  }
  return "not_default";
}

// Locales `code` may use as its fallback (never itself, never one that would break the chain).
export function fallbackCandidates(locales: readonly Locale[], code: string): Locale[] {
  return locales.filter((l) => l.code !== code && fallbackProblem(locales, code, l.code) === null);
}

// Locales whose fallback is `code` — deactivating `code` is allowed but changes how those resolve.
export function dependentsOf(locales: readonly Locale[], code: string): Locale[] {
  return locales.filter((l) => l.fallback_code === code);
}

const PLACEHOLDER = /\{([^{}]*)\}/g;
const ALLOWED = new Set(["day", "month", "year"]);

// A date template needs at least one of {day} {month} {year} and no other {placeholder} (server: pattern_mismatch).
export function isValidDateTemplate(template: string): boolean {
  const names = Array.from(template.matchAll(PLACEHOLDER), (m) => m[1]);
  return names.length > 0 && names.every((n) => ALLOWED.has(n));
}

// Live example: `{month}. {day}.{year}` for 2026-09-05 -> "Sep. 05.2026".
export function formatDateExample(template: string, months: readonly string[], date = new Date(Date.UTC(2026, 8, 5))): string {
  return template
    .replace(/\{day\}/g, String(date.getUTCDate()).padStart(2, "0"))
    .replace(/\{month\}/g, months[date.getUTCMonth()] ?? "")
    .replace(/\{year\}/g, String(date.getUTCFullYear()));
}
