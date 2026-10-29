"use client";

import { ImageIcon, ImagePlusIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { EditorLocaleSwitcher, type LocaleBadge } from "@/components/global/locale/editor-locale-switcher";
import { MediaPicker } from "@/components/protected/media/media-picker";
import { MediaThumb } from "@/components/protected/media/media-thumb";
import type { AlbumDraft, AlbumEditMode } from "@/components/protected/albums/album-draft";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_ALBUM_DESCRIPTION, MAX_ALBUM_TITLE, charCount } from "@/lib/albums";
import type { Locale } from "@/types/locales";
import type { AlbumDetail } from "@/types/albums";
import type { MediaAssetOption } from "@/types/cms";

export type AlbumFormProps = {
  album: AlbumDetail;
  draft: AlbumDraft;
  baseline: AlbumDraft;
  onChange: (next: AlbumDraft) => void;
  // Field key (`title.la`, `description.en`, `cover`) -> message.
  problems: Record<string, string>;
  locales: Locale[];
  defaultLocale: string;
  mode: AlbumEditMode;
};

// SCR-29 Details tab (doc/07 section 3.17): the title and the description in each language, the cover picture. The key is shown, not
// editable (it can not be changed after the album was created). `translate` edits the texts of the languages that already have a row;
// a new language row and the cover are `update` (05 13.4.2).
export function AlbumDetailsTab({ album, draft, baseline, onChange, problems, locales, defaultLocale, mode, locale, onLocaleChange }: AlbumFormProps & { locale: string; onLocaleChange: (code: string) => void }) {
  const t = useTranslations("albums.details");
  const [pickerOpen, setPickerOpen] = useState(false);
  const row = draft.translations[locale] ?? { title: "", description: "" };
  const baseRow = baseline.translations[locale] ?? { title: "", description: "" };
  const rowExists = baseRow.title.trim() !== "" || baseRow.description.trim() !== "";
  const textsEditable = mode === "full" || (mode === "translate" && rowExists);
  const localeName = locales.find((l) => l.code === locale)?.native_name ?? locale;
  const titleProblem = problems[`title.${locale}`];
  const descriptionProblem = problems[`description.${locale}`];

  const completeness = useMemo(() => {
    const out: Record<string, LocaleBadge> = {};
    for (const l of locales) {
      const missing = (draft.translations[l.code]?.title ?? "").trim() === "" ? 1 : 0;
      out[l.code] = { missing, total: 1, status: missing === 0 ? "complete" : "missing" };
    }
    return out;
  }, [draft, locales]);

  const set = (patch: Partial<{ title: string; description: string }>) => onChange({ ...draft, translations: { ...draft.translations, [locale]: { ...row, ...patch } } });
  const chooseCover = (assets: MediaAssetOption[]) => {
    const a = assets[0];
    if (!a) return;
    onChange({ ...draft, cover_media_id: a.id, cover: { id: a.id, status: a.status ?? "ready", original_filename: a.filename, mime_type: a.mime_type, width: a.width ?? null, height: a.height ?? null, url: a.url ?? null } });
    setPickerOpen(false);
  };

  return (
    <div className="space-y-6" data-testid="album-details">
      <div className="space-y-4">
        <EditorLocaleSwitcher locales={locales} value={locale} onChange={onLocaleChange} completeness={completeness} />
        {mode === "translate" && !rowExists ? <p className="text-sm text-muted-foreground" data-testid="album-new-language-note">{t("newLanguageNeedsUpdate", { language: localeName })}</p> : null}

        <div className="grid max-w-2xl gap-4">
          <div className="space-y-1.5">
            <Label htmlFor={`album-field-title-${locale}`}>{t("titleLabel", { language: localeName })}</Label>
            <Input
              id={`album-field-title-${locale}`}
              value={row.title}
              disabled={!textsEditable}
              autoComplete="off"
              aria-invalid={titleProblem ? true : undefined}
              onChange={(e) => set({ title: e.target.value })}
            />
            <p className="flex justify-between text-xs text-muted-foreground">
              <span role={titleProblem ? "alert" : undefined} className={titleProblem ? "text-destructive" : undefined}>{titleProblem ?? ""}</span>
              <span className="tabular-nums">{charCount(row.title)} / {MAX_ALBUM_TITLE}</span>
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`album-field-description-${locale}`}>{t("descriptionLabel", { language: localeName })}</Label>
            <Textarea
              id={`album-field-description-${locale}`}
              value={row.description}
              rows={4}
              disabled={!textsEditable}
              aria-invalid={descriptionProblem ? true : undefined}
              onChange={(e) => set({ description: e.target.value })}
            />
            <p className="flex justify-between text-xs text-muted-foreground">
              <span role={descriptionProblem ? "alert" : undefined} className={descriptionProblem ? "text-destructive" : undefined}>{descriptionProblem ?? ""}</span>
              <span className="tabular-nums">{charCount(row.description)} / {MAX_ALBUM_DESCRIPTION}</span>
            </p>
          </div>
        </div>
      </div>

      <section className="max-w-2xl space-y-2" aria-labelledby="album-cover-title">
        <h3 id="album-cover-title" className="text-sm font-semibold">{t("cover")}</h3>
        <div className="flex items-center gap-4" id="album-field-cover" tabIndex={-1}>
          <div className="size-24 shrink-0 overflow-hidden rounded-md border bg-muted">
            {draft.cover ? <MediaThumb asset={{ url: draft.cover.url, mime_type: draft.cover.mime_type }} alt={draft.cover.original_filename ?? ""} /> : <div className="flex h-full items-center justify-center text-muted-foreground"><ImageIcon className="size-6" aria-hidden /></div>}
          </div>
          <div className="space-y-2">
            <p className="text-sm">{draft.cover ? draft.cover.original_filename : t("noCover")}</p>
            {mode === "full" ? (
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                  <ImagePlusIcon />
                  {draft.cover ? t("changeCover") : t("chooseCover")}
                </Button>
                {draft.cover ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...draft, cover_media_id: null, cover: null })}>
                    <Trash2Icon />
                    {t("removeCover")}
                  </Button>
                ) : null}
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">{t("coverHint")}</p>
            {problems.cover ? <p role="alert" className="text-sm text-destructive">{problems.cover}</p> : null}
          </div>
        </div>
      </section>

      <dl className="grid max-w-2xl grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t("key")}</dt>
        <dd className="font-mono" data-testid="album-key">{album.key}</dd>
        <dt className="text-muted-foreground">{t("usage")}</dt>
        <dd>{album.usage_count > 0 ? t("usedIn", { count: album.usage_count }) : t("unused")}</dd>
      </dl>

      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        mode="single"
        max={1}
        accept="image/*"
        selectedIds={draft.cover_media_id ? [draft.cover_media_id] : []}
        title={t("coverPickerTitle")}
        description={t("coverPickerDescription")}
        defaultLocale={defaultLocale}
        onSelect={chooseCover}
      />
    </div>
  );
}
