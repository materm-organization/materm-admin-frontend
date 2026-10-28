"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { SettingsEditor, type SettingsExtrasContext } from "@/components/protected/settings/settings-editor";
import { previewTitle, truncateForSerp } from "@/components/protected/settings/settings-draft";
import { useLocales } from "@/hooks/use-locales";
import { useSettingsGroup } from "@/hooks/use-settings";

// SCR-16 (doc/07 section 3.9): the `seo` group + read-only facts (robots depends on the environment, the sitemap
// address comes from `site.base_url`) + a search-result preview per language.
export function SeoPage() {
  const t = useTranslations("seo");
  // Unreadable group = page state, full width (see SettingsPage); otherwise the form keeps its reading width.
  const query = useSettingsGroup("seo");
  const unreadable = !!query.error && !query.data;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-wide">{t("title")}</h1>
        <p className="mt-1 text-base text-muted-foreground">{t("description")}</p>
      </div>
      <div className={unreadable ? undefined : "max-w-3xl"}>
        <SettingsEditor group="seo" extras={(ctx) => <SeoExtras {...ctx} />} />
      </div>
    </div>
  );
}

function SeoExtras({ draft, locale }: SettingsExtrasContext) {
  const t = useTranslations("seo");
  // `site.base_url` lives in another group (and needs `cms.settings:read`): show the sitemap link only when readable.
  const site = useSettingsGroup("site");
  const { data: localesData } = useLocales();
  const shortLocale = localesData?.data.find((l) => l.code === locale)?.short_label || locale.toUpperCase();
  const baseUrl = typeof site.data?.data.data.values.base_url === "string" ? site.data.data.data.values.base_url : null;
  const template = typeof draft.title_template === "string" ? draft.title_template : "";
  const siteName = typeof draft.site_name === "string" ? draft.site_name : "";
  const desc = draft.default_description && typeof draft.default_description === "object" ? (draft.default_description[locale] ?? "") : "";
  const title = previewTitle(template, t("serp.pageTitle")) ?? siteName;
  return (
    <div className="space-y-4">
      <section aria-labelledby="serp-heading" className="rounded-md border p-4">
        <h2 id="serp-heading" className="mb-2 text-sm font-semibold">{t("serp.title", { locale: shortLocale })}</h2>
        <div data-testid="serp-preview" className="space-y-0.5">
          <p className="text-xs text-muted-foreground">{baseUrl ?? "https://"}</p>
          <p className="text-lg text-blue-700 dark:text-blue-400">{title}</p>
          <p className="text-sm text-muted-foreground">{desc ? truncateForSerp(desc) : t("serp.noDescription")}</p>
        </div>
      </section>
      <section aria-labelledby="robots-heading" className="rounded-md border p-4 text-sm">
        <h2 id="robots-heading" className="mb-2 font-semibold">{t("robots.title")}</h2>
        <p className="text-muted-foreground">{t("robots.description")}</p>
        {baseUrl ? (
          <p className="mt-2 flex items-center gap-1">
            <span className="text-muted-foreground">{t("robots.sitemap")}:</span>
            <a className="inline-flex items-center gap-1 underline underline-offset-2" href={`${baseUrl}/sitemap.xml`} target="_blank" rel="noopener noreferrer">
              {baseUrl}/sitemap.xml <ExternalLinkIcon className="size-3" aria-hidden />
            </a>
          </p>
        ) : null}
      </section>
    </div>
  );
}
