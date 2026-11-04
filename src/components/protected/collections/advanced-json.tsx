"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SchemaTexts } from "@/components/protected/collections/definition-draft";

const DOCS = ["json_schema", "localized_schema", "ui_schema"] as const;

// The Advanced JSON tab: the three documents as text. Showing is always allowed; editing makes the raw text the source of truth (the builder
// then re-reads it and locks itself when it can not represent what was typed). Text is only ever parsed with JSON.parse and sent as data.
export function AdvancedJson({ texts, onChange, disabled }: { texts: SchemaTexts; onChange: (key: keyof SchemaTexts, value: string) => void; disabled: boolean }) {
  const t = useTranslations("collections.advanced");
  const tDoc = useTranslations("collections.documents");
  const base = useId();
  return (
    <div className="space-y-5" data-testid="advanced-json">
      <p className="text-sm leading-snug text-muted-foreground">{t("intro")}</p>
      {DOCS.map((key) => (
        <div key={key} className="space-y-1.5">
          <Label htmlFor={`${base}-${key}`}>{tDoc(key)}</Label>
          <Textarea
            id={`${base}-${key}`}
            data-testid={`json-${key}`}
            spellCheck={false}
            rows={key === "ui_schema" ? 8 : 14}
            className="font-mono text-xs leading-snug"
            value={texts[key]}
            disabled={disabled}
            onChange={(e) => onChange(key, e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t(`hint.${key}`)}</p>
        </div>
      ))}
    </div>
  );
}
