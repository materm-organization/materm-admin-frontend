"use client";

import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import type { JsonSchema } from "@/types/cms";
import type { Locale } from "@/types/locales";

import type { ErrorTranslator } from "@/lib/api-error-messages";

import { isDescendantOrSelf } from "./pointer";
import { humanize } from "./value-ops";
import type { FieldNode, Issue, ValidationMode } from "./types";

// Form-wide state the widgets read. The VALUE is not here (it flows as props so memoised branches skip
// renders); this is the language, the issues, the permissions and the lookups.
export type SchemaFormContextValue = {
  formId: string;
  typeKey: string;
  rootSchema: JsonSchema;
  mode: ValidationMode;
  locale: string;
  defaultLocale: string;
  locales: Locale[];
  compare: boolean;
  // Whole form read-only (no permission, or a preview).
  disabled: boolean;
  // Translator mode: only localized text / rich text can be edited (doc/07 section 2.5.9).
  translateOnly: boolean;
  issues: Map<string, Issue[]>;
  rootValue: unknown;
  setAt: (pointer: string, value: unknown) => void;
  // Increments to ask array items on the way to `pointer` to open (focus / first error).
  reveal: { pointer: string; token: number } | null;
  translateIssue: (issue: Issue) => string;
};

const Context = createContext<SchemaFormContextValue | null>(null);

export function SchemaFormContextProvider({ value, children }: { value: SchemaFormContextValue; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSchemaFormContext(): SchemaFormContextValue {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("Schema form widgets must be rendered inside <SchemaForm>");
  return ctx;
}

export function fieldDomId(formId: string, pointer: string): string {
  return `${formId}-${pointer.replace(/[^A-Za-z0-9]+/g, "_") || "root"}`;
}

// Issues at exactly `pointer` plus, optionally, at the given child pointers (e.g. `/title` and `/title/la`).
export function useIssuesAt(pointers: string[]): Issue[] {
  const { issues } = useSchemaFormContext();
  const key = pointers.join("\u0000");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => pointers.flatMap((p) => issues.get(p) ?? []), [issues, key]);
}

// Every issue at or below `pointer` (a composite widget: count for a collapsed item, a hidden section).
export function useIssuesUnder(pointer: string): Issue[] {
  const { issues } = useSchemaFormContext();
  return useMemo(() => {
    const out: Issue[] = [];
    for (const [path, list] of issues) if (isDescendantOrSelf(path, pointer)) out.push(...list);
    return out;
  }, [issues, pointer]);
}

// Label of a field: `sectionEditor.types.<key>.fields.<path>` (path without array positions) when the message
// files have it, otherwise the schema's `title` (English, doc/07 section 4.2), otherwise the property name.
export function useFieldLabel(node: FieldNode): string {
  const { typeKey } = useSchemaFormContext();
  const t = useTranslations("sectionEditor");
  const dotted = node.schemaPointer
    .split("/")
    .filter((s) => s && s !== "*")
    .join(".");
  const key = `types.${typeKey}.fields.${dotted}`;
  if (dotted && t.has(key)) return t(key);
  return node.title ?? humanize(node.name === "*" ? "item" : node.name);
}

// Message of an issue: the server's own text is a fallback; the code decides (doc/07 section 4.6).
export function useIssueTranslator(): (issue: Issue) => string {
  const tErrors = useTranslations("errors");
  const tForm = useTranslations("schemaForm");
  return useCallback(
    (issue: Issue) => {
      const key = `issues.${issue.code}`;
      const params = (issue.params ?? {}) as Record<string, string | number>;
      const flat: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(params)) {
        flat[k] = Array.isArray(v) ? (v as string[]).join(", ") : (v as string | number);
      }
      if (tForm.has(key)) {
        try {
          return tForm(key, flat);
        } catch {
          /* a parameter the server did not send: fall through */
        }
      }
      const fieldKey = `fields.${issue.code}`;
      if ((tErrors as unknown as ErrorTranslator).has(fieldKey)) {
        try {
          return tErrors(fieldKey, flat);
        } catch {
          /* fall through */
        }
      }
      return issue.message || tForm("issues.invalid_value");
    },
    [tErrors, tForm]
  );
}
