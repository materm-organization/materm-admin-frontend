import type { JsonSchema } from "@/types/cms";

import { joinPointer } from "./pointer";
import { isRichTextEmpty } from "./richtext-doc";
import { isPlainObject, walkSchemaValue } from "./schema-walker";

// Per-locale completeness of a section (doc/04 section 4.4, doc/07 section 4.4): the share of REQUIRED
// localized leaves that have a value, computed in the browser with the same walker as the publish pre-check.
// The server decides for real (FR-LOC-06); this drives the badges of the editor.
//   required leaf = an `x-localized` leaf in the `required` of its parent object (items of repeaters included)
//                   + the `alt` of every non-decorative image whose media row has no alt in that locale
//   empty         = "" / blank, or a rich-text doc without a non-blank text node

export type MissingLeaf = { path: string; kind: "text" | "richtext" | "alt" };

export type LocaleCompleteness = {
  locale: string;
  total: number;
  filled: number;
  missing: MissingLeaf[];
  // 0..100; a section without required leaves is 100.
  percent: number;
  // complete = nothing missing; missing = something required and nothing filled; partial = in between.
  status: "complete" | "partial" | "missing";
};

export type CompletenessOptions = {
  // Alt texts of the media rows used by the props. A media id the callback does not know is not counted
  // (its data may simply not be loaded yet).
  media?: (mediaId: number) => { alt?: Record<string, string> } | undefined;
};

type Leaf =
  | { kind: "text" | "richtext"; pointer: string; value: Record<string, unknown> | undefined }
  | { kind: "alt"; pointer: string; alt: Record<string, unknown> | undefined; mediaAlt: Record<string, string> | undefined };

function localeFilled(leaf: Leaf, locale: string): boolean {
  if (leaf.kind === "alt") {
    const own = leaf.alt?.[locale];
    if (typeof own === "string" && own.trim() !== "") return true;
    const fromMedia = leaf.mediaAlt?.[locale];
    return typeof fromMedia === "string" && fromMedia.trim() !== "";
  }
  const entry = leaf.value?.[locale];
  return leaf.kind === "richtext" ? !isRichTextEmpty(entry) : typeof entry === "string" && entry.trim() !== "";
}

export function computeCompleteness(
  schema: JsonSchema,
  props: unknown,
  localeCodes: string[],
  options: CompletenessOptions = {}
): Record<string, LocaleCompleteness> {
  const leaves: Leaf[] = [];
  walkSchemaValue(schema, schema, props, (visit) => {
    const { schema: node, value, pointer, defName } = visit;
    if (node["x-localized"] === true && visit.required) {
      leaves.push({
        kind: node["x-richtext"] ? "richtext" : "text",
        pointer,
        value: isPlainObject(value) ? value : undefined,
      });
    }
    if (defName === "image" && isPlainObject(value) && typeof value.media_id === "number" && value.decorative !== true) {
      const media = options.media?.(value.media_id);
      if (media) {
        leaves.push({
          kind: "alt",
          pointer: joinPointer(pointer, "alt"),
          alt: isPlainObject(value.alt) ? value.alt : undefined,
          mediaAlt: media.alt,
        });
      }
    }
  });

  const result: Record<string, LocaleCompleteness> = {};
  for (const locale of localeCodes) {
    const missing: MissingLeaf[] = [];
    for (const leaf of leaves) {
      if (!localeFilled(leaf, locale)) missing.push({ path: joinPointer(leaf.pointer, locale), kind: leaf.kind });
    }
    const total = leaves.length;
    const filled = total - missing.length;
    result[locale] = {
      locale,
      total,
      filled,
      missing,
      percent: total === 0 ? 100 : Math.round((filled / total) * 100),
      status: missing.length === 0 ? "complete" : filled === 0 ? "missing" : "partial",
    };
  }
  return result;
}

// Page level: the sum over several sections (hidden sections are the caller's to leave out).
export function sumCompleteness(parts: Array<Record<string, LocaleCompleteness>>): Record<string, LocaleCompleteness> {
  const out: Record<string, LocaleCompleteness> = {};
  for (const part of parts) {
    for (const [locale, entry] of Object.entries(part)) {
      const acc = out[locale] ?? { locale, total: 0, filled: 0, missing: [], percent: 100, status: "complete" as const };
      acc.total += entry.total;
      acc.filled += entry.filled;
      acc.missing = acc.missing.concat(entry.missing);
      out[locale] = acc;
    }
  }
  for (const entry of Object.values(out)) {
    entry.percent = entry.total === 0 ? 100 : Math.round((entry.filled / entry.total) * 100);
    entry.status = entry.missing.length === 0 ? "complete" : entry.filled === 0 ? "missing" : "partial";
  }
  return out;
}
