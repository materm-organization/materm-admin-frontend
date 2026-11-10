// Pure helpers of the publishing queue screen (SCR-39; doc/07 3.x, FR-PUB-14). No React.
import { PERMISSION_KEYS } from "@/lib/constants/permissions";
import { DISPLAY_TIME_ZONE, isoToZonedParts } from "@/lib/datetime";
import type { QueueKind, QueueRowBase, QueueScheduledItem, QueueTab } from "@/types/publishing-queue";

export const QUEUE_TABS: readonly QueueTab[] = ["awaiting_review", "scheduled", "unpublished_changes"];
export const QUEUE_KINDS: readonly QueueKind[] = ["pages", "posts", "albums", "faq-groups", "forms", "collection-entries", "shared-sections"];
export const DEFAULT_QUEUE_TAB: QueueTab = "awaiting_review";
export const QUEUE_DEFAULT_LIMIT = 50;

// The permission key whose `read` lets a person see a kind in the queue (the server's `services/kinds.go`).
export const QUEUE_KIND_KEYS: Record<QueueKind, string> = {
  pages: PERMISSION_KEYS.CMS_PAGES,
  posts: PERMISSION_KEYS.CMS_BLOG,
  albums: PERMISSION_KEYS.CMS_GALLERIES,
  "faq-groups": PERMISSION_KEYS.CMS_FAQ,
  forms: PERMISSION_KEYS.FORMS_MANAGE,
  "collection-entries": PERMISSION_KEYS.CMS_COLLECTIONS,
  "shared-sections": PERMISSION_KEYS.CMS_SECTIONS,
};

// Every key that can put a row in the queue: the sidebar entry and the route are open to a person who may read at least one of them.
export const QUEUE_PERMISSION_KEYS: string[] = [...new Set(Object.values(QUEUE_KIND_KEYS))];

// The kinds that have a review workflow / that can be scheduled (which tab a kind can appear in).
export const QUEUE_TAB_KINDS: Record<QueueTab, readonly QueueKind[]> = {
  awaiting_review: ["pages", "posts"],
  scheduled: ["pages", "posts", "albums", "collection-entries"],
  unpublished_changes: QUEUE_KINDS,
};

// The editor route of a row. The server sends no `href`, so the screen builds it from the same routes as the lists.
export function queueRowHref(row: Pick<QueueRowBase, "entity_type" | "id" | "collection_key">): string {
  switch (row.entity_type) {
    case "pages":
      return `/admin/pages/${row.id}`;
    case "posts":
      return `/admin/blog/posts/${row.id}`;
    case "albums":
      return `/admin/galleries/${row.id}`;
    case "faq-groups":
      return `/admin/faq/${row.id}`;
    case "forms":
      return `/admin/forms/${row.id}`;
    case "shared-sections":
      return `/admin/sections/${row.id}`;
    case "collection-entries":
      return `/admin/collections/${encodeURIComponent(row.collection_key ?? "")}/${row.id}`;
  }
}

export const queueRowKey = (row: Pick<QueueRowBase, "entity_type" | "id" | "collection_key">) => `${row.entity_type}:${row.collection_key ?? ""}:${row.id}`;

// How a scheduled row is doing: `failed` = the server gave up (3 attempts), `overdue` = the time passed without a run, else ok. The row's own
// `overdue` flag (database time) wins over the browser's clock.
export type QueueScheduleHealth = "ok" | "running" | "overdue" | "failed";
export function queueScheduleHealth(row: Pick<QueueScheduledItem, "overdue" | "schedule">): QueueScheduleHealth {
  if (row.schedule?.status === "failed") return "failed";
  if (row.schedule?.status === "running") return "running";
  return row.overdue ? "overdue" : "ok";
}

// ---- the calendar strip (Asia/Vientiane) --------------------------------------------------------------------------------------------
export const CALENDAR_DAYS = 30;

export type CalendarDay = {
  // yyyy-MM-dd in Asia/Vientiane
  date: string;
  // 0 = Sunday
  weekday: number;
  isToday: boolean;
  // false for the cells that pad the first week before today / the last week after day 30
  inRange: boolean;
  items: QueueScheduledItem[];
};

const ymdParts = (ymd: string) => ymd.split("-").map(Number) as [number, number, number];
const addDays = (ymd: string, n: number): string => {
  const [y, m, d] = ymdParts(ymd);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const weekdayOf = (ymd: string): number => {
  const [y, m, d] = ymdParts(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

export const zonedDayOf = (iso: string): string | null => isoToZonedParts(iso, DISPLAY_TIME_ZONE)?.date ?? null;

// The next `days` days from today in the display zone, in rows of 7 starting on Monday (the cells before today / after the last day are
// padding). A row whose time is already past (overdue, or a schedule that did not fire) sits in TODAY: it is waiting for the worker now.
// A row with no time at all is returned in `unplaced`; one beyond the window in `later`.
export function buildCalendar(items: QueueScheduledItem[], nowMs: number, days: number = CALENDAR_DAYS) {
  const today = zonedDayOf(new Date(nowMs).toISOString()) as string;
  const last = addDays(today, days - 1);
  const placed = new Map<string, QueueScheduledItem[]>();
  const unplaced: QueueScheduledItem[] = [];
  const later: QueueScheduledItem[] = [];
  for (const row of items) {
    const day = row.run_at ? zonedDayOf(row.run_at) : null;
    if (!day) {
      unplaced.push(row);
      continue;
    }
    const key = day < today ? today : day;
    if (key > last) {
      later.push(row);
      continue;
    }
    placed.set(key, [...(placed.get(key) ?? []), row]);
  }
  const lead = (weekdayOf(today) + 6) % 7; // Monday = 0
  const cells: CalendarDay[] = [];
  for (let i = -lead; i < days + ((7 - ((lead + days) % 7)) % 7); i++) {
    const date = addDays(today, i);
    const inRange = i >= 0 && i < days;
    cells.push({ date, weekday: weekdayOf(date), isToday: i === 0, inRange, items: inRange ? (placed.get(date) ?? []) : [] });
  }
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { weeks, unplaced, later, today, last };
}
