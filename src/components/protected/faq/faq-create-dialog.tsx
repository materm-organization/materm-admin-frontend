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
import { useMutationCreateFaqGroup } from "@/hooks/use-faq";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { MAX_FAQ_KEY, MAX_FAQ_NAME, charCount, keyFromName, keyProblem } from "@/lib/faq";
import type { ApiFieldError } from "@/types/api";

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

// SCR-30 "New group" (doc/07 section 3.18, T1.5.6): the internal name (not translated, not shown on the website) and the key (a letter
// first; it can not be changed later and is what a FAQ section names in `group_key`). The key follows the name until it is typed by hand.
export function FaqCreateDialog({ open, onOpenChange }: Props) {
  const t = useTranslations("faq.create");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {open ? <CreateForm open={open} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("faq.create");
  const tErr = useTranslations("errors");
  const router = useRouter();
  const ids = { name: useId(), key: useId() };
  const { toastError } = useApiErrorHandler();
  const create = useMutationCreateFaqGroup();
  const idempotencyKey = useIdempotencyKey(open);

  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<ApiFieldError[]>([]);

  const trimmed = name.trim();
  const nameProblem = !trimmed ? "required" : charCount(trimmed) > MAX_FAQ_NAME ? "too_long" : null;
  const keyIssue = key === "" ? "required" : keyProblem(key);
  const serverName = serverErrors.find((e) => e.path === "/name");
  const serverKey = serverErrors.find((e) => e.path === "/key");
  const nameError = serverName ? translateFieldError(tErr as never, serverName) : submitted && nameProblem ? t(`errors.name.${nameProblem}`, { max: MAX_FAQ_NAME }) : null;
  const keyError = serverKey ? (serverKey.code === "duplicate" ? t("errors.key.taken") : translateFieldError(tErr as never, serverKey)) : submitted && keyIssue ? t(`errors.key.${keyIssue}`, { max: MAX_FAQ_KEY }) : null;

  const submit = async () => {
    setSubmitted(true);
    if (nameProblem || keyIssue) return;
    try {
      const result = await create.mutateAsync({ payload: { key, name: trimmed }, idempotencyKey });
      toast.success(t("created"));
      onClose();
      router.push(`/admin/faq/${result.data.data.id}`);
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
        <Label htmlFor={ids.name}>{t("nameLabel")}</Label>
        <Input
          id={ids.name}
          value={name}
          autoComplete="off"
          autoFocus
          disabled={create.isPending}
          aria-invalid={Boolean(nameError)}
          onChange={(e) => {
            setName(e.target.value);
            if (!keyTouched) setKey(keyFromName(e.target.value));
            setServerErrors([]);
          }}
        />
        {nameError ? <p role="alert" className="text-sm text-destructive">{nameError}</p> : <p className="text-xs text-muted-foreground">{t("nameHint")}</p>}
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
      {serverErrors.length > 0 && !serverName && !serverKey ? (
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
