"use client";

import { CalendarClockIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { DateTimeField } from "@/components/global/date-time-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { DISPLAY_TIME_ZONE } from "@/lib/datetime";
import { checkScheduleTime, scheduleBounds, type ScheduleProblem } from "@/lib/publishing-schedule";
import type { PublishIssue } from "@/types/publishing";

// "schedule" = a new schedule, "reschedule" = move the time of a scheduled entity, "changes" = apply the pending draft of a published entity later.
export type ScheduleDialogMode = "schedule" | "reschedule" | "changes";

// D1 (doc/05 12.10, doc/07 2.5.7): pick the time an entity goes live. The publish DRY RUN already passed (the host runs it first, so the blockers show
// before this opens); `warnings` are its non-blocking notes. The server checks the rules again. The picked time is read as wall-clock time in
// Asia/Vientiane and sent as an RFC 3339 instant. One `Idempotency-Key` per open (a retry of the same dialog reuses it); nothing is kept after close.
export function ScheduleDialog({
  open,
  onOpenChange,
  mode,
  noun,
  warnings,
  currentRunAt,
  isPending,
  problem,
  onClearProblem,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ScheduleDialogMode;
  noun: string;
  warnings: PublishIssue[];
  // The time the entity is scheduled for now (a reschedule starts from it while it is still in the future).
  currentRunAt?: string | null;
  isPending: boolean;
  // A refusal the dialog explains in place (out_of_range, 429).
  problem: ScheduleProblem | null;
  onClearProblem: () => void;
  onConfirm: (scheduledAt: string, idempotencyKey: string) => void | Promise<void>;
}) {
  const key = useIdempotencyKey(open);
  const t = useTranslations("publishing.schedule");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="md:max-w-lg" data-testid="schedule-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClockIcon className="size-5" aria-hidden />
            {t(`dialog.title.${mode}`, { noun })}
          </DialogTitle>
          <DialogDescription>{t(`dialog.description.${mode}`, { noun })}</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open: the picked time is gone after close. */}
        {open ? (
          <ScheduleForm
            mode={mode}
            warnings={warnings}
            currentRunAt={currentRunAt ?? null}
            isPending={isPending}
            problem={problem}
            onClearProblem={onClearProblem}
            onCancel={() => onOpenChange(false)}
            onSubmit={(iso) => onConfirm(iso, key)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ScheduleForm({
  mode,
  warnings,
  currentRunAt,
  isPending,
  problem,
  onClearProblem,
  onCancel,
  onSubmit,
}: {
  mode: ScheduleDialogMode;
  warnings: PublishIssue[];
  currentRunAt: string | null;
  isPending: boolean;
  problem: ScheduleProblem | null;
  onClearProblem: () => void;
  onCancel: () => void;
  onSubmit: (scheduledAt: string) => void | Promise<void>;
}) {
  const t = useTranslations("publishing.schedule");
  const tc = useTranslations("publishing.confirm");
  const format = useFormatter();
  const fieldId = useId();
  const [opened] = useState(() => Date.now());
  const [value, setValue] = useState<string | null>(() => (currentRunAt && Date.parse(currentRunAt) > opened ? new Date(currentRunAt).toISOString() : null));
  const [attempted, setAttempted] = useState(false);
  const [clientError, setClientError] = useState<"empty" | "invalid" | "too_soon" | "too_far" | null>(null);

  const when = (d: Date | string) => format.dateTime(new Date(d), { dateStyle: "medium", timeStyle: "short", timeZone: DISPLAY_TIME_ZONE });
  const bounds = scheduleBounds(opened);
  const languages = warnings.filter((w) => w.code === "translation_incomplete");

  const submit = () => {
    setAttempted(true);
    // Checked against the clock at the moment of the click: the minute may have passed while the dialog was open.
    const check = checkScheduleTime(value, Date.now());
    if (check !== "ok" || !value) {
      setClientError(check === "ok" ? "empty" : check);
      return;
    }
    setClientError(null);
    void onSubmit(value);
  };

  let errorText: string | null = null;
  if (clientError) errorText = t(`errors.${clientError}`);
  else if (problem?.kind === "range") errorText = problem.min && problem.max ? t("errors.serverRange", { min: when(problem.min), max: when(problem.max) }) : t("errors.range");
  else if (problem?.kind === "required") errorText = t("errors.empty");
  else if (problem?.kind === "format") errorText = t("errors.invalid");
  else if (problem?.kind === "rate") {
    const seconds = problem.retryAfter ?? 60;
    errorText = seconds >= 60 ? t("errors.rateMinutes", { minutes: Math.ceil(seconds / 60) }) : t("errors.rateSeconds", { seconds });
  }

  return (
    <>
      {languages.length > 0 ? (
        <section aria-label={tc("languages")} className="space-y-1.5 rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
          <h3 className="font-semibold">{tc("languages")}</h3>
          <ul className="list-disc space-y-0.5 ps-5">
            {languages.map((w) => (
              <li key={w.path}>{tc("languageLine", { locale: String(w.params?.locale ?? ""), missing: Number(w.params?.missing ?? 0) })}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor={fieldId}>{t("dialog.timeLabel")}</Label>
        <DateTimeField
          id={fieldId}
          value={value}
          disabled={isPending}
          aria-label={t("dialog.timeLabel")}
          onChange={(next) => {
            setValue(next);
            setClientError(null);
            onClearProblem();
          }}
        />
        <p className="text-xs text-muted-foreground" data-testid="schedule-range-hint">
          {t("dialog.rangeHint", { min: when(bounds.min), max: when(bounds.max) })}
        </p>
        {errorText && (attempted || problem) ? (
          <p role="alert" className="text-sm text-destructive" data-testid="schedule-error">
            {errorText}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" disabled={isPending} onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button type="button" disabled={isPending || value === null} onClick={submit}>
          {isPending ? <Spinner /> : <CalendarClockIcon />}
          {t(`dialog.confirm.${mode}`)}
        </Button>
      </DialogFooter>
    </>
  );
}
