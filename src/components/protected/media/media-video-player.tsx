"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { MediaThumb } from "@/components/protected/media/media-thumb";

type VideoAsset = {
  url?: string | null;
  kind?: string;
  mime_type?: string;
  duration_ms?: number | null;
  width?: number | null;
  height?: number | null;
};

// The player of the detail sheet. A plain `src` (no `crossorigin`, so the media origin needs no CORS headers),
// `preload="metadata"` (only the first bytes are fetched until Play is pressed), `playsInline` (iOS Safari must not
// force full screen). If the file can not be played (CSP `media-src`, 404, a codec the browser lacks) the placeholder tile
// with the film icon replaces it, with the reason.
export function MediaVideoPlayer({ asset, label }: { asset: VideoAsset; label: string }) {
  const t = useTranslations("media.thumb");
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = asset.url ?? null;
  if (!url || failedUrl === url) {
    return (
      <div className="aspect-video max-w-xl overflow-hidden rounded-md border">
        <MediaThumb asset={asset} alt={label} fill={false} />
        {url ? <p className="sr-only">{t("videoFailed")}</p> : null}
      </div>
    );
  }
  return (
    <div className="aspect-video max-w-xl overflow-hidden rounded-md border bg-black">
      <video
        src={url}
        controls
        preload="metadata"
        playsInline
        aria-label={label}
        onError={() => setFailedUrl(url)}
        className="h-full w-full object-contain"
      />
    </div>
  );
}
