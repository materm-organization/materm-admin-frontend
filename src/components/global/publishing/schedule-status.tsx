"use client";

import { AlertTriangleIcon, CalendarClockIcon, XCircleIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { DISPLAY_TIME_ZONE } from "@/lib/datetime";
import type { ScheduleHealth } from "@/lib/publishing-schedule";
import { cn } from "@/lib/utils";
import type { ScheduleInfo } from "@/types/publishing";

// The "Scheduled for ..." line under the status chip of the PublishBar (D1, doc/07 2.5.7): the time in Asia/Vientiane, and the two variants that
// need attention - overdue (the time has passed and the server has not fired yet) and failed (the server tried 3 times and gave up, with its
// short reason). `action = apply_revision` is a PUBLISHED entity whose pending draft goes live at that time.
export function ScheduleStatusLine({
  schedule,
  scheduledAt,
  health,
  className,
}: {
  schedule: ScheduleInfo | null | undefined;
  // The root's `scheduled_at`, the fallback when the detail carries no `schedule` member.
  scheduledAt?: string | null;
  health: ScheduleHealth;
  className?: string;
}) {
  const t = useTranslations("publishing.schedule.status");
  const format = useFormatter();
  const runAt = schedule?.run_at ?? scheduledAt ?? null;
  if (!runAt || Number.isNaN(Date.parse(runAt))) return null;
  const when = format.dateTime(new Date(runAt), { dateStyle: "medium", timeStyle: "short", timeZone: DISPLAY_TIME_ZONE });
  const changes = schedule?.action === "apply_revision";

  let text: string;
  let tone = "text-violet-900 dark:text-violet-200";
  let Icon = CalendarClockIcon;
  if (health === "failed") {
    text = t(changes ? "failedChanges" : "failed", { when, attempts: schedule?.attempts ?? 0 });
    tone = "text-destructive";
    Icon = XCircleIcon;
  } else if (health === "overdue") {
    text = t(changes ? "overdueChanges" : "overdue", { when });
    tone = "text-amber-900 dark:text-amber-200";
    Icon = AlertTriangleIcon;
  } else if (health === "running") {
    text = t("running");
  } else {
    text = t(changes ? "changesAt" : "scheduledFor", { when });
  }

  return (
    <div className={cn("space-y-0.5 text-sm", className)} data-testid="schedule-status" data-health={health}>
      <p className={cn("flex items-start gap-1.5 font-medium", tone)}>
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {text} <span className="font-normal text-muted-foreground">({t("zone")})</span>
        </span>
      </p>
      {health === "failed" ? (
        <p className="ps-5.5 text-muted-foreground">
          {schedule?.last_error ? <span data-testid="schedule-last-error">{t("reason", { reason: schedule.last_error })} </span> : null}
          {t("failedHint")}
        </p>
      ) : null}
    </div>
  );
}
