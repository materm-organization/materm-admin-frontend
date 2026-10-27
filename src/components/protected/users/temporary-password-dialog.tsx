"use client";

import { CheckIcon, CopyIcon, KeyRoundIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

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

// Shows the one-time temporary password of a freshly created user. The value
// only lives in the parent's React state for as long as this dialog is open —
// it is never put in the query cache, storage, the URL or a log. Not
// dismissable by Esc / outside click (an accidental click would lose the
// password for good): the admin confirms with "Done".
export function TemporaryPasswordDialog({
  username,
  password,
  onDone,
}: {
  username: string;
  // null = the server did not return one (e.g. an idempotent replay).
  password: string | null;
  onDone: () => void;
}) {
  const t = useTranslations("users.temporaryPassword");
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!password) return;
    let ok = false;
    try {
      // Async clipboard API needs a secure context (https / localhost).
      await navigator.clipboard.writeText(password);
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
        className="md:max-w-md [&>button]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-5" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description", { username })}</DialogDescription>
        </DialogHeader>

        {password ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="temporary-password">{t("label")}</Label>
              <div className="flex gap-2">
                <Input
                  id="temporary-password"
                  ref={inputRef}
                  readOnly
                  value={password}
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
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <span>{t("onceWarning")}</span>
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
        )}

        <DialogFooter>
          <Button type="button" onClick={onDone}>
            {t("done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
