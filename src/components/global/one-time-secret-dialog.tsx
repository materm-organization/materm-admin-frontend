"use client";

import { CheckIcon, CopyIcon, KeyRoundIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";

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

// Shows a secret exactly once: a temporary password, an API key secret, a webhook secret (doc/07 section 1.1
// (6), BR-35, F-9). The value lives only in the parent's React state while this dialog is mounted — never in
// the query cache (`gcTime: 0` on the mutation + `reset()`), storage, the URL or a log. Not dismissable by
// Esc / outside click / a close button (an accidental click would lose the secret for good): the admin
// confirms with "Done". `secret === null` = the server did not return it (an idempotent replay): the
// `unavailable` text is shown instead and nothing can be copied.
//
// Mount it only while a secret is pending (`{issued ? <OneTimeSecretDialog …/> : null}`) and clear the
// parent state in `onDone`. Texts default to the generic `dialogs.oneTimeSecret.*` set; pass the page's own
// (`title`, `description`, `label`, `onceWarning`, `unavailable`) where the wording is specific.
export function OneTimeSecretDialog({
  secret,
  onDone,
  title,
  description,
  label,
  onceWarning,
  unavailable,
  doneLabel,
}: {
  secret: string | null;
  onDone: () => void;
  title?: string;
  description?: string;
  label?: string;
  onceWarning?: string;
  unavailable?: string;
  doneLabel?: string;
}) {
  const t = useTranslations("dialogs.oneTimeSecret");
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!secret) return;
    let ok = false;
    try {
      // Async clipboard API needs a secure context (https / localhost).
      await navigator.clipboard.writeText(secret);
      ok = true;
    } catch {
      // Fallback for plain-http LAN addresses: select + execCommand.
      inputRef.current?.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
    }
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        className="md:max-w-md"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-5" aria-hidden />
            {title ?? t("title")}
          </DialogTitle>
          <DialogDescription>{description ?? t("description")}</DialogDescription>
        </DialogHeader>

        {secret ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor={inputId}>{label ?? t("label")}</Label>
              <div className="flex gap-2">
                <Input
                  id={inputId}
                  ref={inputRef}
                  readOnly
                  value={secret}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button type="button" variant="outline" onClick={copy} aria-live="polite">
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? t("copied") : t("copy")}
                </Button>
              </div>
            </div>
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{onceWarning ?? t("onceWarning")}</span>
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{unavailable ?? t("unavailable")}</p>
        )}

        <DialogFooter>
          <Button type="button" onClick={onDone}>
            {doneLabel ?? t("done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
