"use client";

import { FilmIcon, ImageOffIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { MediaPicker } from "@/components/protected/media/media-picker";
import { MediaThumb } from "@/components/protected/media/media-thumb";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, formatDuration } from "@/lib/media";

import { useFieldLabel, useIssuesUnder, useSchemaFormContext } from "../context";
import { useMediaAsset } from "../data/provider";
import { isPlainObject } from "../schema-walker";
import type { FieldNode } from "../types";
import { GroupShell } from "./field-shell";

// An optional video placement `{media_id}` (schema: `x-ref: media_assets`, `x-media-kind: video`; the hero's background
// video). Absent = "No background video" + "Choose video". Chosen = the first-frame tile, file name, duration and size,
// "Change" and "Remove". Remove deletes the whole member (never `null` or `{}`), so a form that never had one is clean again.
// The picker lists and uploads MP4 only (`accept="video/mp4"`); it is not mounted unless the control is enabled.
export function MediaVideoField({
  node,
  pointer,
  value,
  onChange,
  editable,
}: {
  node: FieldNode;
  pointer: string;
  value: unknown;
  onChange: (next: unknown) => void;
  editable: boolean;
}) {
  const t = useTranslations("schemaForm.mediaVideo");
  const { defaultLocale } = useSchemaFormContext();
  const label = useFieldLabel(node);
  const issues = useIssuesUnder(pointer);
  const [pickerOpen, setPickerOpen] = useState(false);

  const video = isPlainObject(value) ? value : undefined;
  const mediaId = typeof video?.media_id === "number" ? video.media_id : undefined;
  const asset = useMediaAsset(mediaId);
  const invalid = issues.some((i) => i.path === `${pointer}/media_id`);
  const duration = formatDuration(asset.data?.duration_ms);
  const size = typeof asset.data?.bytes === "number" ? formatBytes(asset.data.bytes) : "";

  return (
    <GroupShell pointer={pointer} label={label} required={false} issues={issues}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative aspect-video w-full max-w-56 shrink-0 overflow-hidden rounded-md border bg-muted" data-slot="media-video-preview">
          {mediaId === undefined ? (
            <div className="flex h-full items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <FilmIcon className="size-4" aria-hidden />
              {t("none")}
            </div>
          ) : asset.isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : asset.data ? (
            <MediaThumb
              asset={{
                url: asset.data.url ?? asset.data.thumbnail_url,
                kind: asset.data.kind ?? "video",
                mime_type: asset.data.mime_type,
                duration_ms: asset.data.duration_ms,
              }}
              alt={asset.data.filename}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center text-xs text-destructive">
              <ImageOffIcon className="size-4" aria-hidden />
              {t("missing", { id: mediaId })}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          {asset.data && (
            <div className="text-sm">
              <p className="truncate" title={asset.data.filename} data-slot="video-filename">
                {asset.data.filename}
                {asset.data.status && asset.data.status !== "ready" && (
                  <span className="ml-2 text-xs text-destructive">{t("notReady", { status: asset.data.status })}</span>
                )}
              </p>
              {(duration || size) && (
                <p className="text-xs text-muted-foreground" data-slot="video-meta">
                  {[duration, size].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!editable}
              data-field-pointer={`${pointer}/media_id`}
              aria-invalid={invalid ? true : undefined}
              aria-label={mediaId === undefined ? t("choose") : t("changeLabel")}
              onClick={() => setPickerOpen(true)}
            >
              {mediaId === undefined ? t("choose") : t("change")}
            </Button>
            {mediaId !== undefined && (
              <Button type="button" variant="ghost" size="sm" disabled={!editable} aria-label={t("removeLabel")} onClick={() => onChange(undefined)}>
                {t("remove")}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t("help")}</p>
        </div>
      </div>
      {editable ? (
        <MediaPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          mode="single"
          accept="video/mp4"
          defaultLocale={defaultLocale}
          selectedIds={mediaId !== undefined ? [mediaId] : []}
          onSelect={([picked]) => {
            if (picked) onChange({ media_id: picked.id });
            setPickerOpen(false);
          }}
          title={t("pickerTitle")}
          description={t("pickerDescription")}
          searchLabel={t("search")}
        />
      ) : null}
    </GroupShell>
  );
}
