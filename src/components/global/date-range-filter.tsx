"use client";

// Date-range filter conventions:
//   - named export (matches KeywordFilter/SingleSelectFilter), not `export
//     default`.
//   - translations resolved through next-intl's `common.dateRangeFilter.*`
//     namespace (every global filter reads from `common`, see
//     KeywordFilter/SingleSelectFilter's `t = useTranslations("common")`).
//   - default `label` is a translation-key-driven fallback via the same
//     namespace instead of a hardcoded Lao literal.
//   - explicit `type="button"` on every button (the lint config flags
//     implicit submit buttons).
import React, { useMemo, useState } from "react";
import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { ChevronDown, CirclePlus, CircleX } from "lucide-react";
import { useTranslations } from "next-intl";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface DateRangeFilterProps {
  dateRange: { from: Date; to: Date } | undefined;
  setDateRange: React.Dispatch<React.SetStateAction<{ from: Date; to: Date } | undefined>>;
  onSearch?: () => void;
  label?: string;
  /**
   * Adds Start/End time-of-day inputs alongside the date pickers, and
   * preserves that time-of-day on the `from`/`to` Date objects instead of
   * always snapping to the start/end of the selected day. Off by default —
   * no current consumer needs it, kept for the first feature that needs
   * datetime-granularity filtering.
   */
  showTime?: boolean;
}

/** Applies an "HH:mm" string onto a date, minutes precision (no seconds UI). */
function mergeTime(date: Date, time: string): Date {
  const [hours, minutes] = time.split(":").map((v) => parseInt(v, 10) || 0);
  const merged = new Date(date);
  merged.setHours(hours, minutes, 0, 0);
  return merged;
}

const PRESET_KEYS = [
  "today",
  "yesterday",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "lastMonth",
  "last7Days",
  "last30Days",
] as const;

function getPresetRange(key: (typeof PRESET_KEYS)[number], today: Date): { from: Date; to: Date } {
  switch (key) {
    case "today":
      return { from: startOfDay(today), to: endOfDay(today) };
    case "yesterday": {
      const y = subDays(today, 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case "thisWeek":
      return { from: startOfWeek(today, { weekStartsOn: 0 }), to: endOfDay(today) };
    case "lastWeek": {
      const lastWeekStart = subWeeks(startOfWeek(today, { weekStartsOn: 0 }), 1);
      return { from: lastWeekStart, to: endOfWeek(lastWeekStart, { weekStartsOn: 0 }) };
    }
    case "thisMonth":
      return { from: startOfMonth(today), to: endOfDay(today) };
    case "lastMonth": {
      const lastMonth = subMonths(today, 1);
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    }
    case "last7Days":
      return { from: startOfDay(subDays(today, 6)), to: endOfDay(today) };
    case "last30Days":
      return { from: startOfDay(subDays(today, 29)), to: endOfDay(today) };
    default:
      return { from: today, to: today };
  }
}

// Dashed-pill Popover filter with a Calendar range-picker + quick presets —
// same dashed-pill/Popover shape as KeywordFilter/SingleSelectFilter
// (components/global). No feature currently needs `showTime`.
export function DateRangeFilter({ dateRange, setDateRange, onSearch, label, showTime = false }: DateRangeFilterProps) {
  const t = useTranslations("common.dateRangeFilter");
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(dateRange);
  const [startTime, setStartTime] = useState(dateRange?.from ? format(dateRange.from, "HH:mm") : "00:00");
  const [endTime, setEndTime] = useState(dateRange?.to ? format(dateRange.to, "HH:mm") : "23:59");

  const today = useMemo(() => new Date(), []);
  const resolvedLabel = label ?? t("label");

  const formatDateRange = (range: { from: Date; to: Date } | undefined) => {
    if (!range?.from) return "";
    const dateFormat = showTime ? "d MMM yyyy HH:mm" : "d MMM yyyy";
    if (!range?.to) return format(range.from, dateFormat);
    return `${format(range.from, dateFormat)} - ${format(range.to, dateFormat)}`;
  };

  const displayRange = tempDateRange ?? dateRange;
  const startDateStr = displayRange?.from ? format(displayRange.from, "dd/MM/yyyy") : "";
  const endDateStr = displayRange?.to ? format(displayRange.to, "dd/MM/yyyy") : "";

  // Only the first matching preset, so "Today" and "This week" don't both
  // show active at once (e.g. when today is a Sunday).
  const activePresetKey = useMemo(() => {
    if (!tempDateRange?.from || !tempDateRange?.to) return undefined;
    return PRESET_KEYS.find((key) => {
      const preset = getPresetRange(key, today);
      return (
        startOfDay(tempDateRange.from!).getTime() === startOfDay(preset.from).getTime() &&
        startOfDay(tempDateRange.to!).getTime() === startOfDay(preset.to).getTime()
      );
    });
  }, [tempDateRange, today]);

  const handleDateSelect = (range: DateRange | undefined) => {
    setTempDateRange(range);
  };

  const handlePresetClick = (key: (typeof PRESET_KEYS)[number]) => {
    const range = getPresetRange(key, today);
    setTempDateRange({ from: range.from, to: range.to });
    // Presets are whole-day ranges — reset any manually-typed time-of-day so
    // it doesn't silently carry over and narrow the preset's range.
    if (showTime) {
      setStartTime("00:00");
      setEndTime("23:59");
    }
  };

  const handleDone = () => {
    setIsDropdownOpen(false);
    if (tempDateRange?.from && tempDateRange?.to) {
      const from = showTime ? mergeTime(tempDateRange.from, startTime) : tempDateRange.from;
      const to = showTime ? mergeTime(tempDateRange.to, endTime) : tempDateRange.to;
      setDateRange({ from, to });
    } else if (tempDateRange?.from) {
      const from = showTime ? mergeTime(tempDateRange.from, startTime) : tempDateRange.from;
      const to = showTime ? mergeTime(tempDateRange.from, endTime) : tempDateRange.from;
      setDateRange({ from, to });
    } else {
      setDateRange(undefined);
    }
    onSearch?.();
  };

  const handleCancel = () => {
    setTempDateRange(dateRange);
    if (showTime) {
      setStartTime(dateRange?.from ? format(dateRange.from, "HH:mm") : "00:00");
      setEndTime(dateRange?.to ? format(dateRange.to, "HH:mm") : "23:59");
    }
    setIsDropdownOpen(false);
  };

  return (
    <div
      className={cn(
        "flex h-7 flex-row items-center rounded-full border-2 px-1 text-gray-700 hover:bg-muted dark:border-input dark:text-foreground",
        !dateRange && "border-dashed"
      )}
    >
      {dateRange ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-0 rounded-full p-0 pr-2 hover:bg-transparent hover:text-red-600"
          onClick={() => {
            setDateRange(undefined);
            setTempDateRange(undefined);
          }}
        >
          <CircleX size={16} />
        </Button>
      ) : null}
      <Popover
        open={isDropdownOpen}
        onOpenChange={(open) => {
          setIsDropdownOpen(open);
          setTempDateRange(dateRange);
          if (showTime) {
            setStartTime(dateRange?.from ? format(dateRange.from, "HH:mm") : "00:00");
            setEndTime(dateRange?.to ? format(dateRange.to, "HH:mm") : "23:59");
          }
        }}
      >
        <PopoverTrigger asChild>
          <div className="flex items-center space-x-2 pr-1 text-xs">
            <CirclePlus size={16} className={!dateRange ? "block" : "hidden"} />
            <p className="text-xs">{resolvedLabel}</p>
            {dateRange ? (
              <>
                <div className="flex h-4 items-center space-x-4 text-sm">
                  <Separator orientation="vertical" />
                </div>
                <p className="text-xs text-primary dark:text-foreground">{formatDateRange(dateRange)}</p>
                <ChevronDown size={15} />
              </>
            ) : null}
          </div>
        </PopoverTrigger>
        <PopoverContent className={cn("mt-2 w-auto p-0", dateRange && "-ml-7")} align="start">
          <div className="flex flex-row gap-0">
            <div className="border-r p-3">
              <Calendar
                mode="range"
                defaultMonth={displayRange?.from ?? today}
                selected={tempDateRange}
                onSelect={handleDateSelect}
                numberOfMonths={1}
                disabled={{ after: endOfDay(new Date()) }}
                className="rounded-lg border-none shadow-none"
              />
            </div>
            <div className="flex min-w-35 flex-col py-3 pr-3 pl-2">
              {PRESET_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={cn(
                    "rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                    activePresetKey === key && "bg-accent font-medium text-accent-foreground"
                  )}
                  onClick={() => handlePresetClick(key)}
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 px-4 pb-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("startDate")}</Label>
              <Input readOnly value={startDateStr} className="h-9 bg-muted/50" placeholder="DD/MM/YYYY" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("endDate")}</Label>
              <Input readOnly value={endDateStr} className="h-9 bg-muted/50" placeholder="DD/MM/YYYY" />
            </div>
          </div>

          {showTime ? (
            <div className="grid grid-cols-2 gap-3 px-4 pb-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("startTime")}</Label>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("endTime")}</Label>
                <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="h-9" />
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 px-4 pb-4">
            <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
              {t("cancel")}
            </Button>
            <Button type="button" size="sm" onClick={handleDone}>
              {t("done")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
