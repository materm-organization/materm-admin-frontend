import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockHttpError, getMockDb, resetMockDb } from "@/mocks/mock-db";
import { getAlbum, scheduleAlbum } from "@/mocks/mock-albums";
import { getPage, rejectPage, schedulePage, submitPageForReview, unschedulePage } from "@/mocks/mock-pages";
import { getPost, submitPostForReview } from "@/mocks/mock-posts";
import { publishingQueue, queueCounts, setQueueReadableKinds } from "@/mocks/mock-publishing-queue";
import { failSchedule, fireSchedule, makeScheduleOverdue, setWorkflowRole } from "@/mocks/mock-schedule-helpers";

// SCR-39 mock: the queue is computed from the same db the D1 engines write. Rules as the server's README (modules/publishing).
const NOW = new Date("2026-11-10T03:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const db = () => getMockDb();
const queue = (qs = "") => publishingQueue(db(), new URLSearchParams(qs));
const ids = (rows: Array<{ entity_type: string; id: number }>) => rows.map((r) => `${r.entity_type}/${r.id}`);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetMockDb();
});
afterEach(() => vi.useRealTimers());

describe("the three tabs follow the engines", () => {
  it("seed: nothing waits or is booked; the published roots with a pending draft are the unpublished changes (all kinds)", () => {
    const q = queue();
    expect(q.awaiting_review).toEqual({ count: 0, items: [] });
    expect(q.scheduled).toEqual({ count: 0, items: [] });
    expect(q.unpublished_changes?.count).toBe(7);
    const kinds = new Set(q.unpublished_changes?.items.map((r) => r.entity_type));
    expect(kinds.has("collection-entries")).toBe(true);
    expect(kinds.has("forms")).toBe(true);
    expect(q.unpublished_changes?.items.every((r) => r.status === "published" && r.can.read)).toBe(true);
  });

  it("a mock submit-review shows up under awaiting_review (who and when), a reject takes it out again", () => {
    submitPageForReview(db(), "8", undefined, getPage(db(), "8").etag);
    submitPostForReview(db(), "3", undefined, getPost(db(), "3").etag);
    const q = queue("tab=awaiting_review");
    expect(Object.keys(q)).toEqual(["awaiting_review"]);
    expect(q.awaiting_review?.count).toBe(2);
    expect(ids(q.awaiting_review!.items).sort()).toEqual(["pages/8", "posts/3"]);
    expect(q.awaiting_review?.items[0]).toMatchObject({ status: "in_review", submitted_by: { id: 6 }, can: { review: true } });
    expect(queueCounts(db()).in_review).toBe(2);
    rejectPage(db(), "8", { comment: "needs a hero" }, getPage(db(), "8").etag);
    expect(ids(queue("tab=awaiting_review").awaiting_review!.items)).toEqual(["posts/3"]);
    expect(queue().unpublished_changes?.items.some((r) => r.entity_type === "pages" && r.id === 8)).toBe(false);
  });

  it("a mock schedule shows up under scheduled with its run_at (+07:00) and leaves with the unschedule", () => {
    const out = schedulePage(db(), "8", { scheduled_at: at(120) }, getPage(db(), "8").etag);
    const row = queue("tab=scheduled").scheduled!.items[0];
    expect(row).toMatchObject({ entity_type: "pages", id: 8, status: "scheduled", run_at: "2026-11-10T12:00:00.000000+07:00", overdue: false, schedule: { action: "publish", status: "pending", attempts: 0 } });
    unschedulePage(db(), "8", out.etag);
    expect(queue("tab=scheduled").scheduled?.count).toBe(0);
  });

  it("a PUBLISHED root with an apply_revision booking is on the scheduled tab (and still in the unpublished changes)", () => {
    schedulePage(db(), "9", { scheduled_at: at(90) }, getPage(db(), "9").etag);
    const q = queue();
    expect(q.scheduled?.items[0]).toMatchObject({ entity_type: "pages", id: 9, status: "published", schedule: { action: "apply_revision" } });
    expect(q.unpublished_changes?.items.some((r) => r.entity_type === "pages" && r.id === 9)).toBe(true);
  });

  it("ordered by run time; an album joins; the fire removes the row", () => {
    schedulePage(db(), "8", { scheduled_at: at(300) }, getPage(db(), "8").etag);
    scheduleAlbum(db(), "3", { scheduled_at: at(60) }, getAlbum(db(), "3").etag);
    expect(ids(queue("tab=scheduled").scheduled!.items)).toEqual(["albums/3", "pages/8"]);
    expect(queueCounts(db()).scheduled_7d).toBe(2);
    expect(fireSchedule(db(), "pages", 8)).toBe("published");
    expect(ids(queue("tab=scheduled").scheduled!.items)).toEqual(["albums/3"]);
  });

  it("overdue and failed rows are flagged and always listed, even outside the `to` window", () => {
    schedulePage(db(), "8", { scheduled_at: at(60) }, getPage(db(), "8").etag);
    makeScheduleOverdue(db(), "pages", 8);
    scheduleAlbum(db(), "3", { scheduled_at: at(120) }, getAlbum(db(), "3").etag);
    failSchedule(db(), "albums", 3, "media_alt_missing");
    const rows = queue("tab=scheduled").scheduled!.items;
    expect(rows.find((r) => r.id === 8)).toMatchObject({ overdue: true, schedule: { status: "pending" } });
    expect(rows.find((r) => r.id === 3)).toMatchObject({ overdue: true, schedule: { status: "failed", attempts: 3, last_error: "media_alt_missing" } });
    scheduleAlbum(db(), "5", { scheduled_at: at(600) }, getAlbum(db(), "5").etag);
    const narrow = publishingQueue(db(), new URLSearchParams(`tab=scheduled&to=${encodeURIComponent(at(30))}`)).scheduled!.items;
    expect(ids(narrow).sort()).toEqual(["albums/3", "pages/8"]);
  });
});

describe("permissions and roles", () => {
  it("a role with read on ONE key sees nothing of the other kinds (rows, counts and the kind filter)", () => {
    submitPageForReview(db(), "8", undefined, getPage(db(), "8").etag);
    submitPostForReview(db(), "3", undefined, getPost(db(), "3").etag);
    setQueueReadableKinds(db(), ["posts"]);
    const q = queue();
    expect(ids(q.awaiting_review!.items)).toEqual(["posts/3"]);
    expect(q.unpublished_changes?.items.every((r) => r.entity_type === "posts")).toBe(true);
    expect(queue("kind=pages").awaiting_review).toEqual({ count: 0, items: [] });
    expect(queueCounts(db()).in_review).toBe(1);
    setQueueReadableKinds(db(), ["forms"]);
    const f = queue();
    expect(f.awaiting_review?.count).toBe(0);
    expect(f.scheduled?.count).toBe(0);
    expect(ids(f.unpublished_changes!.items)).toEqual(["forms/3"]);
  });

  it("can{} follows the workflow role: a reviewer reviews only; a scheduler lacks publish so it can not schedule (BR-11)", () => {
    submitPageForReview(db(), "8", undefined, getPage(db(), "8").etag);
    setWorkflowRole(db(), "reviewer");
    expect(queue("tab=awaiting_review").awaiting_review!.items[0].can).toEqual({ read: true, update: false, review: true, publish: false, schedule: false });
    setWorkflowRole(db(), "scheduler");
    expect(queue("tab=awaiting_review").awaiting_review!.items[0].can).toMatchObject({ review: false, schedule: false });
    setWorkflowRole(db(), "full");
    expect(queue("tab=awaiting_review").awaiting_review!.items[0].can).toMatchObject({ review: true, publish: true, schedule: true });
  });
});

describe("the query", () => {
  const fails = (qs: string) => {
    try {
      queue(qs);
    } catch (e) {
      expect(e).toBeInstanceOf(MockHttpError);
      return (e as MockHttpError).body.errors as Array<{ path: string; code: string }>;
    }
    throw new Error("expected 422");
  };

  it("kind filters, page and limit slice each tab; counts stay the totals", () => {
    const q = queue("tab=unpublished_changes&kind=albums,faq-groups&limit=1&page=2");
    expect(q.unpublished_changes?.count).toBe(2);
    expect(q.unpublished_changes?.items).toHaveLength(1);
  });

  it("is strict like the server: unknown parameter, bad tab / kind, limit outside 1-100, `to` beyond 30 days", () => {
    expect(fails("foo=1")[0]).toMatchObject({ path: "/foo", code: "unknown_field" });
    expect(fails("tab=all")[0]).toMatchObject({ path: "/tab", code: "not_in_enum" });
    expect(fails("kind=pages,comics")[0]).toMatchObject({ path: "/kind" });
    expect(fails("limit=101")[0]).toMatchObject({ path: "/limit" });
    expect(fails("limit=0")[0]).toMatchObject({ path: "/limit" });
    expect(fails(`to=${encodeURIComponent(new Date(NOW.getTime() + 31 * 86_400_000).toISOString())}`)[0]).toMatchObject({ path: "/to", code: "out_of_range" });
  });
});
