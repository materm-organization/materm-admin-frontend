"use client";

import Link from "next/link";
import { useFormatter, useTranslations, type DateTimeFormatOptions } from "next-intl";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DISPLAY_TIME_ZONE } from "@/lib/datetime";
import { buildCalendar, queueRowHref, queueRowKey, queueScheduleHealth, type CalendarDay } from "@/lib/publishing-queue";
import { cn } from "@/lib/utils";
import type { QueueScheduledItem } from "@/types/publishing-queue";

const CHIP: Record<"ok" | "running" | "overdue" | "failed", string> = {
  ok: "border-violet-500/40 bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  running: "border-violet-500/40 bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  overdue: "border-amber-500/50 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
};
// 2024-01-01 was a Monday: the header names of a Monday-first week.
const MONDAY = Date.UTC(2024, 0, 1, 12);

// The scheduled tab's calendar strip (SCR-39): the next 30 days in Asia/Vientiane (a Monday-first month grid), or the next 7 days (week).
// It shows the rows loaded for the current page; the list under it is the complete, ordered view. A row whose time has passed sits in today.
export function QueueCalendar({ items, now, total }: { items: QueueScheduledItem[]; now: number; total: number }) {
  const t = useTranslations("publishingQueue.calendar");
  const format = useFormatter();
  const [view, setView] = useState<"month" | "week">("month");
  const cal = useMemo(() => buildCalendar(items, now), [items, now]);
  const week = useMemo(() => buildCalendar(items, now, 7), [items, now]);

  const dayName = (ymd: string, options: DateTimeFormatOptions) => format.dateTime(new Date(`${ymd}T12:00:00+07:00`), { timeZone: DISPLAY_TIME_ZONE, ...options });
  const time = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { timeStyle: "short", timeZone: DISPLAY_TIME_ZONE }) : "");
  const perCell = view === "month" ? 2 : 6;

  const cell = (day: CalendarDay) => {
    const shown = day.items.slice(0, perCell);
    const hidden = day.items.length - shown.length;
    const label = dayName(day.date, { dateStyle: "medium" });
    return (
      <li
        key={day.date}
        role="listitem"
        aria-label={t("day", { date: label, count: day.items.length })}
        data-testid="calendar-day"
        data-date={day.date}
        data-count={day.items.length}
        data-today={day.isToday}
        className={cn("min-h-20 min-w-0 rounded-md border p-1.5 text-xs", day.inRange ? "bg-card" : "border-dashed bg-muted/30 text-muted-foreground/60", day.isToday && "border-primary")}
      >
        {day.inRange ? (
          <>
            <p className={cn("mb-1 font-medium tabular-nums", day.isToday ? "text-foreground" : "text-muted-foreground")}>
              {view === "week" ? dayName(day.date, { weekday: "short", day: "numeric", month: "short" }) : dayName(day.date, { day: "numeric", month: "short" })}
            </p>
            <ul className="space-y-1">
              {shown.map((row) => {
                const health = queueScheduleHealth(row);
                return (
                  <li key={queueRowKey(row)}>
                    <Link
                      href={queueRowHref(row)}
                      data-testid="calendar-item"
                      data-health={health}
                      className={cn("block truncate rounded border px-1 py-0.5 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring", CHIP[health])}
                      title={row.title}
                    >
                      {health === "failed" ? `${t("failed")} ` : health === "overdue" ? `${t("overdue")} ` : `${time(row.run_at)} `}
                      {row.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {hidden > 0 ? <p className="mt-1 text-muted-foreground">{t("more", { count: hidden })}</p> : null}
          </>
        ) : (
          <span className="sr-only">{label}</span>
        )}
      </li>
    );
  };

  return (
    <Card className="shadow-none" data-testid="queue-calendar">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base">{t("title")}</CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </div>
          <div className="flex gap-1.5" role="group" aria-label={t("view")}>
            <Button type="button" size="sm" variant={view === "month" ? "default" : "outline"} aria-pressed={view === "month"} onClick={() => setView("month")}>
              {t("days30")}
            </Button>
            <Button type="button" size="sm" variant={view === "week" ? "default" : "outline"} aria-pressed={view === "week"} onClick={() => setView("week")}>
              {t("week")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 overflow-x-auto">
        <div className="min-w-[44rem] space-y-2">
        {view === "month" ? (
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground" aria-hidden>
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i}>{format.dateTime(new Date(MONDAY + i * 86_400_000), { weekday: "short", timeZone: "UTC" })}</span>
            ))}
          </div>
        ) : null}
        <ul role="list" className="grid grid-cols-7 gap-1" data-testid="calendar-grid" data-view={view}>
          {view === "month" ? cal.weeks.flat().map(cell) : week.weeks.flat().filter((d) => d.inRange).map(cell)}
        </ul>
        </div>
        {cal.unplaced.length > 0 ? <p className="text-xs text-muted-foreground">{t("unplaced", { count: cal.unplaced.length })}</p> : null}
        {cal.later.length > 0 ? <p className="text-xs text-muted-foreground">{t("later", { count: cal.later.length })}</p> : null}
        {total > items.length ? <p className="text-xs text-muted-foreground">{t("truncated", { shown: items.length, count: total })}</p> : null}
      </CardContent>
    </Card>
  );
}
