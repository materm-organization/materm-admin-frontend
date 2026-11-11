"use client";

import { AlertCircleIcon, CheckCircle2Icon, FileIcon, RotateCcwIcon, UploadIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { useMediaFolders } from "@/hooks/use-media";
import { useMediaUpload } from "@/hooks/use-media-upload";
import { useCan } from "@/hooks/use-permission";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import { formatBytes } from "@/lib/media";
import { MAX_FILES_PER_BATCH, VIDEO_MIME, acceptAttribute, errorTextParams, guessMime, matchesAccept } from "@/lib/media-upload";
import type { UploadItem } from "@/lib/media-upload-queue";
import { cn } from "@/lib/utils";

// SCR-35 upload (doc/07 section 3.22, FR-MEDIA-01/02/12): the "Upload files" button of the library and its dialog.
// Needs `media.library:create` (no button without it); SVG only with `media.library:update`. The queue lives in
// the BUTTON (not the dialog): closing the dialog does not stop the uploads, reopening shows where they are.
export function MediaUploadButton({ folderId }: { folderId: number | null }) {
  const t = useTranslations("media.upload");
  const canCreate = useCan(PERMISSION_KEYS.MEDIA_LIBRARY, PERMISSION_ACTIONS.CREATE);
  const canSvg = useCan(PERMISSION_KEYS.MEDIA_LIBRARY, PERMISSION_ACTIONS.UPDATE);
  const [open, setOpen] = useState(false);
  const { queue, items, busy } = useMediaUpload({ folderId, allowSvg: canSvg });
  if (!canCreate) return null;
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        {busy ? <Spinner aria-hidden /> : <UploadIcon />}
        {t("button")}
      </Button>
      <MediaUploadDialog open={open} onOpenChange={setOpen} queue={queue} items={items} folderId={folderId} allowSvg={canSvg} />
    </>
  );
}

type Queue = ReturnType<typeof useMediaUpload>["queue"];

export function MediaUploadDialog({
  open,
  onOpenChange,
  queue,
  items,
  folderId,
  allowSvg,
  accept,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queue: Queue;
  items: readonly UploadItem[];
  folderId: number | null;
  allowSvg: boolean;
  // The media picker's mime filter: narrows the file chooser (the queue rejects the rest).
  accept?: string;
}) {
  const t = useTranslations("media.upload");
  const folders = useMediaFolders(open);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [skipped, setSkipped] = useState(0);

  const folderLabel = folderId === null ? t("noFolder") : (folders.data?.data.find((f) => f.id === folderId)?.path ?? `#${folderId}`);

  const addFiles = (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    setSkipped(queue.add(files).skipped);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const total = items.length;
  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const active = items.some((i) => i.status === "queued" || i.status === "uploading");
  const retryable = items.some((i) => i.status === "failed" && i.error?.retryable);
  // Announced politely by screen readers, only the counts (not every progress tick).
  const summary = total === 0 ? "" : !active && failed === 0 && done === total ? t("summaryDone", { total }) : t("summary", { done, total, failed });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] gap-4 overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div
          role="group"
          aria-label={t("dropzone")}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center gap-2 rounded-md border-2 border-dashed p-6 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-border"
          )}
        >
          <UploadIcon className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">{dragging ? t("dropzoneActive") : t("dropzone")}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            {t("choose")}
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            tabIndex={-1}
            aria-hidden
            data-testid="media-upload-input"
            accept={acceptAttribute(allowSvg)
              .split(",")
              .filter((mime) => matchesAccept({ name: "", type: mime }, accept))
              .join(",")}
            onChange={(e) => {
              addFiles(e.target.files);
              // The same file can be chosen again after it was removed.
              e.target.value = "";
            }}
          />
          <p className="text-xs text-muted-foreground">
            {t("hint", { max: MAX_FILES_PER_BATCH })} {allowSvg ? t("hintSvg") : ""}
          </p>
          <p className="text-xs text-muted-foreground">{t("folder", { folder: folderLabel })}</p>
        </div>

        {skipped > 0 ? (
          <p role="alert" className="text-sm text-destructive">
            {t("skipped", { count: skipped, max: MAX_FILES_PER_BATCH })}
          </p>
        ) : null}

        <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
          {summary}
        </p>

        {total > 0 ? (
          <ul aria-label={t("listLabel")} className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {items.map((item) => (
              <UploadRow key={item.id} item={item} queue={queue} />
            ))}
          </ul>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            {retryable ? (
              <Button type="button" variant="outline" size="sm" onClick={() => queue.retryAll()}>
                <RotateCcwIcon />
                {t("retryAll")}
              </Button>
            ) : null}
            {done > 0 ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => queue.clearDone()}>
                {t("clearDone")}
              </Button>
            ) : null}
          </div>
          <Button type="button" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadRow({ item, queue }: { item: UploadItem; queue: Queue }) {
  const t = useTranslations("media.upload");
  const name = item.file.name;
  const waiting = item.status === "queued" && item.attempts > 0;
  const isVideo = guessMime(item.file) === VIDEO_MIME;

  let statusText: string;
  if (item.status === "uploading") statusText = t("status.uploading", { percent: item.progress });
  else if (item.status === "done") statusText = item.reusedExisting ? t("status.doneExisting") : t("status.done");
  else if (waiting) statusText = t("status.waiting");
  else statusText = t(`status.${item.status}`);

  const duplicateName = item.duplicate?.existing?.original_filename ?? t("duplicate.unknownName", { id: item.duplicate?.existingId ?? 0 });

  return (
    <li className="rounded-md border p-3" data-status={item.status}>
      <div className="flex items-start gap-3">
        {item.status === "done" ? (
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-green-600" aria-hidden />
        ) : item.status === "failed" ? (
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        ) : (
          <FileIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">
            {formatBytes(item.file.size)} · {statusText}
          </p>
          {item.status === "uploading" ? (
            <Progress value={item.progress} className="mt-2" aria-label={t("progress", { name })} />
          ) : null}
          {item.status === "failed" && item.error ? (
            <p className="mt-1 text-xs text-destructive">{t(`errors.${item.error.kind}`, errorTextParams(item.error))}</p>
          ) : null}
          {waiting && item.error ? <p className="mt-1 text-xs text-muted-foreground">{t(`errors.${item.error.kind}`, errorTextParams(item.error))}</p> : null}
          {isVideo && item.status === "uploading" ? (
            <p className="mt-1 text-xs text-muted-foreground">{t("videoSlow", { size: formatBytes(item.file.size) })}</p>
          ) : null}
          {item.status === "duplicate" ? (
            <div className="mt-1 space-y-2">
              <p className="text-xs">{t("duplicate.message", { name: duplicateName })}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" disabled={item.resolving} onClick={() => void queue.reuseExisting(item.id)}>
                  {t("duplicate.useExisting")}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => queue.uploadAnyway(item.id)}>
                  {t("duplicate.uploadAnyway")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1">
          {item.status === "failed" && item.error?.retryable ? (
            <Button type="button" size="sm" variant="outline" onClick={() => queue.retry(item.id)} aria-label={t("retryFile", { name })}>
              <RotateCcwIcon />
              {t("retry")}
            </Button>
          ) : null}
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => queue.remove(item.id)} aria-label={t("removeFile", { name })}>
            <XIcon />
          </Button>
        </div>
      </div>
    </li>
  );
}
