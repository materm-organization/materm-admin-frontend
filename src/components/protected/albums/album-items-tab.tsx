"use client";

import { ImagePlusIcon, LinkIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { EditorLocaleSwitcher } from "@/components/global/locale/editor-locale-switcher";
import { SortableList } from "@/components/global/sortable-list";
import { ReferencesBlockedDialog, type BlockingReference } from "@/components/protected/albums/references-blocked-dialog";
import { MediaPicker } from "@/components/protected/media/media-picker";
import { MediaThumb } from "@/components/protected/media/media-thumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { useAlbumWrites } from "@/hooks/use-albums";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { MAX_ALBUM_ITEMS, MAX_ITEMS_PER_REQUEST } from "@/lib/albums";
import type { AlbumItem } from "@/types/albums";
import type { MediaAssetOption } from "@/types/cms";
import type { Locale } from "@/types/locales";

export type AlbumItemsTabProps = {
  items: AlbumItem[] | undefined;
  isLoading: boolean;
  // `update` (drag, replace, hint), `create` (add), `delete` (remove).
  canUpdate: boolean;
  canCreate: boolean;
  canDelete: boolean;
  // `translate` or `update` and not in the trash: the sheet can save texts.
  canEditTexts: boolean;
  locales: Locale[];
  defaultLocale: string;
  locale: string;
  onLocaleChange: (code: string) => void;
  writes: ReturnType<typeof useAlbumWrites>;
  onConflict: () => void;
  onOpenItem: (id: number) => void;
};

// SCR-29 Pictures tab (doc/07 section 3.17): a grid of cards in the order they show, drag / keyboard / buttons to reorder (one `PUT .../order`
// at once), "Add pictures" (MediaPicker, several at once, a picture may be added twice), a card opens the sheet, delete. A picture that a
// photo story uses has a badge and its delete is switched off with the reason; if the server still says 409 (stale page) the dialog lists the pages.
export function AlbumItemsTab({ items, isLoading, canUpdate, canCreate, canDelete, canEditTexts, locales, defaultLocale, locale, onLocaleChange, writes, onConflict, onOpenItem }: AlbumItemsTabProps) {
  const t = useTranslations("albums.items");
  const { toastError } = useApiErrorHandler();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [toDelete, setToDelete] = useState<{ item: AlbumItem; position: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [blocked, setBlocked] = useState<{ position: number; references: BlockingReference[]; total: number } | null>(null);
  const idempotencyKey = useIdempotencyKey(pickerOpen);

  const rows = items ?? [];
  const room = Math.max(0, MAX_ALBUM_ITEMS - rows.length);
  const localeName = locales.find((l) => l.code === locale)?.native_name ?? locale;

  const handleError = (error: unknown, fallback: string) => {
    if (isConflictError(error)) onConflict();
    else toastError(error, fallback);
  };

  const add = async (assets: MediaAssetOption[]) => {
    setPickerOpen(false);
    const chosen = assets.slice(0, Math.min(room, MAX_ITEMS_PER_REQUEST));
    if (chosen.length === 0) return;
    try {
      await writes.addItems({ items: chosen.map((a) => ({ media_id: a.id })) }, idempotencyKey);
      toast.success(t("added", { count: chosen.length }));
    } catch (error) {
      handleError(error, t("addFailed"));
    }
  };

  const move = async (from: number, to: number) => {
    const ids = rows.map((r) => r.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    try {
      await writes.reorder(ids);
    } catch (error) {
      handleError(error, t("reorderFailed"));
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await writes.deleteItem(toDelete.item.id);
      toast.success(t("deleted", { n: toDelete.position }));
      setToDelete(null);
    } catch (error) {
      const parsed = parseApiError(error);
      const position = toDelete.position;
      setToDelete(null);
      if (parsed.code === "ENTITY_REFERENCED" && parsed.status === 409) {
        const details = (parsed.details ?? {}) as { references?: BlockingReference[]; total_references?: number };
        setBlocked({ position, references: details.references ?? [], total: details.total_references ?? details.references?.length ?? 0 });
      } else handleError(error, t("deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="album-items">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t("title")}</h3>
          <p className="text-xs text-muted-foreground" data-testid="album-items-count">{t("count", { count: rows.length, max: MAX_ALBUM_ITEMS })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <EditorLocaleSwitcher locales={locales} value={locale} onChange={onLocaleChange} />
          {canCreate ? (
            <Button type="button" variant="outline" size="sm" disabled={room <= 0} onClick={() => setPickerOpen(true)}>
              <ImagePlusIcon />
              {t("add")}
            </Button>
          ) : null}
        </div>
      </div>
      {canCreate && room <= 0 ? <p className="text-xs text-muted-foreground">{t("full", { max: MAX_ALBUM_ITEMS })}</p> : null}

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{canCreate ? t("empty") : t("emptyReadOnly")}</p>
      ) : (
        <TooltipProvider delayDuration={200}>
          <SortableList
            ids={rows.map((r) => String(r.id))}
            layout="grid"
            disabled={!canUpdate}
            itemLabel={(i) => t("itemLabel", { n: i + 1 })}
            onMove={(from, to) => void move(from, to)}
            renderItem={(key, { controls, index }) => {
              const item = rows.find((r) => String(r.id) === key)!;
              const text = item.translations[locale] ?? item.translations[defaultLocale];
              const caption = text?.caption_title ?? "";
              const deleteHint = !canDelete ? t("deleteNoRight") : item.in_use ? t("deleteInUse") : null;
              return (
                <div data-testid={`album-item-${item.id}`} className="flex h-full gap-3 rounded-md border bg-card p-3">
                  <div className="size-20 shrink-0 overflow-hidden rounded-md border bg-muted">
                    <MediaThumb asset={{ url: item.media.url, mime_type: item.media.mime_type }} alt={item.media.original_filename ?? `#${item.media_id}`} compact />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-medium tabular-nums text-muted-foreground">{index + 1}.</span>
                      {controls}
                    </div>
                    <p className="line-clamp-2 break-words text-sm" title={caption || undefined}>
                      {caption || <span className="text-muted-foreground">{t("noCaption", { language: localeName })}</span>}
                    </p>
                    {item.in_use ? (
                      <Badge variant="secondary" className="w-fit gap-1" data-testid={`album-item-in-use-${item.id}`}>
                        <LinkIcon className="size-3" aria-hidden />
                        {t("inUse")}
                      </Badge>
                    ) : null}
                    <div className="mt-auto flex items-center justify-end gap-1">
                      <Button type="button" variant="ghost" size="sm" aria-label={t("edit", { n: index + 1 })} onClick={() => onOpenItem(item.id)}>
                        <PencilIcon />
                        {canEditTexts ? t("editShort") : t("viewShort")}
                      </Button>
                      {canDelete ? (
                        deleteHint ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span tabIndex={0} className="inline-flex" data-testid={`album-item-delete-hint-${item.id}`}>
                                <Button type="button" variant="ghost" size="icon" className="size-8" disabled aria-label={t("delete", { n: index + 1 })}>
                                  <Trash2Icon />
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{deleteHint}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("delete", { n: index + 1 })} onClick={() => setToDelete({ item, position: index + 1 })}>
                            <Trash2Icon />
                          </Button>
                        )
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            }}
          />
        </TooltipProvider>
      )}

      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        mode="multiple"
        max={Math.max(1, Math.min(room, MAX_ITEMS_PER_REQUEST))}
        accept="image/*"
        selectedIds={[]}
        title={t("pickerTitle")}
        description={t("pickerDescription", { count: Math.min(room, MAX_ITEMS_PER_REQUEST) })}
        defaultLocale={defaultLocale}
        onSelect={(assets) => void add(assets)}
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t("deleteDialog.title", { n: toDelete?.position ?? 0 })}
        description={t("deleteDialog.description")}
        confirmLabel={t("deleteDialog.confirm")}
        destructive
        isPending={deleting}
        onConfirm={remove}
      />
      <ReferencesBlockedDialog
        open={blocked !== null}
        onOpenChange={(open) => !open && setBlocked(null)}
        kind="item"
        name={t("itemLabel", { n: blocked?.position ?? 0 })}
        references={blocked?.references ?? []}
        total={blocked?.total ?? 0}
      />
    </div>
  );
}
