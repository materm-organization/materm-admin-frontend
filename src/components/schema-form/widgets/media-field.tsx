"use client";

import { ImageIcon, ImageOffIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { MediaAssetOption } from "@/types/cms";

import { useIssuesUnder, useFieldLabel, useSchemaFormContext } from "../context";
import { useMediaAsset, useMediaSearch } from "../data/provider";
import { isPlainObject } from "../schema-walker";
import type { FieldNode } from "../types";
import { setLocaleValue } from "../value-ops";
import { GroupShell, IssueMessages, useControlA11y } from "./field-shell";
import { useDebouncedValue } from "./use-debounced";

// The aspect ratio of the crop preview from `ui:options.ratio` (doc/07 section 4.2): "hero" = 16:9, "430:562".
function cssRatio(ratio: string | undefined): string {
  if (ratio === "hero") return "16 / 9";
  const match = ratio?.match(/^(\d+):(\d+)$/);
  return match ? `${match[1]} / ${match[2]}` : "4 / 3";
}

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
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.data.thumbnail_url ?? asset.data.url ?? ""}
              alt={decorative ? "" : alt || mediaAlt || asset.data.filename}
              className="h-full w-full object-cover"
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
          {!decorative && (
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
        onPick={(asset) => {
          patch({ ...image, media_id: asset.id });
          setPickerOpen(false);
        }}
      />
    </GroupShell>
  );
}

// Choose one row of the media library (doc/07 section 3.22: the real MediaPicker comes with the library; this
// one reads the same `GET /media/assets` list).
export function MediaPickerDialog({
  open,
  onOpenChange,
  selectedId,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedId?: number;
  onPick: (asset: MediaAssetOption) => void;
}) {
  const t = useTranslations("schemaForm.media");
  const [keyword, setKeyword] = useState("");
  const debounced = useDebouncedValue(keyword, 250);
  const { data, isLoading, isError } = useMediaSearch(debounced, open);
  const searchId = useId();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("pickerTitle")}</DialogTitle>
          <DialogDescription>{t("pickerDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={searchId}>{t("search")}</Label>
          <Input id={searchId} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {isLoading ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="aspect-4/3" />
              ))}
            </div>
          ) : isError ? (
            <p role="alert" className="text-sm text-destructive">
              {t("loadError")}
            </p>
          ) : data && data.length > 0 ? (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {data.map((asset) => (
                <li key={asset.id}>
                  <button
                    type="button"
                    aria-label={asset.filename}
                    aria-pressed={asset.id === selectedId}
                    onClick={() => onPick(asset)}
                    className={cn(
                      "block w-full overflow-hidden rounded-md border text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      asset.id === selectedId && "border-primary ring-2 ring-primary"
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={asset.thumbnail_url ?? asset.url ?? ""} alt="" className="aspect-4/3 w-full object-cover" />
                    <span className="block truncate px-2 py-1 text-xs">{asset.filename}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
