"use client";

import { AlertTriangleIcon, CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { Locale } from "@/types/locales";
import type { PageDetail, SectionSummary } from "@/types/pages";

// How complete each active language is (doc/07 SCR-20 header: `la ✓  en ⚠3`): the page texts (title, SEO title, SEO
// description) plus every visible section. Section numbers come from the sections' own `translation_status`; the
// server decides what blocks a publish, this is the editor's picture of it.
export function PageCompleteness({ page, sections, locales }: { page: PageDetail; sections: SectionSummary[] | undefined; locales: Locale[] }) {
  const t = useTranslations("pages.editor.completeness");
  const visible = (sections ?? []).filter((s) => s.is_visible);
  return (
    <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("label")} data-testid="page-completeness">
      {locales.map((l) => {
        const status = page.translation_status[l.code];
        const pageParts = [status?.title, status?.seo_title, status?.seo_description];
        const pageMissing = pageParts.filter((ok) => !ok).length;
        const sectionsMissing = visible.filter((s) => (s.translation_status[l.code]?.missing ?? 0) > 0).length;
        const total = pageParts.length + visible.length;
        const missing = pageMissing + sectionsMissing;
        const percent = total === 0 ? 100 : Math.round(((total - missing) / total) * 100);
        const label = status && !status.enabled ? t("off") : missing === 0 ? t("complete") : t("missing", { count: missing, pageCount: pageMissing, sectionCount: sectionsMissing });
        return (
          <li key={l.code} className="space-y-1" aria-label={`${l.name}: ${label}`} title={`${l.name}: ${label}`}>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="font-mono font-medium uppercase">{l.code}</span>
              {missing === 0 ? <CheckIcon className="size-3.5 text-emerald-600" aria-hidden /> : <AlertTriangleIcon className="size-3.5 text-amber-600" aria-hidden />}
              <span className={cn("text-muted-foreground", missing > 0 && "text-amber-700 dark:text-amber-300")}>{label}</span>
            </div>
            <Progress value={percent} className="h-1.5" aria-label={t("progress", { locale: l.code.toUpperCase() })} />
          </li>
        );
      })}
    </ul>
  );
}
