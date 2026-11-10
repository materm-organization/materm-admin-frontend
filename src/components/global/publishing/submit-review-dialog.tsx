"use client";

import { SendIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";

// D1 (doc/05 12.10): draft -> in review, with an optional message (<= 200) to the reviewer. The publish rules are NOT checked here: the reviewer
// finds out at publish time. One `Idempotency-Key` per open; the note is gone after close.
export function SubmitReviewDialog({
  open,
  onOpenChange,
  noun,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noun: string;
  isPending: boolean;
  onConfirm: (note: string | undefined, idempotencyKey: string) => void | Promise<void>;
}) {
  const key = useIdempotencyKey(open);
  const t = useTranslations("publishing.review.submit");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="md:max-w-lg" data-testid="submit-review-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SendIcon className="size-5" aria-hidden />
            {t("title", { noun })}
          </DialogTitle>
          <DialogDescription>{t("description", { noun })}</DialogDescription>
        </DialogHeader>
        {open ? <SubmitForm isPending={isPending} onCancel={() => onOpenChange(false)} onSubmit={(note) => onConfirm(note, key)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SubmitForm({ isPending, onCancel, onSubmit }: { isPending: boolean; onCancel: () => void; onSubmit: (note: string | undefined) => void | Promise<void> }) {
  const t = useTranslations("publishing.review.submit");
  const tc = useTranslations("publishing.confirm");
  const id = useId();
  const [note, setNote] = useState("");
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={id}>{t("noteLabel")}</Label>
        <Input id={id} maxLength={200} value={note} disabled={isPending} placeholder={t("notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={isPending} onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button type="button" disabled={isPending} onClick={() => void onSubmit(note.trim() || undefined)}>
          {isPending ? <Spinner /> : <SendIcon />}
          {t("confirm")}
        </Button>
      </DialogFooter>
    </>
  );
}
