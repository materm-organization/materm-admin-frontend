"use client";

import { CrosshairIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, type KeyboardEvent, type PointerEvent } from "react";

import { MediaThumb } from "@/components/protected/media/media-thumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { roundFocal } from "@/lib/media";
import type { MediaFocal } from "@/types/media";

type PickerAsset = { url: string | null; kind?: string; mime_type?: string; width?: number | null; height?: number | null };

// The three crops the website uses (doc/07 section 3.22: hero 16:9, card 430:562, square): each shows the picture
// cut to that ratio around the focal point, so the editor sees what a narrow crop would keep.
const CROPS = [
  { id: "hero", ratio: "16 / 9" },
  { id: "card", ratio: "430 / 562" },
  { id: "square", ratio: "1 / 1" },
] as const;

// SCR-36 focal point (FR-MEDIA-06): click (or drag) on the picture to set `{x, y}` in 0..1, move it with the
// arrow keys (Shift = 10 %), type percentages, or clear it. `onChange(null)` clears both values (they are always
// stored as a pair). Values are rounded to 3 decimals (`numeric(4,3)` - more would be a 422).
export function FocalPointPicker({
  asset,
  alt,
  focal,
  onChange,
  disabled = false,
}: {
  asset: PickerAsset;
  alt: string;
  focal: MediaFocal;
  onChange: (focal: MediaFocal) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("media.focal");
  const frameRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const xId = useId();
  const yId = useId();

  const setFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    onChange({
      x: roundFocal((event.clientX - rect.left) / rect.width),
      y: roundFocal((event.clientY - rect.top) / rect.height),
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    const here = focal ?? { x: 0.5, y: 0.5 };
    let next: MediaFocal | undefined;
    if (event.key === "ArrowLeft") next = { x: roundFocal(here.x - step), y: here.y };
    else if (event.key === "ArrowRight") next = { x: roundFocal(here.x + step), y: here.y };
    else if (event.key === "ArrowUp") next = { x: here.x, y: roundFocal(here.y - step) };
    else if (event.key === "ArrowDown") next = { x: here.x, y: roundFocal(here.y + step) };
    else if (event.key === "Delete" || event.key === "Backspace") next = null;
    if (next === undefined) return;
    event.preventDefault();
    onChange(next);
  };

  const percent = (value: number | undefined) => (value === undefined ? "" : String(Math.round(value * 1000) / 10));
  const setAxis = (axis: "x" | "y", text: string) => {
    if (text.trim() === "") return;
    const n = Number(text);
    if (!Number.isFinite(n)) return;
    const here = focal ?? { x: 0.5, y: 0.5 };
    onChange({ ...here, [axis]: roundFocal(n / 100) });
  };

  const ratio = asset.width && asset.height ? `${asset.width} / ${asset.height}` : "4 / 3";

  return (
    <div className="space-y-3" data-slot="focal-point-picker">
      <div
        ref={frameRef}
        className="relative w-full max-w-xl overflow-hidden rounded-md border bg-muted select-none"
        style={{ aspectRatio: ratio, touchAction: "none", cursor: disabled ? "default" : "crosshair" }}
        onPointerDown={(event) => {
          if (disabled) return;
          draggingRef.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (draggingRef.current && !disabled) setFromPointer(event);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
        data-testid="focal-frame"
      >
        <MediaThumb asset={asset} alt={alt} fill={false} />
        {focal ? (
          <button
            type="button"
            disabled={disabled}
            aria-label={t("handle", { x: percent(focal.x), y: percent(focal.y) })}
            onKeyDown={onKeyDown}
            onPointerDown={(event) => event.stopPropagation()}
            className="absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-primary/70 text-white shadow outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
            style={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }}
          >
            <CrosshairIcon className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor={xId} className="text-xs">
            {t("x")}
          </Label>
          <Input
            id={xId}
            inputMode="decimal"
            className="w-20"
            disabled={disabled}
            value={percent(focal?.x)}
            placeholder="50"
            onChange={(e) => setAxis("x", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={yId} className="text-xs">
            {t("y")}
          </Label>
          <Input
            id={yId}
            inputMode="decimal"
            className="w-20"
            disabled={disabled}
            value={percent(focal?.y)}
            placeholder="50"
            onChange={(e) => setAxis("y", e.target.value)}
          />
        </div>
        <Button type="button" variant="outline" size="sm" disabled={disabled || !focal} onClick={() => onChange(null)}>
          <XIcon />
          {t("clear")}
        </Button>
        <p className="basis-full text-xs text-muted-foreground">{focal ? t("hint") : t("hintEmpty")}</p>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium">{t("crops")}</p>
        <ul className="flex flex-wrap items-end gap-3">
          {CROPS.map((crop) => (
            <li key={crop.id} className="space-y-1">
              <div
                className="w-28 overflow-hidden rounded-md border bg-muted"
                style={{ aspectRatio: crop.ratio, width: crop.id === "card" ? "5rem" : undefined }}
                data-testid={`crop-${crop.id}`}
              >
                <MediaThumb asset={{ ...asset, focal }} alt="" />
              </div>
              <p className="text-center text-xs text-muted-foreground">{t(`crop.${crop.id}`)}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
