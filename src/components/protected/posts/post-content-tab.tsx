"use client";

import { useTranslations } from "next-intl";

import { EditorLocaleSwitcher, type LocaleBadge } from "@/components/global/locale/editor-locale-switcher";
import { PostField } from "@/components/protected/posts/post-field";
import { textsEditable, shortLabel, type PostFormProps } from "@/components/protected/posts/post-form-props";
import { PostGallery } from "@/components/protected/posts/post-gallery";
import { PostMediaField } from "@/components/protected/posts/post-media-field";
import { emptyLocaleDraft, type PostLocaleDraft } from "@/components/protected/posts/post-draft";
import { SlugField } from "@/components/protected/posts/slug-field";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  LABEL_RECOMMENDED,
  MAX_EXCERPT,
  MAX_GALLERY_DESCRIPTION,
  MAX_GALLERY_HEADING,
  MAX_HERO_ALT,
  MAX_LABEL,
  MAX_LOCATION_LABEL,
  MAX_POST_TITLE,
  charCount,
  slugify,
} from "@/lib/posts";

// How complete a language is, for the language switch: the three texts a publish asks for (title, excerpt, SEO title).
export function localeCompleteness(draft: PostFormProps["draft"], locales: PostFormProps["locales"]): Record<string, LocaleBadge> {
  return Object.fromEntries(
    locales.map((l) => {
      const d = draft.translations[l.code];
      const filled = [d?.title, d?.excerpt, d?.seo_title].filter((v) => v && v.trim() !== "").length;
      return [l.code, { missing: 3 - filled, total: 3, status: filled === 3 ? ("complete" as const) : filled === 0 ? ("missing" as const) : ("partial" as const) }];
    })
  );
}

// The Content tab of SCR-25 (doc/07 section 3.15): per language the title, the slug (checked as it is typed), the excerpt, the
// label of the blog strip, the place line and the body in the rich text editor; then the hero and teaser pictures and the gallery
// at the end of the article. The language chosen at the top applies to every text here.
export function PostContentTab({
  post,
  draft,
  baseline,
  onChange,
  problems,
  locales,
  defaultLocale,
  mode,
  locale,
  onLocaleChange,
  onSlugStatus,
}: PostFormProps & { locale: string; onLocaleChange: (code: string) => void }) {
  const t = useTranslations("posts.content");
  const current = locales.some((l) => l.code === locale) ? locale : defaultLocale;
  const d = draft.translations[current];
  const base = baseline.translations[current] ?? emptyLocaleDraft();
  const fallback = draft.translations[defaultLocale];
  const isDefault = current === defaultLocale;
  const short = shortLabel(locales, current);
  const localeName = locales.find((l) => l.code === current)?.native_name ?? short;
  const texts = textsEditable(mode, current, defaultLocale);
  const structure = mode === "full";
  const problem = (key: string) => problems[key];
  const defaultBadge = isDefault ? <Badge variant="secondary">{t("default")}</Badge> : null;

  const setLocale = (patch: Partial<PostLocaleDraft>) => onChange({ ...draft, translations: { ...draft.translations, [current]: { ...d, ...patch } } });
  const setTitle = (title: string) => {
    // A language the post does not have yet: its slug follows the title until the slug is edited.
    if (!d.exists && d.slugAuto) setLocale({ title, slug: slugify(title) });
    else setLocale({ title });
  };

  if (!d) return null;
  return (
    <div className="space-y-8" data-testid="post-content">
      {locales.length > 1 ? (
        <EditorLocaleSwitcher locales={locales} value={current} onChange={onLocaleChange} completeness={localeCompleteness(draft, locales)} />
      ) : null}
      {mode === "translate" && isDefault ? (
        <p role="status" className="rounded-md border border-dashed p-3 text-sm text-muted-foreground" data-testid="translate-default-note">
          {t("translateDefaultNote")}
        </p>
      ) : null}

      <section className="space-y-4" aria-labelledby="post-texts">
        <h2 id="post-texts" className="text-sm font-semibold">
          {t("texts", { locale: localeName })}
        </h2>
        <div className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-2">
          <PostField
            id={`post-field-title-${current}`}
            label={t("title")}
            badge={defaultBadge}
            required={isDefault}
            wide
            counter={{ length: charCount(d.title), max: MAX_POST_TITLE }}
            error={problem(`title.${current}`)}
          >
            <Input
              id={`post-field-title-${current}`}
              value={d.title}
              placeholder={!isDefault ? fallback?.title : undefined}
              disabled={!texts}
              autoComplete="off"
              aria-invalid={problem(`title.${current}`) ? true : undefined}
              aria-describedby={problem(`title.${current}`) ? `post-field-title-${current}-error` : undefined}
              onChange={(e) => setTitle(e.target.value)}
            />
          </PostField>

          <SlugField
            id={`post-field-slug-${current}`}
            postId={post.id}
            locale={current}
            label={t("slug")}
            value={d.slug}
            stored={base.exists ? base.slug : ""}
            disabled={!texts}
            error={problem(`slug.${current}`)}
            wasPublished={Boolean(post.first_published_at)}
            onChange={(slug) => setLocale({ slug, slugAuto: false })}
            onStatus={onSlugStatus}
          />

          <PostField
            id={`post-field-label-${current}`}
            label={t("label")}
            counter={{ length: charCount(d.label), max: MAX_LABEL }}
            hint={t("labelHint", { recommended: LABEL_RECOMMENDED })}
            warning={charCount(d.label) > LABEL_RECOMMENDED && charCount(d.label) <= MAX_LABEL ? t("labelLong", { recommended: LABEL_RECOMMENDED }) : undefined}
            error={problem(`label.${current}`)}
          >
            <Input id={`post-field-label-${current}`} value={d.label} disabled={!texts} placeholder={!isDefault ? fallback?.label : undefined} aria-invalid={problem(`label.${current}`) ? true : undefined} onChange={(e) => setLocale({ label: e.target.value })} />
          </PostField>

          <PostField
            id={`post-field-location_label-${current}`}
            label={t("location")}
            counter={{ length: charCount(d.location_label), max: MAX_LOCATION_LABEL }}
            hint={t("locationHint")}
            error={problem(`location_label.${current}`)}
          >
            <Input id={`post-field-location_label-${current}`} value={d.location_label} disabled={!texts} placeholder={!isDefault ? fallback?.location_label : undefined} aria-invalid={problem(`location_label.${current}`) ? true : undefined} onChange={(e) => setLocale({ location_label: e.target.value })} />
          </PostField>

          <PostField
            id={`post-field-excerpt-${current}`}
            label={t("excerpt")}
            required={isDefault}
            wide
            counter={{ length: charCount(d.excerpt), max: MAX_EXCERPT }}
            hint={t("excerptHint")}
            error={problem(`excerpt.${current}`)}
          >
            <Textarea id={`post-field-excerpt-${current}`} rows={3} value={d.excerpt} disabled={!texts} placeholder={!isDefault ? fallback?.excerpt : undefined} aria-invalid={problem(`excerpt.${current}`) ? true : undefined} onChange={(e) => setLocale({ excerpt: e.target.value })} />
          </PostField>

          <PostField id={`post-field-body-${current}`} label={t("body")} wide hint={!isDefault ? t("bodyFallbackHint", { locale: shortLabel(locales, defaultLocale) }) : undefined} error={problem(`body.${current}`)}>
            <RichTextEditor
              key={current}
              id={`post-field-body-${current}`}
              profile="full"
              value={d.body}
              disabled={!texts}
              invalid={Boolean(problem(`body.${current}`))}
              aria-label={t("body")}
              onChange={(doc) => setLocale({ body: (doc as Record<string, unknown> | undefined) ?? null })}
            />
          </PostField>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="post-pictures">
        <h2 id="post-pictures" className="text-sm font-semibold">
          {t("pictures")}
        </h2>
        <div className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-2">
          <PostField id="post-field-hero_media_id" label={t("hero")} required hint={t("heroHint")}>
            <PostMediaField id="post-field-hero_media_id" mediaId={draft.hero_media_id} disabled={!structure} defaultLocale={defaultLocale} pickerTitle={t("heroPicker")} label={t("hero")} ratio="hero" onChange={(id) => onChange({ ...draft, hero_media_id: id })} />
          </PostField>
          <PostField
            id={`post-field-hero_alt-${current}`}
            label={t("heroAlt")}
            counter={{ length: charCount(d.hero_alt), max: MAX_HERO_ALT }}
            hint={t("heroAltHint")}
            error={problem(`hero_alt.${current}`)}
          >
            <Input id={`post-field-hero_alt-${current}`} value={d.hero_alt} disabled={!texts} placeholder={!isDefault ? fallback?.hero_alt : undefined} aria-invalid={problem(`hero_alt.${current}`) ? true : undefined} onChange={(e) => setLocale({ hero_alt: e.target.value })} />
          </PostField>
          <PostField id="post-field-teaser_media_id" label={t("teaser")} hint={t("teaserHint")}>
            <PostMediaField id="post-field-teaser_media_id" mediaId={draft.teaser_media_id} disabled={!structure} defaultLocale={defaultLocale} pickerTitle={t("teaserPicker")} label={t("teaser")} onChange={(id) => onChange({ ...draft, teaser_media_id: id })} />
          </PostField>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="post-gallery-texts">
        <h2 id="post-gallery-texts" className="text-sm font-semibold">
          {t("galleryTexts", { locale: localeName })}
        </h2>
        <div className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-2">
          <PostField
            id={`post-field-gallery_heading-${current}`}
            label={t("galleryHeading")}
            counter={{ length: charCount(d.gallery_heading), max: MAX_GALLERY_HEADING }}
            error={problem(`gallery_heading.${current}`)}
          >
            <Input id={`post-field-gallery_heading-${current}`} value={d.gallery_heading} disabled={!texts} placeholder={!isDefault ? fallback?.gallery_heading : undefined} aria-invalid={problem(`gallery_heading.${current}`) ? true : undefined} onChange={(e) => setLocale({ gallery_heading: e.target.value })} />
          </PostField>
          <PostField
            id={`post-field-gallery_description-${current}`}
            label={t("galleryDescription")}
            counter={{ length: charCount(d.gallery_description), max: MAX_GALLERY_DESCRIPTION }}
            error={problem(`gallery_description.${current}`)}
          >
            <Textarea id={`post-field-gallery_description-${current}`} rows={2} value={d.gallery_description} disabled={!texts} placeholder={!isDefault ? fallback?.gallery_description : undefined} aria-invalid={problem(`gallery_description.${current}`) ? true : undefined} onChange={(e) => setLocale({ gallery_description: e.target.value })} />
          </PostField>
        </div>
        <PostGallery
          rows={draft.gallery}
          onChange={(gallery) => onChange({ ...draft, gallery })}
          locale={current}
          defaultLocale={defaultLocale}
          structure={structure}
          textsEditable={texts}
          problems={problems}
          localeName={localeName}
        />
      </section>
    </div>
  );
}
