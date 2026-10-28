"use client";

import { FileIcon, FileTextIcon, FilmIcon, ImageOffIcon, MusicIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { focalPosition } from "@/lib/media";
import { cn } from "@/lib/utils";

type ThumbAsset = {
  url?: string | null;
  kind?: string;
  mime_type?: string;
  focal?: { x: number; y: number } | null;
};

// The picture of a media row. `url` is null until `media.staticBaseUrl` / the file service is configured
// (doc/05 11.6, S-12), and the image may be blocked by the CSP (`img-src`) or gone: in all three cases a
// placeholder tile shows instead of a broken image. `fill`: crop to the box (`object-cover`) around the focal
// point; otherwise the whole picture is shown (`object-contain`).
export function MediaThumb({
  asset,
  alt,
  fill = true,
  className,
}: {
  asset: ThumbAsset;
  alt: string;
  fill?: boolean;
  className?: string;
}) {
  const t = useTranslations("media.thumb");
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = asset.url ?? null;
  const isImage = !asset.kind || asset.kind === "image" || asset.kind === "brand" || asset.mime_type?.startsWith("image/");
  const broken = url !== null && failedUrl === url;

  if (!url || broken || !isImage) {
    const Icon = !isImage
      ? asset.kind === "video"
        ? FilmIcon
        : asset.kind === "audio"
          ? MusicIcon
          : asset.kind === "document"
            ? FileTextIcon
            : FileIcon
      : ImageOffIcon;
    return (
      <div
        data-slot="media-placeholder"
        role="img"
        aria-label={alt}
        className={cn("flex h-full w-full flex-col items-center justify-center gap-1 bg-muted text-muted-foreground", className)}
      >
        <Icon className="size-6" aria-hidden />
        <span className="px-2 text-center text-xs">{!url ? t("noUrl") : broken ? t("failed") : t("noPreview")}</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setFailedUrl(url)}
      className={cn("h-full w-full", fill ? "object-cover" : "object-contain", className)}
      style={fill ? { objectPosition: focalPosition(asset.focal) } : undefined}
    />
  );
}
