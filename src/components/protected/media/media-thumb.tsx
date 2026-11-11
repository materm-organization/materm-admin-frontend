"use client";

import { FileIcon, FileTextIcon, FilmIcon, ImageOffIcon, MusicIcon, PlayIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { focalPosition, formatDuration } from "@/lib/media";
import { cn } from "@/lib/utils";

// ---- First-frame preview of a video tile -------------------------------------------------------------------------
// A plain muted, paused <video preload="metadata"> (no crossorigin: nothing reads pixels, so no CORS is needed; the CSP
// `media-src` already allows the media origin). It is mounted lazily (IntersectionObserver, ~200 px margin) and at most
// MAX_FRAME_LOADS tiles load a frame at once (module-level queue); tiles that wait, fail, time out, have no url, can not
// play H.264 or are on a data-saving connection keep the film-icon placeholder.
const MAX_FRAME_LOADS = 3;
const FRAME_TIMEOUT_MS = 8000;
let activeFrameLoads = 0;
const waitingFrameLoads: Array<() => void> = [];

function acquireFrameSlot(grant: () => void): () => void {
  let granted = false;
  let released = false;
  const run = () => {
    granted = true;
    activeFrameLoads++;
    grant();
  };
  if (activeFrameLoads < MAX_FRAME_LOADS) run();
  else waitingFrameLoads.push(run);
  return () => {
    if (released) return;
    released = true;
    if (granted) {
      activeFrameLoads--;
      while (activeFrameLoads < MAX_FRAME_LOADS && waitingFrameLoads.length > 0) waitingFrameLoads.shift()?.();
    } else {
      const i = waitingFrameLoads.indexOf(run);
      if (i >= 0) waitingFrameLoads.splice(i, 1);
    }
  };
}

function frameLoadsAllowed(mime: string | undefined): boolean {
  if (typeof window === "undefined") return false;
  try {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    if (nav.connection?.saveData) return false;
    if (window.matchMedia?.("(prefers-reduced-data: reduce)").matches) return false;
    const m = mime && mime.startsWith("video/") ? mime : "video/mp4";
    const type = m === "video/mp4" ? 'video/mp4; codecs="avc1.42E01E"' : m;
    return document.createElement("video").canPlayType(type) !== "";
  } catch {
    return false;
  }
}

function VideoFrame({ url, mime }: { url: string | null; mime?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  // Without IntersectionObserver (very old browsers) the tile counts as visible at once.
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const releaseRef = useRef<(() => void) | null>(null);
  const eligible = url !== null && !failed;

  useEffect(() => {
    if (!eligible || near) return;
    const el = boxRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [eligible, near]);

  useEffect(() => {
    if (!eligible || !near || !frameLoadsAllowed(mime)) return;
    const cancel = acquireFrameSlot(() => setMounted(true));
    releaseRef.current = cancel;
    return () => {
      cancel();
      releaseRef.current = null;
    };
  }, [eligible, near, mime]);

  useEffect(() => {
    if (!mounted || ready) return;
    const timer = setTimeout(() => {
      setFailed(true);
      releaseRef.current?.();
    }, FRAME_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [mounted, ready]);

  return (
    <div ref={boxRef} aria-hidden className="pointer-events-none absolute inset-0">
      {mounted && !failed && url ? (
        <video
          src={`${url.split("#")[0]}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          disablePictureInPicture
          disableRemotePlayback
          tabIndex={-1}
          aria-hidden
          draggable={false}
          onLoadedData={() => {
            setReady(true);
            releaseRef.current?.();
          }}
          onError={() => {
            setFailed(true);
            releaseRef.current?.();
          }}
          className={cn("h-full w-full bg-muted object-cover", ready ? "opacity-100" : "opacity-0")}
        />
      ) : null}
    </div>
  );
}

type ThumbAsset = {
  url?: string | null;
  kind?: string;
  mime_type?: string;
  focal?: { x: number; y: number } | null;
  duration_ms?: number | null;
};

// The picture of a media row. `url` is null until `media.staticBaseUrl` / the file service is configured
// (doc/05 11.6, S-12), and the image may be blocked by the CSP (`img-src`) or gone: in all three cases a
// placeholder tile shows instead of a broken image. `fill`: crop to the box (`object-cover`) around the focal
// point; otherwise the whole picture is shown (`object-contain`). `compact`: for small boxes (a 48-80 px tile)
// the placeholder is just the icon, the reason stays in the tooltip (`title`), not as text squeezed into the box.
export function MediaThumb({
  asset,
  alt,
  fill = true,
  compact = false,
  className,
}: {
  asset: ThumbAsset;
  alt: string;
  fill?: boolean;
  compact?: boolean;
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
    const isVideo = asset.kind === "video";
    const duration = isVideo ? formatDuration(asset.duration_ms) : "";
    const reason = isVideo ? t("video") : !url ? t("noUrl") : broken ? t("failed") : t("noPreview");
    return (
      <div
        data-slot="media-placeholder"
        role="img"
        aria-label={alt}
        title={compact ? reason : undefined}
        className={cn("relative flex h-full w-full flex-col items-center justify-center gap-1 bg-muted text-muted-foreground", className)}
      >
        <Icon className="size-6" aria-hidden />
        {compact ? null : <span className="px-2 text-center text-xs">{reason}</span>}
        {isVideo ? (
          // The first frame (lazy, capped, see VideoFrame) covers the icon; the badges stay on top in every case.
          <>
            <VideoFrame url={url} mime={asset.mime_type} />
            <span
              data-slot="video-play-badge"
              aria-hidden
              className="absolute top-1.5 right-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-foreground/80 text-background"
            >
              <PlayIcon className="size-3" />
            </span>
            {duration ? (
              <span
                data-slot="video-duration-badge"
                className="absolute right-1.5 bottom-1.5 z-10 rounded bg-foreground/80 px-1.5 py-0.5 text-[10px] leading-none font-medium text-background tabular-nums"
              >
                {duration}
              </span>
            ) : null}
          </>
        ) : null}
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
