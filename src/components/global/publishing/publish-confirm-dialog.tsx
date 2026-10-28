"use client";

import { AlertTriangleIcon, RocketIcon } from "lucide-react";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";

import { fieldLabel, issueMessage } from "@/components/global/publishing/publish-blockers-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { PublishIssue } from "@/types/publishing";

// The last step of a publish (doc/07 section 3.24): the dry run passed, so say what will happen - the languages that
// are not complete (they use the fallback language), the warnings that do not stop the publish - and ask.
export function PublishConfirmDialog({
  open,
  onOpenChange,
  warnings,
  noun,
  hasChanges,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // From the dry run: `translation_incomplete` per language and other notes.
  warnings: PublishIssue[];
  noun: string;
  // A published entity with a pending draft: "publish the changes".
  hasChanges: boolean;
  isPending: boolean;
  onConfirm: (changeNote: string | undefined) => void | Promise<void>;
}) {
  const t = useTranslations("publishing.confirm");
  const tp = useTranslations("publishing");
  const noteId = useId();
  const [note, setNote] = useState("");
  const languages = warnings.filter((w) => w.code === "translation_incomplete");
  const others = warnings.filter((w) => w.code !== "translation_incomplete");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending) return;
        if (!next) setNote("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="md:max-w-lg" data-testid="publish-confirm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RocketIcon className="size-5" aria-hidden />
            {hasChanges ? t("titleChanges", { noun }) : t("title", { noun })}
          </DialogTitle>
          <DialogDescription>{hasChanges ? t("descriptionChanges", { noun }) : t("description", { noun })}</DialogDescription>
        </DialogHeader>

        {languages.length > 0 ? (
          <section aria-label={t("languages")} className="space-y-1.5 rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
            <h3 className="flex items-center gap-1.5 font-semibold">
              <AlertTriangleIcon className="size-4" aria-hidden />
              {t("languages")}
            </h3>
            <ul className="list-disc space-y-0.5 ps-5">
              {languages.map((w) => (
                <li key={w.path} data-testid="publish-language-line">
                  {t("languageLine", { locale: String(w.params?.locale ?? ""), missing: Number(w.params?.missing ?? 0) })}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {others.length > 0 ? (
          <section aria-label={t("warnings")} className="space-y-1.5 rounded-md border bg-muted/40 p-3 text-sm">
            <h3 className="font-semibold">{t("warnings")}</h3>
            <ul className="list-disc space-y-0.5 ps-5">
              {others.map((w, i) => {
                const { field, locale } = fieldLabel(tp, w);
                return (
                  <li key={`${w.path}-${w.code}-${i}`} data-testid="publish-warning">
                    {field ? <span className="font-medium">{field}{locale ? ` (${locale})` : ""}: </span> : null}
                    {issueMessage(tp, w)}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor={noteId}>{t("note")}</Label>
          <Input id={noteId} maxLength={200} value={note} disabled={isPending} placeholder={t("notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" disabled={isPending} onClick={() => void onConfirm(note.trim() || undefined)}>
            {isPending ? <Spinner /> : <RocketIcon />}
            {hasChanges ? t("confirmChanges") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
