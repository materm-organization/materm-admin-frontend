"use client";

import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { useMutationReplaceMediaFile } from "@/hooks/use-media";
import { isConflictError } from "@/lib/api-error";
import { formatBytes } from "@/lib/media";
import { checkFile, errorTextParams, guessMime, mapUploadError, replaceAcceptAttribute, VIDEO_MIME, type UploadError } from "@/lib/media-upload";
import { probeMp4 } from "@/lib/mp4-probe";

// FR-MEDIA-08: "Replace file" of the asset sheet (`media.library:update`, `If-Match` = the asset's ETag). The id and
// every place the file is used stay; 409 `CONFLICT_LOCK_VERSION` goes to the sheet's ConflictDialog (`onConflict`).
export function ReplaceFileDialog({
  open,
  onOpenChange,
  assetId,
  kind,
  etag,
  onConflict,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetId: number;
  // The kind of the row being replaced: a video is replaced only by a video (server: 422 `kind_mismatch`).
  kind?: string;
  etag: string | undefined;
  onConflict: () => void;
}) {
  const t = useTranslations("media.sheet.replace");
  const tUpload = useTranslations("media.upload");
  const replace = useMutationReplaceMediaFile(assetId);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<UploadError | null>(null);

  const [checking, setChecking] = useState(false);
  const chosenRef = useRef<File | null>(null);
  const isVideoRow = kind === "video";

  const choose = (next: File | null) => {
    chosenRef.current = next;
    setFile(next);
    setProgress(0);
    setChecking(false);
    if (!next) {
      setError(null);
      return;
    }
    const isVideoFile = guessMime(next) === VIDEO_MIME;
    const local: UploadError | null =
      isVideoFile !== isVideoRow ? { kind: "kindMismatch", retryable: false } : checkFile(next, { allowSvg: true });
    setError(local);
    if (!local && isVideoFile) {
      // The MP4 pre-check (best effort); a late answer for a file the user has already replaced is ignored.
      setChecking(true);
      void probeMp4(next).then((found) => {
        if (chosenRef.current !== next) return;
        setChecking(false);
        if (found) setError(found);
      });
    }
  };

  const submit = async () => {
    if (!file || error) return;
    setError(null);
    setProgress(0);
    try {
      await replace.mutateAsync({ file, etag, onProgress: (p) => setProgress(p ?? 0) });
      toast.success(t("done"));
      onOpenChange(false);
    } catch (e) {
      if (isConflictError(e)) {
        onOpenChange(false);
        onConflict();
        return;
      }
      setError(mapUploadError(e));
    }
  };

  const pending = replace.isPending;
  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={inputId}>{t("fileLabel")}</Label>
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            accept={replaceAcceptAttribute(kind, true)}
            disabled={pending}
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
          {isVideoRow ? <p className="text-xs text-muted-foreground">{t("videoHint")}</p> : null}
          {file ? (
            <p className="text-xs text-muted-foreground">
              {t("chosen", { name: file.name })} · {formatBytes(file.size)}
            </p>
          ) : null}
          {pending && isVideoRow ? <p className="text-xs text-muted-foreground">{tUpload("videoSlow", { size: file ? formatBytes(file.size) : "" })}</p> : null}
          {pending ? (
            <div className="space-y-1" role="status" aria-live="polite">
              <Progress value={progress} aria-label={t("uploading", { percent: progress })} />
              <p className="text-xs text-muted-foreground">{t("uploading", { percent: progress })}</p>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {tUpload(`errors.${error.kind}`, errorTextParams(error))}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" disabled={!file || checking || Boolean(error && !error.retryable) || pending} onClick={() => void submit()}>
            {pending ? <Spinner aria-hidden /> : null}
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
