"use client";

import { CalendarIcon, XIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DISPLAY_TIME_ZONE, isoToZonedParts, zonedPartsToIso } from "@/lib/datetime";
import { cn } from "@/lib/utils";

// "2026-10-27" -> a Date at local midnight with the same year/month/day (react-day-picker works on the
// browser's calendar days; only the Y-M-D matters, they are read back the same way).
function ymdToCalendarDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function calendarDateToYmd(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// A date + time picker for ONE instant (schedule a publish, set a time). Doc/07 sections 5.2 and 6.2:
//  - `value` / `onChange` are RFC 3339 UTC strings (what the API takes), or null for "not set";
//  - what the user picks and sees is wall-clock time in the FIXED zone Asia/Vientiane (UTC+7), never the
//    browser's zone — the field says so and shows the UTC value it will send;
//  - a half-filled field (date without time or the reverse) is kept as a draft and `onChange` fires only once
//    both exist (time defaults to 00:00 when a date is chosen first).
export function DateTimeField({
  value,
  onChange,
  disabled = false,
  id,
  "aria-label": ariaLabel,
  placeholder,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  placeholder?: string;
}) {
  const t = useTranslations("dateTimeField");
  const format = useFormatter();
  const autoId = useId();
  const timeId = `${id ?? autoId}-time`;
  const [open, setOpen] = useState(false);
  // Only used while `value` is null (picking in progress).
  const [draft, setDraft] = useState<{ date?: string; time: string }>({ time: "00:00" });

  const parts = value ? isoToZonedParts(value) : null;
  const date = parts?.date ?? draft.date;
  const time = parts?.time ?? draft.time;

  const commit = (nextDate: string | undefined, nextTime: string) => {
    if (!nextDate) {
      setDraft({ date: undefined, time: nextTime });
      return;
    }
    const iso = zonedPartsToIso(nextDate, nextTime);
    if (iso) {
      onChange(iso);
    } else {
      // Time cleared / invalid: keep the date as a draft until the time is valid again.
      setDraft({ date: nextDate, time: nextTime });
      onChange(null);
    }
  };

  const clear = () => {
    setDraft({ date: undefined, time: "00:00" });
    onChange(null);
  };

  const label = value
    ? format.dateTime(new Date(value), {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: DISPLAY_TIME_ZONE,
      })
    : (placeholder ?? t("pick"));

  return (
    <div className="inline-flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={ariaLabel}
            className={cn("justify-start font-normal", !value && "text-muted-foreground")}
          >
            <CalendarIcon />
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto space-y-3 p-3" align="start">
          <Calendar
            mode="single"
            selected={date ? ymdToCalendarDate(date) : undefined}
            defaultMonth={date ? ymdToCalendarDate(date) : undefined}
            onSelect={(picked) => {
              if (picked) commit(calendarDateToYmd(picked), time);
            }}
          />
          <div className="space-y-1 px-1">
            <Label htmlFor={timeId}>{t("time")}</Label>
            <Input
              id={timeId}
              type="time"
              value={time}
              onChange={(e) => commit(date, e.target.value)}
            />
          </div>
          <p className="px-1 text-xs text-muted-foreground">
            {t("timezoneNote", { timezone: `${DISPLAY_TIME_ZONE} (UTC+7)` })}
            {value ? (
              <>
                <br />
                {t("utcValue", { value })}
              </>
            ) : null}
          </p>
          <div className="flex justify-end px-1">
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              {t("done")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={clear}
          aria-label={t("clear")}
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  );
}
