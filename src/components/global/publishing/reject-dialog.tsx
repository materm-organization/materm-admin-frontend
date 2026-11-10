"use client";

import { Undo2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { MAX_COMMENT_LENGTH, type ScheduleProblem } from "@/lib/publishing-schedule";

// D1 (doc/05 12.10): send an `in_review` page / post back to draft with a REQUIRED comment (1..200 characters, counted as code points like the
// server). The comment becomes the change note of a History revision. One `Idempotency-Key` per open; the text lives only while the dialog is open.
export function RejectDialog({
  open,
  onOpenChange,
  noun,
  isPending,
  problem,
  onClearProblem,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noun: string;
  isPending: boolean;
  // 422 at `/comment` from the server (`commentRequired` / `commentTooLong`).
  problem: ScheduleProblem | null;
  onClearProblem: () => void;
  onConfirm: (comment: string, idempotencyKey: string) => void | Promise<void>;
}) {
  const key = useIdempotencyKey(open);
  const t = useTranslations("publishing.review.reject");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="md:max-w-lg" data-testid="reject-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2Icon className="size-5" aria-hidden />
            {t("title", { noun })}
          </DialogTitle>
          <DialogDescription>{t("description", { noun })}</DialogDescription>
        </DialogHeader>
        {open ? <RejectForm isPending={isPending} problem={problem} onClearProblem={onClearProblem} onCancel={() => onOpenChange(false)} onSubmit={(comment) => onConfirm(comment, key)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function RejectForm({
  isPending,
  problem,
  onClearProblem,
  onCancel,
  onSubmit,
}: {
  isPending: boolean;
  problem: ScheduleProblem | null;
  onClearProblem: () => void;
  onCancel: () => void;
  onSubmit: (comment: string) => void | Promise<void>;
}) {
  const t = useTranslations("publishing.review.reject");
  const tc = useTranslations("publishing.confirm");
  const id = useId();
  const [text, setText] = useState("");
  const count = [...text.trim()].length;
  const tooLong = count > MAX_COMMENT_LENGTH;
  const empty = count === 0;

  let error: string | null = null;
  if (tooLong) error = t("tooLong", { max: MAX_COMMENT_LENGTH });
  else if (problem?.kind === "commentRequired") error = t("required");
  else if (problem?.kind === "commentTooLong") error = t("tooLong", { max: MAX_COMMENT_LENGTH });

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={id}>{t("commentLabel")}</Label>
        <Textarea
          id={id}
          value={text}
          rows={4}
          required
          disabled={isPending}
          placeholder={t("commentPlaceholder")}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-count`}
          onChange={(e) => {
            setText(e.target.value);
            onClearProblem();
          }}
        />
        <div className="flex items-start justify-between gap-2 text-xs">
          <span role={error ? "alert" : undefined} className="text-destructive" data-testid="reject-error">
            {error}
          </span>
          <span id={`${id}-count`} className={tooLong ? "text-destructive" : "text-muted-foreground"} data-testid="reject-counter">
            {t("counter", { count, max: MAX_COMMENT_LENGTH })}
          </span>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={isPending} onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button type="button" disabled={isPending || empty || tooLong} onClick={() => void onSubmit(text.trim())}>
          {isPending ? <Spinner /> : <Undo2Icon />}
          {t("confirm")}
        </Button>
      </DialogFooter>
    </>
  );
}
