"use client";

import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useMutationCreateAlbum } from "@/hooks/use-albums";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { MAX_ALBUM_KEY, MAX_ALBUM_TITLE, charCount, keyFromTitle, keyProblem } from "@/lib/albums";
import type { ApiFieldError } from "@/types/api";
import type { CreateAlbumPayload } from "@/types/albums";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; defaultLocale: string };

// SCR-28 "New album" (doc/07 section 3.17, T1.5.6): the key (a letter first, lower case, `-` and `_`; it can not be changed later) and the
// title in the default language. The key is suggested from the title until it is typed by hand. On success the new draft opens in the
// editor. One Idempotency-Key per open of the dialog.
export function AlbumCreateDialog({ open, onOpenChange, defaultLocale }: Props) {
  const t = useTranslations("albums.create");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {open ? <CreateForm open={open} onClose={() => onOpenChange(false)} defaultLocale={defaultLocale} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ open, onClose, defaultLocale }: { open: boolean; onClose: () => void; defaultLocale: string }) {
  const t = useTranslations("albums.create");
  const tErr = useTranslations("errors");
  const router = useRouter();
  const ids = { title: useId(), key: useId() };
  const { toastError } = useApiErrorHandler();
  const create = useMutationCreateAlbum();
  const idempotencyKey = useIdempotencyKey(open);

  const [title, setTitle] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<ApiFieldError[]>([]);

  const trimmed = title.trim();
  const titleProblem = !trimmed ? "required" : charCount(trimmed) > MAX_ALBUM_TITLE ? "too_long" : null;
  const keyIssue = key === "" ? "required" : keyProblem(key);
  const serverTitle = serverErrors.find((e) => e.path.endsWith("/title"));
  const serverKey = serverErrors.find((e) => e.path === "/key");
  const titleError = serverTitle ? translateFieldError(tErr as never, serverTitle) : submitted && titleProblem ? t(`errors.title.${titleProblem}`, { max: MAX_ALBUM_TITLE }) : null;
  const keyError = serverKey ? (serverKey.code === "duplicate" ? t("errors.key.taken") : translateFieldError(tErr as never, serverKey)) : submitted && keyIssue ? t(`errors.key.${keyIssue}`, { max: MAX_ALBUM_KEY }) : null;

  const submit = async () => {
    setSubmitted(true);
    if (titleProblem || keyIssue) return;
    const payload: CreateAlbumPayload = { key, translations: { [defaultLocale]: { title: trimmed } } };
    try {
      const result = await create.mutateAsync({ payload, idempotencyKey });
      toast.success(t("created"));
      onClose();
      router.push(`/admin/galleries/${result.data.data.id}`);
    } catch (error) {
      const parsed = parseApiError(error);
      if ((parsed.status === 422 || parsed.status === 409) && parsed.fieldErrors.length > 0) setServerErrors(parsed.fieldErrors);
      else toastError(error, t("failed"));
    }
  };

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={ids.title}>{t("titleLabel", { locale: defaultLocale.toUpperCase() })}</Label>
        <Input
          id={ids.title}
          value={title}
          autoComplete="off"
          autoFocus
          disabled={create.isPending}
          aria-invalid={Boolean(titleError)}
          onChange={(e) => {
            setTitle(e.target.value);
            if (!keyTouched) setKey(keyFromTitle(e.target.value));
            setServerErrors([]);
          }}
        />
        {titleError ? <p role="alert" className="text-sm text-destructive">{titleError}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={ids.key}>{t("keyLabel")}</Label>
        <Input
          id={ids.key}
          value={key}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
          disabled={create.isPending}
          aria-invalid={Boolean(keyError)}
          onChange={(e) => {
            setKey(e.target.value);
            setKeyTouched(true);
            setServerErrors((list) => list.filter((x) => x.path !== "/key"));
          }}
        />
        {keyError ? <p role="alert" className="text-sm text-destructive">{keyError}</p> : <p className="text-xs text-muted-foreground">{t("keyHint")}</p>}
      </div>

      {serverErrors.length > 0 && !serverTitle && !serverKey ? (
        <Alert variant="destructive">
          <AlertDescription>{serverErrors.map((e) => translateFieldError(tErr as never, e)).join(" ")}</AlertDescription>
        </Alert>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" disabled={create.isPending} onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? <Spinner /> : <PlusIcon />}
          {t("submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
