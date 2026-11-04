"use client";

import { ImageIcon, ImageOffIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { MediaPicker, cssRatio } from "@/components/protected/media/media-picker";
import { MediaThumb } from "@/components/protected/media/media-thumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { MediaAssetOption } from "@/types/cms";

import { useIssuesUnder, useFieldLabel, useSchemaFormContext } from "../context";
import { useMediaAsset } from "../data/provider";
import { isPlainObject } from "../schema-walker";
import type { FieldNode } from "../types";
import { setLocaleValue } from "../value-ops";
import { GroupShell, IssueMessages, useControlA11y } from "./field-shell";

// An image placement `{media_id, alt?, decorative?}` (doc/04 section 3.1): thumbnail of the chosen media row,
// choose / change / remove (the MediaPicker below reads the media library; upload comes with P2), the
// `decorative` switch and - unless decorative - the alt text of the chosen language, greyed placeholder = the
// media row's own alt in that language.
export function MediaField({
  node,
  pointer,
  value,
  onChange,
  editable,
  altEditable,
}: {
  node: FieldNode;
  pointer: string;
  value: unknown;
  onChange: (next: unknown) => void;
  editable: boolean;
  // Translators may write the alt text even when the rest of the image is locked.
  altEditable: boolean;
}) {
  const t = useTranslations("schemaForm.media");
  const { locale, defaultLocale } = useSchemaFormContext();
  const label = useFieldLabel(node);
  const issues = useIssuesUnder(pointer);
  const [pickerOpen, setPickerOpen] = useState(false);
  const decorativeId = useId();

  const image = isPlainObject(value) ? value : undefined;
  const mediaId = typeof image?.media_id === "number" ? image.media_id : undefined;
  const decorative = image?.decorative === true;
  const asset = useMediaAsset(mediaId);
  const altMap = isPlainObject(image?.alt) ? image.alt : undefined;
  const alt = typeof altMap?.[locale] === "string" ? (altMap[locale] as string) : "";
  const mediaAlt = asset.data?.alt?.[locale] ?? asset.data?.alt?.[defaultLocale];
  const altIssues = issues.filter((i) => i.path.startsWith(`${pointer}/alt`));
  const mediaIssues = issues.filter((i) => !i.path.startsWith(`${pointer}/alt`));
  // A collection's image is `{media_id}` only: the alt text and the "decorative" flag are the media row's own (05 17.4.4).
  const hasAltControls = node.schema.properties === undefined || "alt" in node.schema.properties || "decorative" in node.schema.properties;
  const altId = useControlA11y(`${pointer}/alt`, altIssues.length > 0, false, `_${locale}`);

  // Removing the image of an array slot leaves an empty object so the array keeps its shape.
  const empty = node.name === "*" ? {} : undefined;

  function patch(next: Record<string, unknown>) {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(next)) if (v !== undefined) cleaned[k] = v;
    onChange(Object.keys(cleaned).length === 0 ? empty : cleaned);
  }

  return (
    <GroupShell pointer={pointer} label={label} required={node.required} description={node.description} issues={mediaIssues}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div
          className="relative w-full max-w-56 shrink-0 overflow-hidden rounded-md border bg-muted"
          style={{ aspectRatio: cssRatio(node.options.ratio) }}
          data-slot="media-preview"
        >
          {mediaId === undefined ? (
            <div className="flex h-full items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ImageIcon className="size-4" />
              {t("none")}
            </div>
          ) : asset.isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : asset.data ? (
            <MediaThumb
              asset={{ url: asset.data.thumbnail_url ?? asset.data.url, kind: asset.data.kind, mime_type: asset.data.mime_type, focal: asset.data.focal }}
              alt={decorative ? "" : alt || mediaAlt || asset.data.filename}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center text-xs text-destructive">
              <ImageOffIcon className="size-4" />
              {t("missing", { id: mediaId })}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          {asset.data && (
            <p className="truncate text-sm" title={asset.data.filename}>
              {asset.data.filename}
              {asset.data.status && asset.data.status !== "ready" && (
                <span className="ml-2 text-xs text-destructive">{t("notReady", { status: asset.data.status })}</span>
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!editable}
              data-field-pointer={`${pointer}/media_id`}
              aria-invalid={issues.some((i) => i.path === `${pointer}/media_id`) ? true : undefined}
              onClick={() => setPickerOpen(true)}
            >
              {mediaId === undefined ? t("choose") : t("change")}
            </Button>
            {mediaId !== undefined && (
              <Button type="button" variant="ghost" size="sm" disabled={!editable} onClick={() => patch({ ...image, media_id: undefined, alt: undefined })}>
                {t("remove")}
              </Button>
            )}
          </div>
          {hasAltControls && (
          <div className="flex items-center gap-2">
            <Switch
              id={decorativeId}
              checked={decorative}
              disabled={!editable}
              onCheckedChange={(checked) => patch({ ...image, decorative: checked ? true : undefined })}
            />
            <Label htmlFor={decorativeId} className="font-normal">
              {t("decorative")}
            </Label>
          </div>
          )}
          {hasAltControls && !decorative && (
            <div className="space-y-1.5">
              <Label htmlFor={altId.id}>{t("alt")}</Label>
              <Input
                {...altId}
                lang={locale}
                value={alt}
                placeholder={mediaAlt}
                disabled={!altEditable}
                onChange={(e) => {
                  const nextAlt = setLocaleValue(altMap, locale, e.target.value, false);
                  patch({ ...image, alt: nextAlt });
                }}
              />
              <IssueMessages id={altId.id} issues={altIssues} />
            </div>
          )}
        </div>
      </div>
      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selectedId={mediaId}
        ratio={node.options.ratio}
        defaultLocale={defaultLocale}
        onPick={(asset) => {
          patch({ ...image, media_id: asset.id });
          setPickerOpen(false);
        }}
      />
    </GroupShell>
  );
}

// Choose one row of the media library: the MediaPicker (components/protected/media/media-picker.tsx) in single
// mode with this field's wording. The rows come through `SchemaFormData` (`listMedia`).
export function MediaPickerDialog({
  open,
  onOpenChange,
  selectedId,
  onPick,
  ratio,
  defaultLocale,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedId?: number;
  onPick: (asset: MediaAssetOption) => void;
  ratio?: string;
  // The form's default language (decides the "No alt text" badge).
  defaultLocale?: string;
}) {
  const t = useTranslations("schemaForm.media");
  return (
    <MediaPicker
      open={open}
      onOpenChange={onOpenChange}
      mode="single"
      accept="image/*"
      ratio={ratio}
      defaultLocale={defaultLocale}
      selectedIds={selectedId !== undefined ? [selectedId] : []}
      onSelect={([asset]) => asset && onPick(asset)}
      title={t("pickerTitle")}
      description={t("pickerDescription")}
      searchLabel={t("search")}
    />
  );
}
