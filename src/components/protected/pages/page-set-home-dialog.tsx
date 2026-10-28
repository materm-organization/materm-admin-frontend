"use client";

import { HouseIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { pathProblem } from "@/components/protected/pages/page-draft";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useMutationSetHome, usePages } from "@/hooks/use-pages";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { pageEtag } from "@/services/pages.api";
import type { PageListItem } from "@/types/pages";

// "Make this the home page" (05 12.3.6): atomic - the page takes `/` and the current home page moves to another address
// (default `/<key>`, editable here: it stays published). One Idempotency-Key per open. `onStale` is called when the row
// the user clicked is out of date (409 lock / INVALID_STATE): the list reloads.
export function PageSetHomeDialog({ page, onClose, onStale }: { page: PageListItem | null; onClose: () => void; onStale: () => void }) {
  return (
    <Dialog open={page !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="md:max-w-md">{page ? <Form page={page} onClose={onClose} onStale={onStale} /> : null}</DialogContent>
    </Dialog>
  );
}

function Form({ page, onClose, onStale }: { page: PageListItem; onClose: () => void; onStale: () => void }) {
  const t = useTranslations("pages.setHome");
  const tErr = useTranslations("errors");
  const inputId = useId();
  const { toastError } = useApiErrorHandler();
  const home = usePages({ is_home: true, limit: 1 });
  const oldHome = home.data?.data[0];
  const mutation = useMutationSetHome();
  const key = useIdempotencyKey(true);
  const defaultPrevious = oldHome ? `/${oldHome.key.replace(/_/g, "-")}` : "";
  const [typed, setTyped] = useState<string | null>(null);
  const previous = typed ?? defaultPrevious;
  const [serverError, setServerError] = useState<string | null>(null);
  const problem = oldHome && typed !== null ? pathProblem(previous) : null;

  const submit = async () => {
    setServerError(null);
    try {
      await mutation.mutateAsync({ id: page.id, etag: pageEtag(page), previousHomePath: typed !== null && previous ? previous : undefined, idempotencyKey: key });
      toast.success(t("done", { title: page.title ?? page.name }));
      onClose();
    } catch (error) {
      const parsed = parseApiError(error);
      if (isConflictError(error) || (parsed.code === "INVALID_STATE" && parsed.status === 409)) {
        const reason = String(parsed.details?.reason ?? "");
        toast.error(isConflictError(error) ? t("stale") : t.has(`invalidState.${reason}`) ? t(`invalidState.${reason}`) : t("stale"));
        onClose();
        onStale();
      } else if (parsed.code === "CONFLICT_DUPLICATE") {
        setServerError(t("pathTaken"));
      } else if (parsed.status === 422 && parsed.fieldErrors.length > 0) {
        setServerError(t("pathInvalid"));
      } else toastError(error, t("failed"));
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <HouseIcon className="size-5" aria-hidden />
          {t("title", { title: page.title ?? page.name })}
        </DialogTitle>
        <DialogDescription>{t("description", { path: page.path })}</DialogDescription>
      </DialogHeader>
      {oldHome ? (
        <div className="space-y-1.5">
          <Label htmlFor={inputId}>{t("previousLabel", { title: oldHome.title ?? oldHome.name })}</Label>
          <Input
            id={inputId}
            value={previous}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            disabled={mutation.isPending}
            aria-invalid={Boolean(problem || serverError)}
            onChange={(e) => {
              setServerError(null);
              setTyped(e.target.value);
            }}
          />
          {problem ? <p className="text-sm text-destructive">{tErr("fields.pattern_mismatch")}</p> : serverError ? <p className="text-sm text-destructive">{serverError}</p> : <p className="text-xs text-muted-foreground">{t("previousHint")}</p>}
        </div>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button type="button" disabled={mutation.isPending || Boolean(problem) || home.isLoading} onClick={() => void submit()}>
          {mutation.isPending ? <Spinner /> : <HouseIcon />}
          {t("confirm")}
        </Button>
      </DialogFooter>
    </>
  );
}
