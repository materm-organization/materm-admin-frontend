// Client mirror of the audit date-range rules (doc/05 section 5.1) and the URL <-> API date mapping.
//  - the URL keeps whole DAYS (`from=2026-10-01&to=2026-10-27`, both inclusive, Asia/Vientiane); the API gets
//    RFC 3339 UTC bounds with `to` EXCLUSIVE (lib/datetime.ts);
//  - no `from`/`to` = the server's default: the last 30 days;
//  - without a "narrow" filter (`actor_id`, `api_key_id`, `action`, `entity_type`+`entity_id`, `request_id`) the
//    range may be at most 92 days; with one, at most 24 months. Anything wider is a 422 `date_range_too_large`
//    at `/to`, so the client says so before sending.
import { addMonths } from "date-fns";

import { dayRangeToUtcBounds, startOfZonedDayIso } from "@/lib/datetime";
import type { AuditListParams } from "@/types/audit";

export const MAX_RANGE_DAYS_BROAD = 92;
export const MAX_RANGE_MONTHS_NARROW = 24;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AuditFilterValues = {
  actor_id?: number;
  actor_type?: string;
  action?: string;
  result?: string;
  entity_type?: string;
  entity_id?: number;
  request_id?: string;
  from?: string;
  to?: string;
};

export function hasNarrowFilter(f: AuditFilterValues): boolean {
  return Boolean(f.actor_id || f.action || f.request_id || (f.entity_type && f.entity_id));
}

// `yyyy-MM-dd` days -> UTC bounds (`to` exclusive). One side alone is allowed.
export function dayFilterToBounds(from?: string, to?: string): { from?: string; to?: string } {
  if (from && to) return dayRangeToUtcBounds(from, to) ?? {};
  if (from) {
    const iso = startOfZonedDayIso(from);
    return iso ? { from: iso } : {};
  }
  if (to) {
    const bounds = dayRangeToUtcBounds(to, to);
    return bounds ? { to: bounds.to } : {};
  }
  return {};
}

// What GET /audit-logs gets for these URL filters (+ page / limit / sort).
export function toAuditParams(
  query: { page?: number; limit?: number; sort?: string } & AuditFilterValues
): AuditListParams {
  const { from, to, ...rest } = query;
  return { ...rest, ...dayFilterToBounds(from, to) };
}

export type RangeCheck = { ok: true } | { ok: false; max: "days" | "months" };

// `now` is injectable for tests. An open end counts as "now" (and an open start as 30 days before `to`).
export function checkAuditRange(f: AuditFilterValues, now: Date = new Date()): RangeCheck {
  if (!f.from && !f.to) return { ok: true };
  const bounds = dayFilterToBounds(f.from, f.to);
  const end = bounds.to ? new Date(bounds.to) : now;
  const start = bounds.from ? new Date(bounds.from) : new Date(end.getTime() - 30 * DAY_MS);
  if (hasNarrowFilter(f)) {
    return end.getTime() <= addMonths(start, MAX_RANGE_MONTHS_NARROW).getTime() ? { ok: true } : { ok: false, max: "months" };
  }
  return end.getTime() - start.getTime() <= MAX_RANGE_DAYS_BROAD * DAY_MS ? { ok: true } : { ok: false, max: "days" };
}
