// Pure helpers of the schedule and review commands (D1; doc/05 12.10 - 12.11). No React.
import { parseApiError } from "@/lib/api-error";
import type { ScheduleInfo } from "@/types/publishing";

// Bounds of `scheduled_at` relative to now (05 12.10): at least one minute ahead, at most one calendar year.
export const SCHEDULE_MIN_LEAD_MS = 60_000;
export const MAX_COMMENT_LENGTH = 200;

function addOneYear(from: number): number {
  const d = new Date(from);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.getTime();
}

export type ScheduleTimeCheck = "ok" | "empty" | "invalid" | "too_soon" | "too_far";

// The client-side mirror of the server's range rule. `now` is a parameter so a test (and the dialog, at the moment of the click) decides it.
export function checkScheduleTime(iso: string | null, now: number): ScheduleTimeCheck {
  if (!iso) return "empty";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "invalid";
  if (at < now + SCHEDULE_MIN_LEAD_MS) return "too_soon";
  if (at > addOneYear(now)) return "too_far";
  return "ok";
}

export const scheduleBounds = (now: number) => ({ min: new Date(now + SCHEDULE_MIN_LEAD_MS), max: new Date(addOneYear(now)) });

// How the schedule of a scheduled entity is doing: `failed` = the server gave up (3 attempts), `overdue` = the time has passed and the
// server has not fired yet (pending), `running` = it is firing right now, `ok` = waiting for the time.
export type ScheduleHealth = "ok" | "running" | "overdue" | "failed";

export function scheduleHealth(info: Pick<ScheduleInfo, "status" | "run_at"> | null | undefined, now: number): ScheduleHealth {
  if (!info) return "ok";
  if (info.status === "failed") return "failed";
  if (info.status === "running") return "running";
  const at = Date.parse(info.run_at);
  return !Number.isNaN(at) && at < now ? "overdue" : "ok";
}

// What a failed schedule / unschedule / submit / reject call means for the dialog. Decided on the machine code, status and field-error codes.
export type ScheduleProblem =
  | { kind: "range"; min?: string; max?: string } // 422 out_of_range at /scheduled_at
  | { kind: "required" } // 422 required at /scheduled_at
  | { kind: "format" } // 422 invalid_format at /scheduled_at
  | { kind: "rate"; retryAfter: number | undefined } // 429
  | { kind: "commentRequired" } // 422 required at /comment
  | { kind: "commentTooLong" } // 422 too_long at /comment
  | { kind: "other" };

export function classifyScheduleError(error: unknown): ScheduleProblem {
  const parsed = parseApiError(error);
  if (parsed.status === 429) return { kind: "rate", retryAfter: parsed.retryAfter };
  if (parsed.status === 422) {
    for (const fe of parsed.fieldErrors) {
      if (fe.path === "/scheduled_at") {
        if (fe.code === "out_of_range") return { kind: "range", min: typeof fe.params?.min === "string" ? fe.params.min : undefined, max: typeof fe.params?.max === "string" ? fe.params.max : undefined };
        if (fe.code === "required") return { kind: "required" };
        return { kind: "format" };
      }
      if (fe.path === "/comment") return fe.code === "too_long" ? { kind: "commentTooLong" } : { kind: "commentRequired" };
    }
  }
  return { kind: "other" };
}
