"use client";

import { FolderInputIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMediaFolders, useMutationBulkDeleteMedia, useMutationBulkMoveMedia } from "@/hooks/use-media";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import type { MediaAsset, MediaBulkResult } from "@/types/media";

const ROOT = "__root__";

type Summary = { kind: "move" | "delete"; result: MediaBulkResult<unknown>; names: Map<number, string> };

// FR-MEDIA-11: "Move to folder" / "Delete" for the selected files. One real bulk request per 100 rows (the ETag of every row
// comes from the loaded list). Whatever the server skipped is listed with a readable reason and stays selected.
export function MediaBulkActions({
  rows,
  canMove,
  canDelete,
  onFinished,
}: {
  rows: MediaAsset[];
  canMove: boolean;
  canDelete: boolean;
  // Ids to keep selected (the skipped ones).
  onFinished: (keepSelected: number[]) => void;
}) {
  const t = useTranslations("media.bulk");
  const folders = useMediaFolders();
  const move = useMutationBulkMoveMedia();
  const del = useMutationBulkDeleteMedia();
  const { toastError } = useApiErrorHandler();
  const folderId = useId();
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [target, setTarget] = useState<string>(ROOT);
  const [summary, setSummary] = useState<Summary | null>(null);

  if (!canMove && !canDelete) return null;
  const busy = move.isPending || del.isPending;

  const finish = (kind: "move" | "delete", outcome: { result: MediaBulkResult<unknown>; error: unknown }) => {
    const { result, error } = outcome;
    const names = new Map(rows.map((r) => [r.id, r.original_filename]));
    onFinished(result.skipped.map((s) => s.id));
    if (error !== null) toastError(error, t(`${kind}.failed`));
    if (result.counts.skipped > 0 || error !== null) setSummary({ kind, result, names });
    else toast.success(t(`${kind}.done`, { count: result.counts.updated }));
  };

  const runMove = async () => {
    const outcome = await move.mutateAsync({ rows, folderId: target === ROOT ? null : Number(target) });
    setMoveOpen(false);
    finish("move", outcome);
  };
  const runDelete = async () => {
    const outcome = await del.mutateAsync({ rows });
    finish("delete", outcome);
  };

  return (
    <>
      {canMove ? (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setMoveOpen(true)}>
          <FolderInputIcon />
          {t("move.button")}
        </Button>
      ) : null}
      {canDelete ? (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setDeleteOpen(true)}>
          <Trash2Icon />
          {t("delete.button")}
        </Button>
      ) : null}

      <Dialog open={moveOpen} onOpenChange={(open) => !move.isPending && setMoveOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("move.title", { count: rows.length })}</DialogTitle>
            <DialogDescription>{t("move.description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={folderId}>{t("move.folder")}</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger id={folderId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROOT}>{t("move.root")}</SelectItem>
                {(folders.data?.data ?? []).map((f) => (
                  <SelectItem key={f.id} value={String(f.id)}>
                    {f.path}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={move.isPending} onClick={() => setMoveOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="button" disabled={move.isPending} onClick={() => void runMove()}>
              {t("move.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("delete.title", { count: rows.length })}
        description={t("delete.description")}
        confirmLabel={t("delete.confirm")}
        destructive
        isPending={del.isPending}
        onConfirm={runDelete}
      />

      <Dialog open={summary !== null} onOpenChange={(open) => !open && setSummary(null)}>
        <DialogContent>
          {summary ? (
            <>
              <DialogHeader>
                <DialogTitle>{t(`${summary.kind}.resultTitle`)}</DialogTitle>
                <DialogDescription>
                  {t("result.counts", { updated: summary.result.counts.updated, skipped: summary.result.counts.skipped })}
                </DialogDescription>
              </DialogHeader>
              {summary.result.skipped.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t("result.skippedHeading")}</p>
                  <ul className="max-h-64 space-y-1 overflow-y-auto text-sm" aria-label={t("result.skippedHeading")}>
                    {summary.result.skipped.map((s) => (
                      <li key={s.id} className="flex flex-col rounded border px-2 py-1">
                        <span className="truncate font-medium">{summary.names.get(s.id) ?? `#${s.id}`}</span>
                        <span className="text-muted-foreground">{t.has(`reasons.${summary.kind}.${s.reason}`) ? t(`reasons.${summary.kind}.${s.reason}`) : t("reasons.error")}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">{t("result.keptSelected")}</p>
                </div>
              ) : null}
              <DialogFooter>
                <Button type="button" onClick={() => setSummary(null)}>
                  {t("result.close")}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
