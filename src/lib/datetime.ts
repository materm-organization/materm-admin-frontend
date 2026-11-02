// Date/time conversion between what the admin sees and what the API takes (doc/07 section 6.2, BR-32):
//  - the display zone is the FIXED `Asia/Vientiane` (UTC+7, no DST) — not the browser's zone;
//  - an instant SENT to the API is RFC 3339 UTC (`…Z`); one RECEIVED in a response body is RFC 3339 with the Vientiane offset and 6
//    fraction digits (`…+07:00`); ETags stay UTC (build them with `etagOfRow` / `toUtcMicros`, services/media.api.ts);
//  - a value a user picks (schedule time, a filter day) is read as wall-clock time IN Vientiane and converted
//    to UTC before it is sent. `to` of a day range is EXCLUSIVE (00:00 of the day after the last day).
// Pure functions (no React) built on `@date-fns/tz`.
import { TZDate } from "@date-fns/tz";

export const DISPLAY_TIME_ZONE = "Asia/Vientiane";

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const HM = /^(\d{2}):(\d{2})$/;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function toUtcIso(zoned: TZDate): string {
  return new Date(zoned.getTime()).toISOString();
}

// "2026-10-27" -> [2026, 10, 27]; undefined for anything that is not a real calendar day.
function parseYmd(ymd: string): [number, number, number] | undefined {
  const m = YMD.exec(ymd);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return undefined;
  }
  return [y, mo, d];
}

function parseHm(time: string): [number, number] | undefined {
  const m = HM.exec(time);
  if (!m) return undefined;
  const [h, mi] = [Number(m[1]), Number(m[2])];
  return h <= 23 && mi <= 59 ? [h, mi] : undefined;
}

// An API instant -> the wall-clock date ("yyyy-MM-dd") and time ("HH:mm") in `timeZone`.
export function isoToZonedParts(
  iso: string,
  timeZone: string = DISPLAY_TIME_ZONE
): { date: string; time: string } | null {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  const z = new TZDate(instant.getTime(), timeZone);
  return {
    date: `${pad(z.getFullYear(), 4)}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}`,
    time: `${pad(z.getHours())}:${pad(z.getMinutes())}`,
  };
}

// Wall-clock date + time in `timeZone` -> UTC ISO string (`2026-10-27T03:00:00.000Z`); null when invalid.
export function zonedPartsToIso(
  date: string,
  time: string,
  timeZone: string = DISPLAY_TIME_ZONE
): string | null {
  const ymd = parseYmd(date);
  const hm = parseHm(time);
  if (!ymd || !hm) return null;
  return toUtcIso(new TZDate(ymd[0], ymd[1] - 1, ymd[2], hm[0], hm[1], 0, 0, timeZone));
}

// 00:00 of the calendar day `ymd` in `timeZone`, as UTC ISO.
export function startOfZonedDayIso(ymd: string, timeZone: string = DISPLAY_TIME_ZONE): string | null {
  return zonedPartsToIso(ymd, "00:00", timeZone);
}

// Filter by a day range chosen in the UI (both days inclusive) -> API bounds: `from` inclusive = 00:00 of the
// first day, `to` EXCLUSIVE = 00:00 of the day after the last day (doc/05 section 1.6). null if invalid or
// the range is reversed.
export function dayRangeToUtcBounds(
  fromYmd: string,
  toYmd: string,
  timeZone: string = DISPLAY_TIME_ZONE
): { from: string; to: string } | null {
  const from = parseYmd(fromYmd);
  const to = parseYmd(toYmd);
  if (!from || !to) return null;
  const fromIso = toUtcIso(new TZDate(from[0], from[1] - 1, from[2], 0, 0, 0, 0, timeZone));
  // Day + 1 (TZDate rolls month/year over).
  const toIso = toUtcIso(new TZDate(to[0], to[1] - 1, to[2] + 1, 0, 0, 0, 0, timeZone));
  return fromIso < toIso ? { from: fromIso, to: toIso } : null;
}
