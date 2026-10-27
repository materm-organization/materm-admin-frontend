"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

// Confirmation for destructive / immediate actions (doc/07 section 2.5.4), wrapping `AlertDialog`:
// title, the consequence in the description, a destructive confirm button. `requireTyping="<name or code>"`
// is for irreversible or wide-reaching actions (delete a role, revoke an API key, anonymise a submission,
// delete a language): the confirm button stays disabled until the exact text is typed. The dialog stays open
// while `onConfirm` runs (a returned promise) and only closes when it resolves; if it throws, the dialog
// stays open so the caller can show the error.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  requireTyping,
  onConfirm,
  isPending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  requireTyping?: string;
  onConfirm: () => void | Promise<void>;
  isPending?: boolean;
}) {
  const t = useTranslations("dialogs.confirm");
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [running, setRunning] = useState(false);

  const busy = isPending || running;
  const typingOk = !requireTyping || typed === requireTyping;

  const close = (next: boolean) => {
    if (busy) return;
    if (!next) setTyped("");
    onOpenChange(next);
  };

  const confirm = async () => {
    if (!typingOk || busy) return;
    setRunning(true);
    try {
      await onConfirm();
      setTyped("");
      onOpenChange(false);
    } catch {
      // Stay open: the caller reports the failure (toast / form error).
    } finally {
      setRunning(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>

        {requireTyping ? (
          <div className="space-y-2">
            <Label htmlFor={inputId}>
              {t("typeToConfirm", { value: requireTyping })}
            </Label>
            <Input
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              className="font-mono"
            />
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel ?? t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={!typingOk || busy}
            onClick={(e) => {
              // Radix closes the dialog on click; keep it open until `onConfirm` is done.
              e.preventDefault();
              void confirm();
            }}
            variant={destructive ? "destructive" : "default"}
          >
            {busy ? <Spinner /> : null}
            {confirmLabel ?? t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
