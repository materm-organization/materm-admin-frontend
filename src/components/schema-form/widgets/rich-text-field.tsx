"use client";

import { CopyIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { useFieldLabel, useIssuesAt, useIssuesUnder, useSchemaFormContext } from "../context";
import { isRichTextEmpty, richTextPlainText } from "../richtext-doc";
import { isPlainObject } from "../schema-walker";
import type { FieldNode } from "../types";
import { setLocaleValue } from "../value-ops";
import { FieldShell } from "./field-shell";

// `x-localized` + `x-richtext`: one editor for the chosen language (doc/07 section 4.2), stored as the Tiptap
// document JSON. The editor is re-created when the language changes (its content is per language).
export function RichTextField({
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
  const { locale, defaultLocale, compare } = useSchemaFormContext();
  const label = useFieldLabel(node);
  // The map itself, and anything inside the chosen language's document (a link href, ...).
  const own = useIssuesAt([pointer]);
  const inLocale = useIssuesUnder(`${pointer}/${locale}`);
  const issues = [...own, ...inLocale];
  const map = isPlainObject(value) ? value : undefined;
  const doc = map?.[locale];
  const defaultDoc = map?.[defaultLocale];
  const missing = isRichTextEmpty(doc);

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
        editable && missing && locale !== defaultLocale && !isRichTextEmpty(defaultDoc) ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => onChange(setLocaleValue(map, locale, defaultDoc, node.required))}
          >
            <CopyIcon className="size-3.5" />
            {t("copyFromDefault", { language: defaultLocale.toUpperCase() })}
          </Button>
        ) : null
      }
    >
      {(a11y) => (
        <>
          {compare && locale !== defaultLocale && (
            <p className="whitespace-pre-line rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground" data-slot="compare-default">
              <span className="mr-1 text-xs font-medium uppercase">{defaultLocale}</span>
              {richTextPlainText(defaultDoc) || t("compareEmpty")}
            </p>
          )}
          <RichTextEditor
            key={`${pointer}:${locale}`}
            id={a11y.id}
            aria-label={label}
            aria-describedby={a11y["aria-describedby"]}
            data-field-pointer={a11y["data-field-pointer"]}
            profile={node.richtextProfile ?? "lite"}
            value={doc}
            disabled={!editable}
            invalid={issues.length > 0}
            maxNodes={(node.richtextProfile ?? "lite") === "lite" ? 50 : undefined}
            onChange={(next) => onChange(setLocaleValue(map, locale, next, node.required))}
          />
        </>
      )}
    </FieldShell>
  );
}
