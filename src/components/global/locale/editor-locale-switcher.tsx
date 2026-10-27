"use client";

import { AlertTriangleIcon, CheckIcon, MinusIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { Locale } from "@/types/locales";
import { useId } from "react";

// The editor-level language switch (doc/07 section 4.4): one button per ACTIVE language in `sort_order`, each
// with a completeness badge - check = complete, warning + n = n required fields missing, dash = nothing yet -
// plus a count of validation problems in that language. The default language is labelled. The optional
// "compare" switch asks every localized field to show the default language read-only above the edited one.
// State (the chosen code, `?locale=` in the URL) belongs to the page.

export type LocaleBadge = {
  // Required localized fields still empty in this language.
  missing: number;
  total: number;
  status: "complete" | "partial" | "missing";
};

export type EditorLocaleSwitcherProps = {
  locales: Array<Pick<Locale, "code" | "name" | "native_name" | "short_label" | "is_default" | "sort_order">>;
  value: string;
  onChange: (code: string) => void;
  completeness?: Record<string, LocaleBadge>;
  // Validation problems per language code.
  issueCounts?: Record<string, number>;
  compare?: boolean;
  onCompareChange?: (compare: boolean) => void;
  className?: string;
};

export function EditorLocaleSwitcher({
  locales,
  value,
  onChange,
  completeness,
  issueCounts,
  compare,
  onCompareChange,
  className,
}: EditorLocaleSwitcherProps) {
  const t = useTranslations("localeSwitcher");
  const compareId = useId();
  const sorted = [...locales].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)} data-slot="editor-locale-switcher">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={value}
        // A single-select group reports "" when the active one is pressed again: keep the language.
        onValueChange={(next) => next && onChange(next)}
        aria-label={t("label")}
        className="flex-wrap"
      >
        {sorted.map((locale) => {
          const badge = completeness?.[locale.code];
          const issues = issueCounts?.[locale.code] ?? 0;
          const status = badge?.status ?? "complete";
          const description =
            status === "complete"
              ? t("complete")
              : status === "missing"
                ? t("missing", { count: badge?.missing ?? 0 })
                : t("partial", { count: badge?.missing ?? 0 });
          return (
            <ToggleGroupItem
              key={locale.code}
              value={locale.code}
              aria-label={`${locale.name}${locale.is_default ? ` (${t("default")})` : ""}: ${description}${issues > 0 ? `, ${t("issues", { count: issues })}` : ""}`}
              className="h-9 gap-1.5 px-3"
            >
              <span>{locale.short_label || locale.code.toUpperCase()}</span>
              {locale.is_default && (
                <span className="text-[10px] font-normal uppercase text-muted-foreground" aria-hidden="true">
                  {t("default")}
                </span>
              )}
              {badge && (
                <span aria-hidden="true" className="inline-flex items-center gap-0.5 text-xs">
                  {status === "complete" ? (
                    <CheckIcon className="size-3.5 text-emerald-600" />
                  ) : status === "partial" ? (
                    <>
                      <AlertTriangleIcon className="size-3.5 text-amber-600" />
                      {badge.missing}
                    </>
                  ) : (
                    <MinusIcon className="size-3.5 text-muted-foreground" />
                  )}
                </span>
              )}
              {issues > 0 && (
                <Badge variant="destructive" aria-hidden="true" className="h-4 px-1.5 text-[10px]">
                  {issues}
                </Badge>
              )}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
      {onCompareChange && (
        <div className="flex items-center gap-2">
          <Switch id={compareId} checked={compare ?? false} onCheckedChange={onCompareChange} />
          <Label htmlFor={compareId} className="text-sm font-normal">
            {t("compare")}
          </Label>
        </div>
      )}
    </div>
  );
}
