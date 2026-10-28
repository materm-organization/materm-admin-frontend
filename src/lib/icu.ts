// ICU MessageFormat checks for UI strings (doc/05 section 11.4, BR-27 / FR-UIS-03; doc/07 section 3.21). The same
// rules run in the editor before a save and in the mock API (the server checks again and answers 422 with the
// field codes `icu_syntax`, `plural_other_missing`, `placeholder_mismatch`):
//   - the text parses as ICU MessageFormat;
//   - every plural / select has an `other` branch;
//   - the set of placeholder names equals the one of the source text of the same language.
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";

export type IcuIssue =
  | { code: "icu_syntax"; params: { message: string; offset: number } }
  | { code: "plural_other_missing"; params: { argument: string } };

export type IcuAnalysis = { ok: true; placeholders: string[] } | { ok: false; issue: IcuIssue };

function collect(elements: MessageFormatElement[], names: Set<string>) {
  for (const el of elements) {
    switch (el.type) {
      case TYPE.argument:
      case TYPE.number:
      case TYPE.date:
      case TYPE.time:
        names.add(el.value);
        break;
      case TYPE.select:
      case TYPE.plural:
        names.add(el.value);
        for (const option of Object.values(el.options)) collect(option.value, names);
        break;
      case TYPE.tag:
        // Rich-text tags (`<b>x</b>`): the tag name is a placeholder of its own; its children may contain more.
        names.add(el.value);
        collect(el.children, names);
        break;
      default:
        break;
    }
  }
}

// Parses `text`; on success the sorted list of placeholder names (a plural's `#` is not a placeholder).
export function analyzeIcu(text: string): IcuAnalysis {
  try {
    const ast = parse(text, { requiresOtherClause: true });
    const names = new Set<string>();
    collect(ast, names);
    return { ok: true, placeholders: [...names].sort() };
  } catch (error) {
    const e = error as { message?: string; location?: { start?: { offset?: number } } };
    const message = String(e.message ?? "");
    if (message === "MISSING_OTHER_CLAUSE") {
      return { ok: false, issue: { code: "plural_other_missing", params: { argument: firstPluralOrSelect(text) } } };
    }
    return { ok: false, issue: { code: "icu_syntax", params: { message, offset: e.location?.start?.offset ?? 0 } } };
  }
}

// The name of the first plural / select argument (to say which one lacks `other`); parsed without the `other` rule.
function firstPluralOrSelect(text: string): string {
  try {
    const ast = parse(text, { requiresOtherClause: false });
    const find = (elements: MessageFormatElement[]): string | undefined => {
      for (const el of elements) {
        if (el.type === TYPE.plural || el.type === TYPE.select) {
          if (!("other" in el.options)) return el.value;
          for (const option of Object.values(el.options)) {
            const inner = find(option.value);
            if (inner) return inner;
          }
        } else if (el.type === TYPE.tag) {
          const inner = find(el.children);
          if (inner) return inner;
        }
      }
      return undefined;
    };
    return find(ast) ?? "";
  } catch {
    return "";
  }
}

export type PlaceholderDiff = { expected: string[]; missing: string[]; unexpected: string[] };

// `null` when the sets are equal.
export function diffPlaceholders(expected: readonly string[], actual: readonly string[]): PlaceholderDiff | null {
  const missing = expected.filter((n) => !actual.includes(n));
  const unexpected = actual.filter((n) => !expected.includes(n));
  if (missing.length === 0 && unexpected.length === 0) return null;
  return { expected: [...expected], missing, unexpected };
}

export type IcuCheck =
  | { ok: true; placeholders: string[] }
  | { ok: false; code: "icu_syntax" | "plural_other_missing" | "placeholder_mismatch"; params: Record<string, string | number | string[]> };

// The full check of an edited value against the placeholders of its source (`null` = no source: skip the
// comparison, doc/05 11.4 `no_source`).
export function checkIcuValue(value: string, sourcePlaceholders: readonly string[] | null): IcuCheck {
  const result = analyzeIcu(value);
  if (!result.ok) return { ok: false, code: result.issue.code, params: result.issue.params };
  if (sourcePlaceholders) {
    const diff = diffPlaceholders(sourcePlaceholders, result.placeholders);
    if (diff) return { ok: false, code: "placeholder_mismatch", params: { ...diff } };
  }
  return { ok: true, placeholders: result.placeholders };
}
