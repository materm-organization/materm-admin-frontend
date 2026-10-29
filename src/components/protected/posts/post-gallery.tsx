"use client";

import { arrayMove } from "@dnd-kit/sortable";
import { ImagePlusIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { SortableList } from "@/components/global/sortable-list";
import { MediaPicker } from "@/components/protected/media/media-picker";
import { MediaThumb } from "@/components/protected/media/media-thumb";
import type { GalleryRowDraft } from "@/components/protected/posts/post-draft";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_GALLERY_ALT, MAX_GALLERY_CAPTION, MAX_GALLERY_ITEMS } from "@/lib/posts";
import type { MediaAssetOption } from "@/types/cms";

let newRowCounter = 0;
const newKey = () => `new-${(newRowCounter += 1)}`;

// The gallery at the end of the article (doc/07 SCR-25, doc/05 13.3.7): up to 60 pictures, chosen from the media library,
// in the order they will show; each with its alt text and caption IN THE LANGUAGE chosen above (a picture without alt text
// in the default language blocks the publish unless the media row has one). Reordering and adding / removing are the owner's
// (`structure`); a translator edits the alt text and caption of the languages that are not the default one.
export function PostGallery({
  rows,
  onChange,
  locale,
  defaultLocale,
  structure,
  textsEditable,
  problems,
  localeName,
}: {
  rows: GalleryRowDraft[];
  onChange: (rows: GalleryRowDraft[]) => void;
  locale: string;
  defaultLocale: string;
  // May add, remove and reorder.
  structure: boolean;
  // May edit the alt text and caption in `locale`.
  textsEditable: boolean;
  // Field key -> message (`gallery`, `gallery.<key>.alt.<l>`).
  problems: Record<string, string>;
  localeName: string;
}) {
  const t = useTranslations("posts.gallery");
  const [pickerOpen, setPickerOpen] = useState(false);
  const room = MAX_GALLERY_ITEMS - rows.length;

  const add = (assets: MediaAssetOption[]) => {
    const added: GalleryRowDraft[] = assets.slice(0, Math.max(0, room)).map((a) => ({
      key: newKey(),
      id: null,
      media_id: a.id,
      media: { id: a.id, status: a.status ?? "ready", original_filename: a.filename, mime_type: a.mime_type, width: a.width ?? null, height: a.height ?? null, url: a.url ?? null },
      translations: {},
    }));
    onChange([...rows, ...added]);
    setPickerOpen(false);
  };
  const setText = (key: string, field: "alt" | "caption", value: string) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, translations: { ...r.translations, [locale]: { ...(r.translations[locale] ?? { alt: "", caption: "" }), [field]: value } } } : r)));

  return (
    <section className="space-y-3" aria-labelledby="post-gallery-title" data-testid="post-gallery">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="post-gallery-title" className="text-sm font-semibold">
            {t("title")}
          </h3>
          <p className="text-xs text-muted-foreground" id="post-field-gallery" tabIndex={-1}>
            {t("count", { count: rows.length, max: MAX_GALLERY_ITEMS })}
          </p>
        </div>
        {structure ? (
          <Button type="button" variant="outline" size="sm" disabled={room <= 0} onClick={() => setPickerOpen(true)}>
            <ImagePlusIcon />
            {t("add")}
          </Button>
        ) : null}
      </div>
      {problems.gallery ? <p role="alert" className="text-sm text-destructive">{t("tooMany", { max: MAX_GALLERY_ITEMS })}</p> : null}
      {structure && room <= 0 ? <p className="text-xs text-muted-foreground">{t("full", { max: MAX_GALLERY_ITEMS })}</p> : null}

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <SortableList
          ids={rows.map((r) => r.key)}
          disabled={!structure}
          itemLabel={(i) => t("itemLabel", { n: i + 1 })}
          onMove={(from, to) => onChange(arrayMove(rows, from, to))}
          renderItem={(key, { controls, index }) => {
            const row = rows.find((r) => r.key === key)!;
            const text = row.translations[locale] ?? { alt: "", caption: "" };
            const fallbackAlt = locale === defaultLocale ? "" : (row.translations[defaultLocale]?.alt ?? "");
            const altProblem = problems[`gallery.${row.key}.alt.${locale}`];
            const captionProblem = problems[`gallery.${row.key}.caption.${locale}`];
            return (
              <div
                id={`post-gallery-item-${row.key}`}
                tabIndex={-1}
                data-testid={`post-gallery-item-${row.key}`}
                className="flex flex-wrap items-start gap-3 rounded-md border bg-card p-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:flex-nowrap"
              >
                {controls}
                <div className="size-20 shrink-0 overflow-hidden rounded-md border bg-muted">
                  <MediaThumb asset={{ url: row.media.url, mime_type: row.media.mime_type }} alt={row.media.original_filename ?? `#${row.media_id}`} compact />
                </div>
                {structure ? (
                  <Button type="button" variant="ghost" size="icon" className="ms-auto size-8 shrink-0 sm:order-last" aria-label={t("remove", { n: index + 1 })} onClick={() => onChange(rows.filter((r) => r.key !== row.key))}>
                    <Trash2Icon />
                  </Button>
                ) : null}
                <div className="order-last grid min-w-0 basis-full items-start gap-x-4 gap-y-2 sm:order-none sm:flex-1 sm:basis-0 md:grid-cols-2">
                  <div className="space-y-1.5 md:col-span-2">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{index + 1}.</span> {row.media.original_filename ?? `#${row.media_id}`}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`post-gallery-alt-${row.key}`} className="text-xs">
                      {t("alt", { locale: localeName })}
                    </Label>
                    <Input
                      id={`post-gallery-alt-${row.key}`}
                      value={text.alt}
                      placeholder={fallbackAlt || t("altPlaceholder")}
                      disabled={!textsEditable}
                      aria-invalid={altProblem ? true : undefined}
                      onChange={(e) => setText(row.key, "alt", e.target.value)}
                    />
                    <p className="flex justify-between text-xs text-muted-foreground">
                      <span role={altProblem ? "alert" : undefined} className={altProblem ? "text-destructive" : undefined}>{altProblem ? t("tooLong") : ""}</span>
                      <span className="tabular-nums">{[...text.alt].length} / {MAX_GALLERY_ALT}</span>
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`post-gallery-caption-${row.key}`} className="text-xs">
                      {t("caption", { locale: localeName })}
                    </Label>
                    <Input
                      id={`post-gallery-caption-${row.key}`}
                      value={text.caption}
                      disabled={!textsEditable}
                      aria-invalid={captionProblem ? true : undefined}
                      onChange={(e) => setText(row.key, "caption", e.target.value)}
                    />
                    <p className="flex justify-between text-xs text-muted-foreground">
                      <span role={captionProblem ? "alert" : undefined} className={captionProblem ? "text-destructive" : undefined}>{captionProblem ? t("tooLong") : ""}</span>
                      <span className="tabular-nums">{[...text.caption].length} / {MAX_GALLERY_CAPTION}</span>
                    </p>
                  </div>
                </div>
              </div>
            );
          }}
        />
      )}

      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        mode="multiple"
        max={Math.max(1, room)}
        accept="image/*"
        selectedIds={[]}
        title={t("pickerTitle")}
        description={t("pickerDescription", { count: Math.max(0, room) })}
        defaultLocale={defaultLocale}
        onSelect={add}
      />
    </section>
  );
}
