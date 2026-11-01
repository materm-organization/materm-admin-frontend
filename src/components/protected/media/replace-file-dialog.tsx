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
import { acceptAttribute, checkFile, mapUploadError, type UploadError } from "@/lib/media-upload";

// FR-MEDIA-08: "Replace file" of the asset sheet (`media.library:update`, `If-Match` = the asset's ETag). The id and
// every place the file is used stay; 409 `CONFLICT_LOCK_VERSION` goes to the sheet's ConflictDialog (`onConflict`).
export function ReplaceFileDialog({
  open,
  onOpenChange,
  assetId,
  etag,
  onConflict,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetId: number;
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

  const choose = (next: File | null) => {
    setFile(next);
    setProgress(0);
    setError(next ? checkFile(next, { allowSvg: true }) : null);
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
            accept={acceptAttribute(true)}
            disabled={pending}
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
          {file ? (
            <p className="text-xs text-muted-foreground">
              {t("chosen", { name: file.name })} · {formatBytes(file.size)}
            </p>
          ) : null}
          {pending ? (
            <div className="space-y-1" role="status" aria-live="polite">
              <Progress value={progress} aria-label={t("uploading", { percent: progress })} />
              <p className="text-xs text-muted-foreground">{t("uploading", { percent: progress })}</p>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {tUpload(`errors.${error.kind}`)}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" disabled={!file || Boolean(error && !error.retryable) || pending} onClick={() => void submit()}>
            {pending ? <Spinner aria-hidden /> : null}
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
