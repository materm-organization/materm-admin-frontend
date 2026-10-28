"use client";

import { AlertTriangleIcon, CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import type { PageTranslationStatus } from "@/types/pages";

// `la ✓  en ⚠2` (doc/07 section 5.2): per active language, whether the page-level texts (title, SEO title, SEO
// description) are there. A language switched off for the page shows "off". Section texts are counted in the editor.
export function TranslationBadges({ status, className }: { status: Record<string, PageTranslationStatus>; className?: string }) {
  const t = useTranslations("status.translation");
  const entries = Object.entries(status);
  if (entries.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs", className)} aria-label={t("label")}>
      {entries.map(([code, s]) => {
        const missing = [s.title, s.seo_title, s.seo_description].filter((v) => !v).length;
        const label = !s.enabled ? t("off", { locale: code }) : missing === 0 ? t("complete", { locale: code }) : t("missing", { locale: code, count: missing });
        return (
          <li
            key={code}
            title={label}
            aria-label={label}
            className={cn("inline-flex items-center gap-1", !s.enabled ? "text-muted-foreground line-through" : missing > 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300")}
          >
            <span className="font-mono uppercase">{code}</span>
            {s.enabled && missing === 0 ? <CheckIcon className="size-3" aria-hidden /> : null}
            {s.enabled && missing > 0 ? (
              <>
                <AlertTriangleIcon className="size-3" aria-hidden />
                {missing}
              </>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
