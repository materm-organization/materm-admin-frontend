import { describe, expect, it } from "vitest";

import {
  dependentsOf,
  fallbackCandidates,
  fallbackProblem,
  formatDateExample,
  isValidDateTemplate,
} from "@/components/protected/locales/locale-rules";
import type { Locale } from "@/types/locales";

const loc = (code: string, extra: Partial<Locale> = {}): Locale => ({
  code,
  name: code,
  native_name: code,
  short_label: code.toUpperCase(),
  flag: null,
  text_direction: "ltr",
  is_default: false,
  is_active: true,
  fallback_code: null,
  search_config: "simple",
  date_formats: null,
  sort_order: 0,
  created_at: "",
  updated_at: "",
  etag: `"${code}"`,
  ...extra,
});

// la (default) <- en (fallback la) <- th (fallback en) ; zh (no fallback yet)
const LOCALES = [
  loc("la", { is_default: true }),
  loc("en", { fallback_code: "la" }),
  loc("th", { fallback_code: "en" }),
  loc("zh"),
];

describe("fallbackProblem", () => {
  it("a chain that ends at the default is fine", () => {
    expect(fallbackProblem(LOCALES, "zh", "la")).toBeNull();
    expect(fallbackProblem(LOCALES, "zh", "th")).toBeNull(); // zh -> th -> en -> la
  });
  it("itself, or a loop back to itself, is refused", () => {
    expect(fallbackProblem(LOCALES, "en", "en")).toBe("self");
    expect(fallbackProblem(LOCALES, "en", "th")).toBe("cycle"); // en -> th -> en
    expect(fallbackProblem(LOCALES, "la", "en")).toBe("cycle"); // the default must have none
  });
  it("a chain that does not reach the default is refused; an unknown code too", () => {
    expect(fallbackProblem(LOCALES, "en", "zh")).toBe("not_default");
    expect(fallbackProblem(LOCALES, "en", "xx")).toBe("unknown");
  });
});

describe("candidates, dependents, date templates", () => {
  it("offers only valid fallbacks", () => {
    expect(fallbackCandidates(LOCALES, "en").map((l) => l.code)).toEqual(["la"]);
    expect(fallbackCandidates(LOCALES, "zh").map((l) => l.code)).toEqual(["la", "en", "th"]);
  });
  it("finds who falls back to a locale", () => {
    expect(dependentsOf(LOCALES, "en").map((l) => l.code)).toEqual(["th"]);
    expect(dependentsOf(LOCALES, "th")).toEqual([]);
  });
  it("accepts {day}/{month}/{year} templates only", () => {
    expect(isValidDateTemplate("{month}. {day}.{year}")).toBe(true);
    expect(isValidDateTemplate("{day}")).toBe(true);
    expect(isValidDateTemplate("no placeholder")).toBe(false);
    expect(isValidDateTemplate("{day} {weekday}")).toBe(false);
    expect(isValidDateTemplate("")).toBe(false);
  });
  it("renders the live example", () => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    expect(formatDateExample("{month}. {day}.{year}", months)).toBe("Sep. 05.2026");
  });
});
