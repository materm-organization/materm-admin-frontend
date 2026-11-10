import { describe, expect, it } from "vitest";

import { PERMISSION_KEYS } from "@/lib/constants/permissions";
import { ADMIN_ROOT, buildNavMainItemsForUser, getPermissionsForPath, isRouteAllowed } from "@/lib/nav-main-items";
import { CALENDAR_DAYS, QUEUE_KIND_KEYS, QUEUE_PERMISSION_KEYS, buildCalendar, queueRowHref, queueRowKey, queueScheduleHealth } from "@/lib/publishing-queue";
import type { QueueScheduledItem } from "@/types/publishing-queue";

const row = (id: number, run_at: string | null, extra: Partial<QueueScheduledItem> = {}): QueueScheduledItem => ({
  entity_type: "pages",
  id,
  title: `Row ${id}`,
  status: "scheduled",
  updated_at: "2026-11-10T09:00:00+07:00",
  updated_by: null,
  can: { read: true, update: true, review: true, publish: true, schedule: true },
  run_at,
  overdue: false,
  schedule: null,
  ...extra,
});

// 10:00 on Tuesday 10 November 2026 in Vientiane
const NOW = Date.parse("2026-11-10T03:00:00Z");

describe("links: the server sends no href, the routes are the ones of the lists", () => {
  it("builds the editor route of every kind (a collection entry carries its collection key)", () => {
    expect(queueRowHref({ entity_type: "pages", id: 3 })).toBe("/admin/pages/3");
    expect(queueRowHref({ entity_type: "posts", id: 4 })).toBe("/admin/blog/posts/4");
    expect(queueRowHref({ entity_type: "albums", id: 5 })).toBe("/admin/galleries/5");
    expect(queueRowHref({ entity_type: "faq-groups", id: 6 })).toBe("/admin/faq/6");
    expect(queueRowHref({ entity_type: "forms", id: 7 })).toBe("/admin/forms/7");
    expect(queueRowHref({ entity_type: "shared-sections", id: 8 })).toBe("/admin/sections/8");
    expect(queueRowHref({ entity_type: "collection-entries", id: 9, collection_key: "team" })).toBe("/admin/collections/team/9");
    expect(queueRowHref({ entity_type: "collection-entries", id: 9, collection_key: "a b" })).toBe("/admin/collections/a%20b/9");
  });

  it("two entries with the same id in different collections have different keys", () => {
    expect(queueRowKey({ entity_type: "collection-entries", id: 1, collection_key: "a" })).not.toBe(queueRowKey({ entity_type: "collection-entries", id: 1, collection_key: "b" }));
  });
});

describe("schedule health", () => {
  it("failed beats overdue, the row's own overdue flag decides (database time)", () => {
    expect(queueScheduleHealth({ overdue: false, schedule: null })).toBe("ok");
    expect(queueScheduleHealth({ overdue: true, schedule: null })).toBe("overdue");
    expect(queueScheduleHealth({ overdue: true, schedule: { action: "publish", run_at: "x", status: "failed", attempts: 3, last_error: "e" } })).toBe("failed");
    expect(queueScheduleHealth({ overdue: false, schedule: { action: "publish", run_at: "x", status: "running", attempts: 1, last_error: null } })).toBe("running");
  });
});

describe("the calendar (Asia/Vientiane, Monday first)", () => {
  it("30 days from today in whole weeks; the padding cells before today and after day 30 hold nothing", () => {
    const cal = buildCalendar([], NOW);
    expect(cal.today).toBe("2026-11-10");
    expect(cal.last).toBe("2026-12-09");
    const cells = cal.weeks.flat();
    expect(cells.length % 7).toBe(0);
    expect(cells.filter((c) => c.inRange)).toHaveLength(CALENDAR_DAYS);
    expect(cal.weeks[0][0].weekday).toBe(1); // Monday
    expect(cal.weeks[0][0].date).toBe("2026-11-09");
    expect(cal.weeks[0][0].inRange).toBe(false);
    expect(cal.weeks[0][1]).toMatchObject({ date: "2026-11-10", isToday: true, inRange: true });
  });

  it("a row lands on its day in the display zone, not the UTC day (23:30 UTC is already tomorrow in Vientiane)", () => {
    const cal = buildCalendar([row(1, "2026-11-12T23:30:00Z"), row(2, "2026-11-13T08:00:00+07:00")], NOW);
    const day = (d: string) => cal.weeks.flat().find((c) => c.date === d)!;
    expect(day("2026-11-13").items.map((r) => r.id)).toEqual([1, 2]);
    expect(day("2026-11-12").items).toEqual([]);
  });

  it("a time that has passed sits in today; no time is unplaced; beyond the window is later", () => {
    const cal = buildCalendar([row(1, "2026-11-08T10:00:00+07:00"), row(2, null), row(3, "2027-01-15T10:00:00+07:00")], NOW);
    expect(cal.weeks.flat().find((c) => c.isToday)!.items.map((r) => r.id)).toEqual([1]);
    expect(cal.unplaced.map((r) => r.id)).toEqual([2]);
    expect(cal.later.map((r) => r.id)).toEqual([3]);
  });

  it("the last day is placed, the one after it is later", () => {
    const cal = buildCalendar([row(1, "2026-12-09T23:00:00+07:00"), row(2, "2026-12-10T00:00:00+07:00")], NOW);
    expect(cal.weeks.flat().find((c) => c.date === "2026-12-09")!.items.map((r) => r.id)).toEqual([1]);
    expect(cal.later.map((r) => r.id)).toEqual([2]);
  });
});

describe("navigation registration (default-deny)", () => {
  it("the route is registered with every key that can contribute; the sidebar entry sits in the content group", () => {
    expect(QUEUE_PERMISSION_KEYS.sort()).toEqual(
      [PERMISSION_KEYS.CMS_PAGES, PERMISSION_KEYS.CMS_BLOG, PERMISSION_KEYS.CMS_GALLERIES, PERMISSION_KEYS.CMS_COLLECTIONS, PERMISSION_KEYS.CMS_FAQ, PERMISSION_KEYS.CMS_SECTIONS, PERMISSION_KEYS.FORMS_MANAGE].sort()
    );
    expect(Object.values(QUEUE_KIND_KEYS)).toHaveLength(7);
    const access = getPermissionsForPath("/admin/publishing");
    expect(access.kind).toBe("requires");
    expect(access).toMatchObject({ keys: expect.arrayContaining(QUEUE_PERMISSION_KEYS) });
  });

  it("allowed for read on ANY contributing key, denied for the rest (and never open to everybody)", () => {
    const access = getPermissionsForPath("/admin/publishing");
    for (const key of QUEUE_PERMISSION_KEYS) expect(isRouteAllowed(access, [key])).toBe(true);
    expect(isRouteAllowed(access, [PERMISSION_KEYS.CMS_MENUS, PERMISSION_KEYS.IAM_USERS, PERMISSION_KEYS.MEDIA_LIBRARY])).toBe(false);
    expect(isRouteAllowed(access, [])).toBe(false);
    expect(getPermissionsForPath(`${ADMIN_ROOT}/publishing/x`).kind).toBe("requires");
  });

  it("the sidebar entry is hidden when the caller has read on none of the keys and carries the awaiting badge", () => {
    const urls = (keys: string[]) => buildNavMainItemsForUser(keys).flatMap((g) => (g.items ? g.items.map((i) => i.url) : [g.url]));
    expect(urls([PERMISSION_KEYS.CMS_MENUS, PERMISSION_KEYS.CMS_SEO])).not.toContain("/admin/publishing");
    expect(urls([PERMISSION_KEYS.CMS_SECTIONS])).toContain("/admin/publishing");
    const item = buildNavMainItemsForUser([PERMISSION_KEYS.CMS_BLOG]).flatMap((g) => g.items ?? []).find((i) => i.url === "/admin/publishing");
    expect(item).toMatchObject({ title: "nav.publishing", badgeQuery: "publishing.awaiting" });
  });
});
