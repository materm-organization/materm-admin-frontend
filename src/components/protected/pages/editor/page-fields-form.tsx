"use client";

import { ImageIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { EditorLocaleSwitcher } from "@/components/global/locale/editor-locale-switcher";
import { MediaPicker } from "@/components/protected/media/media-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useMediaAssetDetail } from "@/hooks/use-media";
import { usePageTemplates } from "@/hooks/use-pages";
import { useSettingsGroup } from "@/hooks/use-settings";
import { previewTitle, truncateForSerp } from "@/components/protected/settings/settings-draft";
import { cn } from "@/lib/utils";
import type { Locale } from "@/types/locales";
import type { PageDetail } from "@/types/pages";

import {
  MAX_NAME,
  SERP_DESCRIPTION,
  SERP_TITLE,
  pathChangesPublished,
  type PageFieldsDraft,
} from "./page-fields";
import { MAX_TITLE } from "@/components/protected/pages/page-draft";

export type PageFieldsFormProps = {
  page: PageDetail;
  draft: PageFieldsDraft;
  baseline: PageFieldsDraft;
  onChange: (next: PageFieldsDraft) => void;
  // Field key (`title.la`, `path` ...) -> the text to show under the field.
  problems: Record<string, string>;
  // Active languages and the default one.
  locales: Locale[];
  defaultLocale: string;
  // The page is in the trash.
  readOnly: boolean;
  // Rights: structure (pages:update), texts (update | translate), SEO-only fields (seo:update | pages:update), SEO texts.
  canStructure: boolean;
  canTexts: boolean;
  canSeoFlags: boolean;
  canSeoTexts: boolean;
};

function Field({ id, label, hint, error, counter, children }: { id: string; label: ReactNode; hint?: ReactNode; error?: string; counter?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {counter ? <span className="text-xs text-muted-foreground tabular-nums">{counter}</span> : null}
      </div>
      {children}
      {hint ? <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// The Details tab of SCR-20 (doc/07 section 3.12): the title in every active language, the internal name, the address
// (with the warning for a page that was published), the template (read-only while the page has sections), the order in
// the page list.
export function PageDetailsTab({ page, draft, baseline, onChange, problems, locales, defaultLocale, readOnly, canStructure, canTexts }: PageFieldsFormProps) {
  const t = useTranslations("pages.editor.details");
  const tPages = useTranslations("pages");
  const templates = usePageTemplates();
  const set = (patch: Partial<PageFieldsDraft>) => onChange({ ...draft, ...patch });
  const setLocale = (code: string, patch: Partial<PageFieldsDraft["translations"][string]>) =>
    onChange({ ...draft, translations: { ...draft.translations, [code]: { ...draft.translations[code], ...patch } } });
  const structure = canStructure && !readOnly;
  const texts = canTexts && !readOnly;
  const pathLocked = page.is_home || page.key === "blog";
  const problem = (key: string) => problems[key];
  const templateName = (key: string) => (tPages.has(`templates.${key}`) ? tPages(`templates.${key}`) : key);
  const templateEditable = structure && page.section_count === 0;

  return (
    <div className="max-w-3xl space-y-6" data-testid="page-details">
      <section className="space-y-4" aria-labelledby="page-titles">
        <h2 id="page-titles" className="text-sm font-semibold">{t("titles")}</h2>
        {locales.map((l) => {
          const d = draft.translations[l.code];
          if (!d) return null;
          const id = `page-field-title-${l.code}`;
          const isDefault = l.code === defaultLocale;
          return (
            <div key={l.code} className="space-y-2">
              <Field
                id={id}
                label={
                  <span className="inline-flex items-center gap-2">
                    {t("title", { locale: l.short_label || l.code.toUpperCase() })}
                    {isDefault ? <Badge variant="secondary" className="text-[10px]">{t("default")}</Badge> : null}
                  </span>
                }
                counter={`${[...d.title].length}/${MAX_TITLE}`}
                error={problem(`title.${l.code}`)}
                hint={isDefault ? undefined : t("titleOtherHint")}
              >
                <Input
                  id={id}
                  value={d.title}
                  disabled={!texts}
                  aria-invalid={problems[`title.${l.code}`] ? true : undefined}
                  aria-describedby={problems[`title.${l.code}`] ? `${id}-error` : undefined}
                  onChange={(e) => setLocale(l.code, { title: e.target.value })}
                />
              </Field>
              {!isDefault && d.exists ? (
                <div className="flex items-center gap-2">
                  <Switch id={`page-field-is_enabled-${l.code}`} checked={d.is_enabled} disabled={!structure} onCheckedChange={(on) => setLocale(l.code, { is_enabled: on })} />
                  <Label htmlFor={`page-field-is_enabled-${l.code}`} className="font-normal">{t("enabled", { locale: l.short_label || l.code.toUpperCase() })}</Label>
                </div>
              ) : null}
            </div>
          );
        })}
      </section>

      <section className="space-y-4" aria-labelledby="page-structure">
        <h2 id="page-structure" className="text-sm font-semibold">{t("structure")}</h2>
        <Field id="page-field-name" label={t("name")} hint={page.is_system ? t("nameSystem") : t("nameHint")} error={problem("name")} counter={`${[...draft.name].length}/${MAX_NAME}`}>
          <Input id="page-field-name" value={draft.name} disabled={!structure || page.is_system} aria-invalid={problems.name ? true : undefined} onChange={(e) => set({ name: e.target.value })} />
        </Field>

        <Field
          id="page-field-path"
          label={t("path")}
          hint={page.is_home ? t("pathHome") : page.key === "blog" ? t("pathLocked") : t("pathHint")}
          error={problem("path")}
        >
          <Input
            id="page-field-path"
            className="font-mono"
            value={draft.path}
            disabled={!structure || pathLocked}
            aria-invalid={problems.path ? true : undefined}
            aria-describedby={problems.path ? "page-field-path-error" : "page-field-path-hint"}
            onChange={(e) => set({ path: e.target.value })}
          />
        </Field>
        {pathChangesPublished(page, baseline.path, draft.path) ? (
          <Alert data-testid="path-changed-warning">
            <AlertDescription>{t("pathChangedPublished", { path: baseline.path })}</AlertDescription>
          </Alert>
        ) : null}

        <Field id="page-field-template" label={t("template")} hint={templateEditable ? t("templateEmptyHint") : t("templateLocked")}>
          {templateEditable ? (
            <Select value={draft.template} onValueChange={(v) => set({ template: v })}>
              <SelectTrigger id="page-field-template" className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(templates.data?.data ?? []).map((tpl) => (
                  <SelectItem key={tpl.key} value={tpl.key}>{templateName(tpl.key)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p id="page-field-template" className="text-sm font-medium">{templateName(draft.template)}</p>
          )}
        </Field>

        <Field id="page-field-sort_order" label={t("sortOrder")} hint={t("sortOrderHint")} error={problem("sort_order")}>
          <Input
            id="page-field-sort_order"
            inputMode="numeric"
            className="w-32"
            value={draft.sort_order}
            disabled={!structure}
            aria-invalid={problems.sort_order ? true : undefined}
            onChange={(e) => set({ sort_order: e.target.value })}
          />
        </Field>
        {page.is_home ? <Badge>{tPages("homeBadge")}</Badge> : null}
      </section>
    </div>
  );
}

function OgImage({ id, mediaId, disabled, onChange, defaultLocale }: { id: string; mediaId: number | null; disabled: boolean; onChange: (id: number | null) => void; defaultLocale: string }) {
  const t = useTranslations("pages.editor.seo");
  const [open, setOpen] = useState(false);
  const asset = useMediaAssetDetail(mediaId ?? undefined, mediaId !== null);
  const name = (asset.data?.data as { data?: { original_filename?: string } } | undefined)?.data?.original_filename;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
      <span id={`${id}-value`} className="min-w-0 break-all text-sm">{mediaId === null ? t("ogNone") : (name ?? `#${mediaId}`)}</span>
      <Button id={id} type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        {mediaId === null ? t("ogChoose") : t("ogChange")}
      </Button>
      {mediaId !== null ? (
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(null)}>
          <Trash2Icon />
          {t("ogRemove")}
        </Button>
      ) : null}
      <MediaPicker
        open={open}
        onOpenChange={setOpen}
        mode="single"
        accept="image/*"
        selectedIds={mediaId !== null ? [mediaId] : []}
        title={t("ogPickerTitle")}
        defaultLocale={defaultLocale}
        onSelect={([asset]) => {
          if (!asset) return;
          onChange(asset.id);
          setOpen(false);
        }}
      />
    </div>
  );
}

// The SEO tab of SCR-20 (doc/07 sections 3.9 and 3.12): robots / sitemap flags of the page and, per language, the search
// result texts, the share image and the canonical address, with a preview of the search result.
export function PageSeoTab({
  page,
  draft,
  onChange,
  problems,
  locales,
  defaultLocale,
  readOnly,
  canSeoFlags,
  canSeoTexts,
  locale,
  onLocaleChange,
}: PageFieldsFormProps & { locale: string; onLocaleChange: (code: string) => void }) {
  const t = useTranslations("pages.editor.seo");
  const seoSettings = useSettingsGroup("seo");
  const siteSettings = useSettingsGroup("site");
  const flags = canSeoFlags && !readOnly;
  const texts = canSeoTexts && !readOnly;
  const current = locales.some((l) => l.code === locale) ? locale : defaultLocale;
  const d = draft.translations[current];
  const set = (patch: Partial<PageFieldsDraft>) => onChange({ ...draft, ...patch });
  const setLocale = (patch: Partial<NonNullable<typeof d>>) => onChange({ ...draft, translations: { ...draft.translations, [current]: { ...d, ...patch } } });
  const problem = (key: string) => problems[key];

  const completeness = Object.fromEntries(
    locales.map((l) => {
      const x = draft.translations[l.code];
      const filled = [x?.seo_title, x?.seo_description].filter((v) => v && v.trim() !== "").length;
      return [l.code, { missing: 2 - filled, total: 2, status: filled === 2 ? ("complete" as const) : filled === 0 ? ("missing" as const) : ("partial" as const) }];
    })
  );

  const values = (seoSettings.data?.data.data.values ?? {}) as Record<string, unknown>;
  const baseUrl = typeof (siteSettings.data?.data.data.values as Record<string, unknown> | undefined)?.base_url === "string" ? String((siteSettings.data?.data.data.values as Record<string, unknown>).base_url) : "https://";
  const template = typeof values.title_template === "string" ? values.title_template : "";
  const pageTitle = d?.title.trim() || page.name;
  const rawTitle = d?.seo_title.trim() || pageTitle;
  const shownTitle = d?.seo_title_absolute ? rawTitle : (previewTitle(template, rawTitle) ?? rawTitle);
  const shortLocale = locales.find((l) => l.code === current)?.short_label || current.toUpperCase();
  const titleLen = [...(d?.seo_title ?? "")].length;
  const descLen = [...(d?.seo_description ?? "")].length;
  const noTitle = !d || d.title.trim() === "";

  return (
    <div className="max-w-3xl space-y-6" data-testid="page-seo">
      <section className="space-y-3" aria-labelledby="page-robots">
        <h2 id="page-robots" className="text-sm font-semibold">{t("flags")}</h2>
        <div className="flex items-start gap-2">
          <Switch id="page-field-noindex" checked={draft.noindex} disabled={!flags} onCheckedChange={(on) => set({ noindex: on })} />
          <div>
            <Label htmlFor="page-field-noindex" className="font-normal">{t("noindex")}</Label>
            <p className="text-xs text-muted-foreground">{t("noindexHint")}</p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Switch id="page-field-in_sitemap" checked={draft.in_sitemap} disabled={!flags} onCheckedChange={(on) => set({ in_sitemap: on })} />
          <div>
            <Label htmlFor="page-field-in_sitemap" className="font-normal">{t("inSitemap")}</Label>
            <p className="text-xs text-muted-foreground">{t("inSitemapHint")}</p>
          </div>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="page-seo-texts">
        <h2 id="page-seo-texts" className="text-sm font-semibold">{t("texts")}</h2>
        {locales.length > 1 ? <EditorLocaleSwitcher locales={locales} value={current} onChange={onLocaleChange} completeness={completeness} /> : null}
        {d ? (
          <div className="space-y-4">
            {noTitle ? <Alert><AlertDescription>{t("needsTitle", { locale: shortLocale })}</AlertDescription></Alert> : null}
            <Field
              id={`page-field-seo_title-${current}`}
              label={t("seoTitle", { locale: shortLocale })}
              hint={titleLen > SERP_TITLE ? <span className="text-amber-700 dark:text-amber-300">{t("titleLong", { recommended: SERP_TITLE })}</span> : t("seoTitleHint", { recommended: SERP_TITLE })}
              counter={`${titleLen}/${SERP_TITLE}`}
              error={problem(`seo_title.${current}`)}
            >
              <Input id={`page-field-seo_title-${current}`} value={d.seo_title} disabled={!texts || noTitle} aria-invalid={problems[`seo_title.${current}`] ? true : undefined} onChange={(e) => setLocale({ seo_title: e.target.value })} />
            </Field>
            <div className="flex items-center gap-2">
              <Switch id={`page-field-seo_title_absolute-${current}`} checked={d.seo_title_absolute} disabled={!flags || noTitle} onCheckedChange={(on) => setLocale({ seo_title_absolute: on })} />
              <Label htmlFor={`page-field-seo_title_absolute-${current}`} className="font-normal">{t("absolute")}</Label>
            </div>
            <Field
              id={`page-field-seo_description-${current}`}
              label={t("seoDescription", { locale: shortLocale })}
              hint={descLen > SERP_DESCRIPTION ? <span className="text-amber-700 dark:text-amber-300">{t("descriptionLong", { recommended: SERP_DESCRIPTION })}</span> : t("seoDescriptionHint", { recommended: SERP_DESCRIPTION })}
              counter={`${descLen}/${SERP_DESCRIPTION}`}
              error={problem(`seo_description.${current}`)}
            >
              <Textarea id={`page-field-seo_description-${current}`} rows={3} value={d.seo_description} disabled={!texts || noTitle} aria-invalid={problems[`seo_description.${current}`] ? true : undefined} onChange={(e) => setLocale({ seo_description: e.target.value })} />
            </Field>
            <Field id={`page-field-og_image_id-${current}`} label={t("ogImage", { locale: shortLocale })} hint={t("ogImageHint")}>
              <OgImage id={`page-field-og_image_id-${current}`} mediaId={d.og_image_id} disabled={!flags || noTitle} onChange={(id) => setLocale({ og_image_id: id })} defaultLocale={defaultLocale} />
            </Field>
            <Field id={`page-field-canonical_path-${current}`} label={t("canonical", { locale: shortLocale })} hint={t("canonicalHint")} error={problem(`canonical_path.${current}`)}>
              <Input id={`page-field-canonical_path-${current}`} className="font-mono" value={d.canonical_path} disabled={!flags || noTitle} aria-invalid={problems[`canonical_path.${current}`] ? true : undefined} onChange={(e) => setLocale({ canonical_path: e.target.value })} />
            </Field>

            <div className={cn("rounded-md border p-4")} data-testid="serp-preview">
              <h3 className="mb-2 text-sm font-semibold">{t("serp", { locale: shortLocale })}</h3>
              <p className="break-all text-xs text-muted-foreground">{`${baseUrl}${draft.path === "/" ? "" : draft.path}`}</p>
              <p className="break-words text-lg text-blue-700 dark:text-blue-400">{shownTitle}</p>
              <p className="break-words text-sm text-muted-foreground">{d.seo_description.trim() ? truncateForSerp(d.seo_description.trim()) : t("serpNoDescription")}</p>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
