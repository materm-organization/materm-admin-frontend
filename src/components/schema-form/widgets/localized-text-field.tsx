"use client";

import { CopyIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { useFieldLabel, useIssuesAt, useSchemaFormContext } from "../context";
import { isPlainObject } from "../schema-walker";
import type { FieldNode } from "../types";
import { codePointLength, fallbackValue, hasContent, setLocaleValue } from "../value-ops";
import { FieldShell } from "./field-shell";

// `x-localized` text: shows the value of the language chosen in the EditorLocaleSwitcher (doc/07 section 4.2,
// 4.4). The other languages stay untouched in the map. Empty selected language = "Not translated" badge, the
// fallback text greyed in as placeholder, and (for another language than the default) a copy-from-default
// action. `x-multiline` / `ui:widget: textarea` use a textarea; line breaks are kept.
export function LocalizedTextField({
  node,
  pointer,
  value,
  onChange,
  editable,
}: {
  node: FieldNode;
  pointer: string;
  value: unknown;
  onChange: (next: unknown) => void;
  editable: boolean;
}) {
  const t = useTranslations("schemaForm");
  const { locale, defaultLocale, locales, compare } = useSchemaFormContext();
  const label = useFieldLabel(node);
  const issues = useIssuesAt([pointer, `${pointer}/${locale}`]);
  const map = isPlainObject(value) ? value : undefined;
  const current = typeof map?.[locale] === "string" ? (map[locale] as string) : "";
  const defaultText = typeof map?.[defaultLocale] === "string" ? (map[defaultLocale] as string) : "";
  const fallback = fallbackValue(map, locale, locales, defaultLocale);
  const placeholder = !current && typeof fallback?.value === "string" ? fallback.value : undefined;
  const missing = current.trim() === "";
  const multiline = node.multiline || node.textarea;
  const length = codePointLength(current);
  const tooLong = node.maxLength !== undefined && length > node.maxLength;

  const set = (text: string) => onChange(setLocaleValue(map, locale, text, node.required));

  return (
    <FieldShell
      pointer={pointer}
      label={label}
      required={node.required}
      description={node.description}
      issues={issues}
      suffix={`_${locale}`}
      badges={
        missing && locale !== defaultLocale ? (
          <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
            {t("notTranslated")}
          </Badge>
        ) : null
      }
      actions={
        editable && missing && locale !== defaultLocale && hasContent(defaultText) ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => set(defaultText)}>
            <CopyIcon className="size-3.5" />
            {t("copyFromDefault", { language: defaultLocale.toUpperCase() })}
          </Button>
        ) : null
      }
    >
      {(a11y) => (
        <>
          {compare && locale !== defaultLocale && (
            <p
              className="whitespace-pre-line rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground"
              data-slot="compare-default"
            >
              <span className="mr-1 text-xs font-medium uppercase">{defaultLocale}</span>
              {defaultText || t("compareEmpty")}
            </p>
          )}
          {multiline ? (
            <Textarea
              {...a11y}
              lang={locale}
              rows={node.options.rows ?? 3}
              value={current}
              placeholder={placeholder}
              disabled={!editable}
              onChange={(e) => set(e.target.value)}
            />
          ) : (
            <Input
              {...a11y}
              lang={locale}
              value={current}
              placeholder={placeholder}
              disabled={!editable}
              onChange={(e) => set(e.target.value)}
            />
          )}
          {node.maxLength !== undefined && (
            <p className={cn("text-right text-xs text-muted-foreground", tooLong && "text-destructive")}>
              {length}/{node.maxLength}
            </p>
          )}
        </>
      )}
    </FieldShell>
  );
}
