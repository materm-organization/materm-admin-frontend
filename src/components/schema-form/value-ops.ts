import type { JsonSchema } from "@/types/cms";
import type { Locale } from "@/types/locales";

import type { FieldNode } from "./types";
import { isPlainObject, walkSchemaValue } from "./schema-walker";

// Small immutable edits on the values a widget owns. A cleared value is REMOVED (never stored as "" / null) so
// props stay sparse, `dirty` goes back to false when the user types and deletes again, and the backend never
// sees an empty string where it would count a translation.

// Sets (or, for blank text, removes) one locale of a locale map. An emptied map stays `{}` when the field is
// required (the shape of `default_props`), otherwise the property goes away (`undefined`).
export function setLocaleValue(
  map: unknown,
  locale: string,
  next: unknown,
  required: boolean
): Record<string, unknown> | undefined {
  const base = isPlainObject(map) ? map : {};
  const blank = next === undefined || next === null || (typeof next === "string" && next === "");
  if (blank) {
    if (!(locale in base)) return isPlainObject(map) ? (map as Record<string, unknown>) : required ? {} : undefined;
    const { [locale]: removed, ...rest } = base;
    void removed;
    return Object.keys(rest).length === 0 && !required ? undefined : rest;
  }
  return { ...base, [locale]: next };
}

// The text shown (greyed) when the selected locale has no value: what the portal would render through the
// fallback chain (locale.fallback_code -> ... -> default locale; doc/04 section 4.2).
export function fallbackValue(
  map: unknown,
  locale: string,
  locales: Pick<Locale, "code" | "fallback_code">[],
  defaultLocale: string
): { locale: string; value: unknown } | undefined {
  if (!isPlainObject(map)) return undefined;
  const seen = new Set<string>([locale]);
  let current: string | null | undefined = locales.find((l) => l.code === locale)?.fallback_code;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (hasContent(map[current])) return { locale: current, value: map[current] };
    current = locales.find((l) => l.code === current)?.fallback_code;
  }
  if (!seen.has(defaultLocale) && hasContent(map[defaultLocale])) {
    return { locale: defaultLocale, value: map[defaultLocale] };
  }
  return undefined;
}

export function hasContent(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== "";
  if (isPlainObject(value) && value.type === "doc") {
    const walk = (nodes: unknown): boolean =>
      Array.isArray(nodes) &&
      nodes.some((n) => {
        if (!isPlainObject(n)) return false;
        if (n.type === "text") return typeof n.text === "string" && n.text.trim() !== "";
        if (n.type === "image" || n.type === "embed") return true;
        return walk(n.content);
      });
    return walk(value.content);
  }
  return value !== undefined && value !== null;
}

export function codePointLength(text: string): number {
  let n = 0;
  for (const _ of text) {
    void _;
    n += 1;
  }
  return n;
}

// "open_in_new_tab" -> "Open in new tab"; "contact.phone" -> "Contact phone".
export function humanize(name: string): string {
  const spaced = name.replace(/[_.\-]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : name;
}

// The value of a NEW element of an array (doc/07 section 4.2: "an empty object of the item schema").
export function newItemValue(item: FieldNode): unknown {
  switch (item.kind) {
    case "array":
    case "enum-array":
      return [];
    case "object":
    case "image":
    case "link":
      return {};
    case "localized-text":
    case "richtext":
      return {};
    case "boolean":
      return false;
    default:
      return item.defaultValue;
  }
}

// Does an item carry text in a locale other than `locale`? Used to confirm removing an array item, which is
// shared by every locale (doc/07 section 4.4). Schema-guided: only real locale maps count.
export function hasTextInOtherLocales(root: JsonSchema, itemSchema: JsonSchema, value: unknown, locale: string): boolean {
  let found = false;
  walkSchemaValue(root, itemSchema, value, (visit) => {
    if (found || visit.schema["x-localized"] !== true || !isPlainObject(visit.value)) return;
    found = Object.entries(visit.value).some(([code, entry]) => code !== locale && hasContent(entry));
  });
  return found;
}
