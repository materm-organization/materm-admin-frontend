"use client";

import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, FolderIcon, ImageIcon, SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useDebouncedValue } from "@/components/schema-form/widgets/use-debounced";
import { MediaThumb } from "@/components/protected/media/media-thumb";
import { useMediaFolderOptions, useMediaPage } from "@/components/schema-form/data/provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocales } from "@/hooks/use-locales";
import { isNoPermissionError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import type { MediaAssetOption } from "@/types/cms";

const PAGE_SIZE = 24;
const ALL = "__all__";
const ROOT = "__root__";

// The aspect ratio of the crop preview from `ui:options.ratio` (doc/07 section 4.2): "hero" = 16:9, "430:562".
export function cssRatio(ratio: string | undefined): string {
  if (ratio === "hero") return "16 / 9";
  const match = ratio?.match(/^(\d+):(\d+)$/);
  return match ? `${match[1]} / ${match[2]}` : "4 / 3";
}

export type MediaPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // `single`: a click picks the image and closes. `multiple`: clicks toggle (up to `max`), "Add" confirms.
  mode?: "single" | "multiple";
  max?: number;
  // Mime filter, e.g. `image/*` (sent as `mime` to the API).
  accept?: string;
  // Crop preview of every tile: `hero`, `430:562` ... (the field's `ui:options.ratio`).
  ratio?: string;
  // The ids already chosen: marked in the grid; in `multiple` mode they start as the selection.
  selectedIds?: number[];
  onSelect: (assets: MediaAssetOption[]) => void;
  title?: string;
  description?: string;
  searchLabel?: string;
  // The language whose alt text decides the "No alt text" badge (the default one when omitted).
  defaultLocale?: string;
};

// SCR-36 (doc/07 section 3.22): the media library as a dialog - folders, keyword, kind filter, paging, a grid of
// buttons (keyboard: Tab, Enter / Space, arrows move between tiles). Rows are read through the `SchemaFormData`
// abstraction (`listMedia` / `listMediaFolders`: the API by default, in-memory in the playground), so it works in
// every editor and every test. Mount while open (`key` the instance by what should reset it).
export function MediaPicker(props: MediaPickerProps) {
  // The body is mounted only while open: its state (search, page, selection) is fresh on every open.
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <PickerContent {...props} /> : null}
    </Dialog>
  );
}

function PickerContent({
  onOpenChange,
  mode = "single",
  max,
  accept,
  ratio,
  selectedIds = [],
  onSelect,
  title,
  description,
  searchLabel,
  defaultLocale,
}: MediaPickerProps) {
  const t = useTranslations("media.picker");
  const searchId = useId();
  const kindId = useId();
  const [keyword, setKeyword] = useState("");
  const debounced = useDebouncedValue(keyword, 250);
  const [folder, setFolder] = useState<string>(ALL);
  const [kind, setKind] = useState<string>(ALL);
  const [page, setPage] = useState(1);
  const gridRef = useRef<HTMLUListElement>(null);
  const multiple = mode === "multiple";
  const limit = max ?? Number.POSITIVE_INFINITY;

  // An editor that already knows the default language (the schema form) passes it: no extra request.
  const locales = useLocales(defaultLocale === undefined);
  const altLocale = defaultLocale ?? locales.data?.data.find((l) => l.is_default)?.code ?? "la";

  const folders = useMediaFolderOptions(true);
  const query = useMemo(
    () => ({
      keyword: debounced || undefined,
      limit: PAGE_SIZE,
      page,
      folderId: folder === ALL ? undefined : folder === ROOT ? ("root" as const) : Number(folder),
      includeSubfolders: folder !== ALL && folder !== ROOT ? true : undefined,
      kind: kind === ALL ? undefined : kind,
      mime: accept || undefined,
    }),
    [debounced, folder, kind, page, accept]
  );
  const { data, isLoading, isError, error, refetch } = useMediaPage(query, true);

  // The selection of `multiple` mode starts from the ids already in the field. Their rows may be on another page or in
  // another folder, so they are fetched by id (`ids`, <= 50) - "Add selected" returns rows, and an image that is only
  // marked but never loaded would silently drop out of the caller's list.
  const [selectedSet, setSelectedSet] = useState<number[]>(() => (multiple ? selectedIds : []));
  const chosenById = useRef(new Map<number, MediaAssetOption>());
  const initialIds = useMemo(() => (multiple ? selectedIds.slice(0, 50) : []), [multiple, selectedIds]);
  const preselected = useMediaPage({ ids: initialIds }, initialIds.length > 0);
  const preselectedPending = initialIds.length > 0 && (preselected.isLoading || preselected.isError);
  useEffect(() => {
    for (const a of data?.items ?? []) chosenById.current.set(a.id, a);
  }, [data]);
  useEffect(() => {
    for (const a of preselected.data?.items ?? []) chosenById.current.set(a.id, a);
  }, [preselected.data]);

  const toggle = (asset: MediaAssetOption) => {
    chosenById.current.set(asset.id, asset);
    setSelectedSet((current) => {
      if (current.includes(asset.id)) return current.filter((id) => id !== asset.id);
      if (current.length >= limit) return current;
      return [...current, asset.id];
    });
  };

  const pick = (asset: MediaAssetOption) => {
    if (multiple) {
      toggle(asset);
      return;
    }
    onSelect([asset]);
    onOpenChange(false);
  };

  const confirm = () => {
    // An id that no longer resolves (deleted since) is left out; the others always have their row (see above).
    const rows = selectedSet
      .map((id) => chosenById.current.get(id))
      .filter((row): row is MediaAssetOption => Boolean(row));
    onSelect(rows);
    onOpenChange(false);
  };

  // Arrow keys move the focus between tiles (Tab still visits each one, as a plain list of buttons).
  const onGridKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const buttons = [...(gridRef.current?.querySelectorAll<HTMLButtonElement>("button[data-tile]") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowRight") next = index + 1;
    else if (event.key === "ArrowLeft") next = index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else {
      // Up / Down: the tile in the next / previous visual row nearest in column.
      const here = buttons[index].getBoundingClientRect();
      const dir = event.key === "ArrowDown" ? 1 : -1;
      const candidates = buttons
        .map((b, i) => ({ i, rect: b.getBoundingClientRect() }))
        .filter(({ rect }) => (dir === 1 ? rect.top > here.top + 1 : rect.top < here.top - 1));
      if (candidates.length === 0) return;
      const rowTop = dir === 1 ? Math.min(...candidates.map((c) => c.rect.top)) : Math.max(...candidates.map((c) => c.rect.top));
      const row = candidates.filter((c) => Math.abs(c.rect.top - rowTop) < 2);
      next = row.reduce((best, c) => (Math.abs(c.rect.left - here.left) < Math.abs(best.rect.left - here.left) ? c : best)).i;
    }
    buttons[Math.min(buttons.length - 1, Math.max(0, next))]?.focus();
  };

  const rows = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;
  const noPermission = isError && isNoPermissionError(error);
  const folderOptions = folders.data ?? [];

  return (
    <DialogContent className="flex max-h-[90vh] flex-col gap-4 md:max-w-5xl">
      <DialogHeader>
        <DialogTitle>{title ?? (multiple ? t("titleMultiple") : t("title"))}</DialogTitle>
        <DialogDescription>{description ?? (multiple ? t("descriptionMultiple") : t("description"))}</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="relative flex-1 space-y-1.5">
          <Label htmlFor={searchId}>{searchLabel ?? t("search")}</Label>
          <SearchIcon className="pointer-events-none absolute bottom-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input
            id={searchId}
            value={keyword}
            className="pl-8"
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={kindId}>{t("kind")}</Label>
          <Select
            value={kind}
            onValueChange={(next) => {
              setKind(next);
              setPage(1);
            }}
          >
            <SelectTrigger id={kindId} className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("kindAll")}</SelectItem>
              <SelectItem value="image">{t("kindImage")}</SelectItem>
              <SelectItem value="brand">{t("kindBrand")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[13rem_1fr]">
        {folderOptions.length > 0 ? (
          <nav aria-label={t("folders")} className="max-h-40 overflow-y-auto md:max-h-[50vh]">
            <ul className="space-y-0.5 text-sm">
              <FolderButton label={t("allFolders")} active={folder === ALL} onClick={() => { setFolder(ALL); setPage(1); }} />
              <FolderButton label={t("noFolder")} active={folder === ROOT} onClick={() => { setFolder(ROOT); setPage(1); }} />
              {folderOptions.map((f) => (
                <FolderButton
                  key={f.id}
                  label={f.name}
                  depth={f.depth - 1}
                  count={f.assetCount}
                  active={folder === String(f.id)}
                  onClick={() => {
                    setFolder(String(f.id));
                    setPage(1);
                  }}
                />
              ))}
            </ul>
          </nav>
        ) : (
          <div className="hidden md:block" />
        )}

        <div className={cn("min-h-0 overflow-y-auto md:max-h-[50vh]", folderOptions.length === 0 && "md:col-span-2")}>
          {isLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="aspect-4/3" />
              ))}
            </div>
          ) : noPermission ? (
            <p role="alert" className="text-sm text-muted-foreground">
              {t("noPermission")}
            </p>
          ) : isError ? (
            <div role="alert" className="space-y-2 text-sm">
              <p className="text-destructive">{t("loadError")}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                {t("retry")}
              </Button>
            </div>
          ) : rows.length > 0 ? (
            <ul
              ref={gridRef}
              onKeyDown={onGridKeyDown}
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
              aria-label={t("results")}
            >
              {rows.map((asset) => {
                const current = selectedIds.includes(asset.id);
                const marked = multiple ? selectedSet.includes(asset.id) : current;
                const noAlt = !asset.is_decorative && !(asset.alt?.[altLocale] ?? "").trim();
                const notReady = Boolean(asset.status && asset.status !== "ready");
                return (
                  <li key={asset.id}>
                    <button
                      type="button"
                      data-tile
                      aria-label={asset.filename}
                      aria-pressed={marked}
                      onClick={() => pick(asset)}
                      className={cn(
                        "group relative block w-full overflow-hidden rounded-md border bg-background text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        marked && "border-primary ring-2 ring-primary"
                      )}
                    >
                      <span className="relative block bg-muted" style={{ aspectRatio: cssRatio(ratio) }}>
                        <MediaThumb asset={asset} alt="" />
                        {marked ? (
                          <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <CheckIcon className="size-3.5" aria-hidden />
                          </span>
                        ) : null}
                      </span>
                      <span className="block truncate px-2 pt-1 text-xs" aria-hidden>
                        {asset.filename}
                      </span>
                      <span className="flex min-h-5 flex-wrap gap-1 px-2 pb-1.5" aria-hidden>
                        {notReady ? (
                          <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                            {t("notReady")}
                          </Badge>
                        ) : null}
                        {noAlt ? (
                          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                            {t("noAlt")}
                          </Badge>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ImageIcon className="size-4" aria-hidden />
              {t("empty")}
            </p>
          )}
        </div>
      </div>

      <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          {data ? <span>{t("total", { total: data.total })}</span> : null}
          {totalPages > 1 ? (
            <span className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                aria-label={t("previousPage")}
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeftIcon />
              </Button>
              <span>{t("page", { page, totalPages })}</span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                aria-label={t("nextPage")}
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRightIcon />
              </Button>
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {multiple ? (
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {max ? t("selectedMax", { count: selectedSet.length, max }) : t("selected", { count: selectedSet.length })}
            </span>
          ) : null}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          {multiple ? (
            <Button type="button" disabled={selectedSet.length === 0 || preselectedPending} onClick={confirm}>
              {t("addSelected")}
            </Button>
          ) : null}
        </div>
      </DialogFooter>
    </DialogContent>
  );
}

function FolderButton({
  label,
  active,
  onClick,
  depth = 0,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  depth?: number;
  count?: number;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={onClick}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
          active && "bg-accent font-medium"
        )}
      >
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined ? <span className="text-xs text-muted-foreground">{count}</span> : null}
      </button>
    </li>
  );
}
