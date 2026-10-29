"use client";

import { Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { MediaPicker } from "@/components/protected/media/media-picker";
import { MediaThumb } from "@/components/protected/media/media-thumb";
import { Button } from "@/components/ui/button";
import { useMediaAssetDetail } from "@/hooks/use-media";

// A single picture of a post (hero, teaser, share image): the small tile of the chosen media row, its file name and alt text
// in the default language, choose / change / remove. The picker reads the media library (no upload in P1).
export function PostMediaField({
  id,
  mediaId,
  onChange,
  disabled,
  defaultLocale,
  pickerTitle,
  label,
  ratio,
}: {
  id: string;
  mediaId: number | null;
  onChange: (id: number | null) => void;
  disabled: boolean;
  defaultLocale: string;
  pickerTitle: string;
  // The name of the field, said by the buttons ("Change image: Cover image") so two pictures in a form are told apart.
  label: string;
  ratio?: string;
}) {
  const t = useTranslations("posts.media");
  const [open, setOpen] = useState(false);
  const detail = useMediaAssetDetail(mediaId ?? undefined, mediaId !== null);
  const asset = detail.data?.data.data;
  const missing = mediaId !== null && detail.isError;
  const alt = asset?.translations?.[defaultLocale]?.alt;

  return (
    <div className="flex flex-wrap items-center gap-3" data-testid={id}>
      <div className="size-16 shrink-0 overflow-hidden rounded-md border bg-muted">
        {mediaId !== null && asset ? <MediaThumb asset={asset} alt={alt || asset.original_filename} compact /> : <MediaThumb asset={{}} alt={t("none")} compact />}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5 text-sm">
        <p id={`${id}-value`} className="break-all font-medium">
          {mediaId === null ? t("none") : missing ? t("missing", { id: mediaId }) : (asset?.original_filename ?? `#${mediaId}`)}
        </p>
        {mediaId !== null && asset ? <p className="text-xs text-muted-foreground">{alt ? t("mediaAlt", { alt }) : t("mediaNoAlt")}</p> : null}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button id={id} type="button" variant="outline" size="sm" disabled={disabled} aria-label={`${mediaId === null ? t("choose") : t("change")}: ${label}`} onClick={() => setOpen(true)}>
          {mediaId === null ? t("choose") : t("change")}
        </Button>
        {mediaId !== null ? (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={`${t("remove")}: ${label}`} onClick={() => onChange(null)}>
            <Trash2Icon />
            {t("remove")}
          </Button>
        ) : null}
      </div>
      <MediaPicker
        open={open}
        onOpenChange={setOpen}
        mode="single"
        accept="image/*"
        ratio={ratio}
        selectedIds={mediaId !== null ? [mediaId] : []}
        title={pickerTitle}
        defaultLocale={defaultLocale}
        onSelect={([picked]) => {
          if (!picked) return;
          onChange(picked.id);
          setOpen(false);
        }}
      />
    </div>
  );
}
