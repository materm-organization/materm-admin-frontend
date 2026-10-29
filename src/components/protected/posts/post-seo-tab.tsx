"use client";

import { useTranslations } from "next-intl";

import { EditorLocaleSwitcher } from "@/components/global/locale/editor-locale-switcher";
import { localeCompleteness } from "@/components/protected/posts/post-content-tab";
import { emptyLocaleDraft } from "@/components/protected/posts/post-draft";
import { PostField } from "@/components/protected/posts/post-field";
import { shortLabel, textsEditable, type PostFormProps } from "@/components/protected/posts/post-form-props";
import { PostMediaField } from "@/components/protected/posts/post-media-field";
import { previewTitle, truncateForSerp } from "@/components/protected/settings/settings-draft";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSettingsGroup } from "@/hooks/use-settings";
import { MAX_SEO_DESCRIPTION, MAX_SEO_TITLE, SERP_DESCRIPTION, SERP_TITLE, charCount } from "@/lib/posts";

// The SEO tab of SCR-25 (doc/07 sections 3.9 and 3.15): per language the search result title and description, the share image,
// and a preview of the result. Posts have no robots / sitemap switches of their own (the contract has none); the rights are the
// post's (`cms.blog`), not `cms.seo`.
export function PostSeoTab({
  post,
  draft,
  onChange,
  problems,
  locales,
  defaultLocale,
  mode,
  locale,
  onLocaleChange,
}: PostFormProps & { locale: string; onLocaleChange: (code: string) => void }) {
  const t = useTranslations("posts.seo");
  const seoSettings = useSettingsGroup("seo");
  const siteSettings = useSettingsGroup("site");
  const current = locales.some((l) => l.code === locale) ? locale : defaultLocale;
  const d = draft.translations[current] ?? emptyLocaleDraft();
  const texts = textsEditable(mode, current, defaultLocale);
  const full = mode === "full";
  const short = shortLabel(locales, current);
  const problem = (key: string) => problems[key];
  const setLocale = (patch: Partial<typeof d>) => onChange({ ...draft, translations: { ...draft.translations, [current]: { ...d, ...patch } } });

  const values = (seoSettings.data?.data.data.values ?? {}) as Record<string, unknown>;
  const siteValues = (siteSettings.data?.data.data.values ?? {}) as Record<string, unknown>;
  const baseUrl = typeof siteValues.base_url === "string" ? siteValues.base_url.replace(/\/$/, "") : "https://";
  const template = typeof values.title_template === "string" ? values.title_template : "";
  const rawTitle = d.seo_title.trim() || d.title.trim();
  const shownTitle = previewTitle(template, rawTitle) ?? rawTitle;
  const titleLen = charCount(d.seo_title);
  const descLen = charCount(d.seo_description);
  // The default language is the one a publish asks for: say so when another language is on screen and its SEO title is empty.
  const defaultShort = shortLabel(locales, defaultLocale);
  const defaultSeoMissing = current !== defaultLocale && (draft.translations[defaultLocale]?.seo_title ?? "").trim() === "";
  const noTitle = d.title.trim() === "";
  const slug = d.slug.trim() || post.translations[current]?.slug || "";

  return (
    <div className="space-y-6" data-testid="post-seo">
      {locales.length > 1 ? <EditorLocaleSwitcher locales={locales} value={current} onChange={onLocaleChange} completeness={localeCompleteness(draft, locales)} /> : null}
      {defaultSeoMissing ? (
        <Alert data-testid="seo-default-missing">
          <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>{t("defaultMissing", { locale: defaultShort })}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => onLocaleChange(defaultLocale)}>
              {t("showDefault", { locale: defaultShort })}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {noTitle ? (
        <Alert>
          <AlertDescription>{t("needsTitle", { locale: short })}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-2">
        <PostField
          id={`post-field-seo_title-${current}`}
          label={t("seoTitle", { locale: short })}
          required={current === defaultLocale}
          counter={{ length: titleLen, max: MAX_SEO_TITLE }}
          hint={t("seoTitleHint", { recommended: SERP_TITLE })}
          warning={titleLen > SERP_TITLE && titleLen <= MAX_SEO_TITLE ? t("titleLong", { recommended: SERP_TITLE }) : undefined}
          error={problem(`seo_title.${current}`)}
        >
          <Input id={`post-field-seo_title-${current}`} value={d.seo_title} disabled={!texts || noTitle} placeholder={current !== defaultLocale ? draft.translations[defaultLocale]?.seo_title : undefined} aria-invalid={problem(`seo_title.${current}`) ? true : undefined} onChange={(e) => setLocale({ seo_title: e.target.value })} />
        </PostField>
        <PostField id={`post-field-og_image_id-${current}`} label={t("ogImage", { locale: short })} hint={t("ogImageHint")}>
          <PostMediaField id={`post-field-og_image_id-${current}`} mediaId={d.og_image_id} disabled={!full || noTitle} defaultLocale={defaultLocale} pickerTitle={t("ogPickerTitle")} label={t("ogImage", { locale: short })} onChange={(og_image_id) => setLocale({ og_image_id })} />
        </PostField>
        <PostField
          id={`post-field-seo_description-${current}`}
          label={t("seoDescription", { locale: short })}
          wide
          counter={{ length: descLen, max: MAX_SEO_DESCRIPTION }}
          hint={t("seoDescriptionHint", { recommended: SERP_DESCRIPTION })}
          warning={descLen > SERP_DESCRIPTION && descLen <= MAX_SEO_DESCRIPTION ? t("descriptionLong", { recommended: SERP_DESCRIPTION }) : undefined}
          error={problem(`seo_description.${current}`)}
        >
          <Textarea id={`post-field-seo_description-${current}`} rows={3} value={d.seo_description} disabled={!texts || noTitle} placeholder={current !== defaultLocale ? draft.translations[defaultLocale]?.seo_description : undefined} aria-invalid={problem(`seo_description.${current}`) ? true : undefined} onChange={(e) => setLocale({ seo_description: e.target.value })} />
        </PostField>
      </div>

      <div className="rounded-md border p-4" data-testid="serp-preview">
        <h3 className="mb-2 text-sm font-semibold">{t("serp", { locale: short })}</h3>
        <p className="break-all text-xs text-muted-foreground">{`${baseUrl}/blog/${slug}`}</p>
        <p className="break-words text-lg text-blue-700 dark:text-blue-400">{shownTitle || t("serpNoTitle")}</p>
        <p className="break-words text-sm text-muted-foreground">{d.seo_description.trim() ? truncateForSerp(d.seo_description.trim()) : t("serpNoDescription")}</p>
      </div>
    </div>
  );
}
