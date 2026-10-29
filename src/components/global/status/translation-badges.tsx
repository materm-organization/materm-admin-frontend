"use client";

import { AlertTriangleIcon, CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

// `la ✓  en ⚠2` (doc/07 section 5.2): per active language, whether the texts of the entity are there. A page counts its title,
// SEO title and SEO description (section texts are counted in the editor); a post counts its title, excerpt and SEO title
// (`fields`). A language switched off shows "off".
export type TranslationFlags = { enabled: boolean } & Record<string, boolean>;

export function TranslationBadges({
  status,
  fields = ["title", "seo_title", "seo_description"],
  noun,
  className,
}: {
  status: Record<string, TranslationFlags>;
  fields?: readonly string[];
  // "post": the word in the tooltip of a language that is switched off ("switched off for this post"); default "page".
  noun?: string;
  className?: string;
}) {
  const t = useTranslations("status.translation");
  const entries = Object.entries(status);
  if (entries.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs", className)} aria-label={t("label")}>
      {entries.map(([code, s]) => {
        const missing = fields.filter((f) => !s[f]).length;
        const label = !s.enabled ? t("off", { locale: code, noun: noun ?? t("nounPage") }) : missing === 0 ? t("complete", { locale: code }) : t("missing", { locale: code, count: missing });
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
