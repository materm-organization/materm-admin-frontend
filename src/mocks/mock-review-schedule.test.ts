import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockHttpError, getMockDb, resetMockDb } from "@/mocks/mock-db";
import { getAlbum, patchAlbum, scheduleAlbum, unscheduleAlbum } from "@/mocks/mock-albums";
import { getEntry, scheduleEntry, unscheduleEntry } from "@/mocks/mock-collections";
import { getPage, listPageRevisions, patchPage, publishPage, rejectPage, schedulePage, submitPageForReview, unpublishPage, unschedulePage } from "@/mocks/mock-pages";
import { discardPostDraft, getPost, patchPost, rejectPost, schedulePost, setPostRole, submitPostForReview } from "@/mocks/mock-posts";
import { SCHEDULE_LIMIT_PER_HOUR } from "@/mocks/mock-review-schedule";
import { failSchedule, fireSchedule, makeScheduleOverdue, setWorkflowRole } from "@/mocks/mock-schedule-helpers";

// The D1 part of the mock API (doc/05 12.10 - 12.11): the contract the PublishBar and the editors may rely on. Same order of checks as the backend.
const NOW = new Date("2026-11-10T03:00:00.000Z"); // 10:00 in Vientiane
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

const fails = (fn: () => unknown, status: number, code?: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(MockHttpError);
    expect((error as MockHttpError).status).toBe(status);
    if (code) expect((error as MockHttpError).body.code).toBe(code);
    return error as MockHttpError;
  }
  throw new Error("expected the call to fail");
};
const errorsOf = (e: MockHttpError) => e.body.errors as Array<{ path: string; code: string; in: string; params?: Record<string, string> }>;
const reasonOf = (e: MockHttpError) => (e.body.details as { reason: string }).reason;
const db = () => getMockDb();
const pageEtag = (id: number) => getPage(db(), String(id)).etag;
const postEtag = (id: number) => getPost(db(), String(id)).etag;
const page = (id: number) => getPage(db(), String(id)).data;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetMockDb();
});
afterEach(() => vi.useRealTimers());

describe("submit-review and reject (pages, posts only)", () => {
  it("submit: draft -> in_review with a new ETag; the optional note is checked (<= 200, no other field)", () => {
    const before = pageEtag(8);
    const out = submitPageForReview(db(), "8", { note: "please check the hero" }, before);
    expect(out.etag).not.toBe(before);
    expect(out.data).toMatchObject({ status: "in_review", warnings: [], aggregate: { status: "in_review" } });
    expect(page(8).status).toBe("in_review");
    expect(errorsOf(fails(() => submitPageForReview(db(), "9", { note: "x".repeat(201) }, pageEtag(9)), 422))).toEqual([{ in: "body", path: "/note", code: "too_long", params: { max: 200 } }]);
    expect(errorsOf(fails(() => submitPageForReview(db(), "9", { comment: "x" }, pageEtag(9)), 422))[0]).toMatchObject({ path: "/comment", code: "unknown_field" });
  });

  it("submit: 428 without If-Match, 409 CONFLICT_LOCK_VERSION when stale, INVALID_STATE not_draft / trashed", () => {
    fails(() => submitPageForReview(db(), "8", undefined, null), 428, "PRECONDITION_REQUIRED");
    fails(() => submitPageForReview(db(), "8", undefined, '"999"'), 409, "CONFLICT_LOCK_VERSION");
    expect(reasonOf(fails(() => submitPageForReview(db(), "10", undefined, pageEtag(10)), 409, "INVALID_STATE"))).toBe("not_draft");
    expect(reasonOf(fails(() => submitPageForReview(db(), "7", undefined, pageEtag(7)), 409, "INVALID_STATE"))).toBe("trashed");
    submitPageForReview(db(), "8", undefined, pageEtag(8));
    expect(reasonOf(fails(() => submitPageForReview(db(), "8", undefined, pageEtag(8)), 409, "INVALID_STATE"))).toBe("not_draft");
  });

  it("reject: needs a comment (required / too_long at /comment, counted after trimming), only from in_review; the comment is the change note of a history revision", () => {
    submitPageForReview(db(), "8", undefined, pageEtag(8));
    for (const body of [undefined, {}, { comment: "" }, { comment: "   " }]) {
      expect(errorsOf(fails(() => rejectPage(db(), "8", body, pageEtag(8)), 422))).toEqual([{ in: "body", path: "/comment", code: "required" }]);
    }
    expect(errorsOf(fails(() => rejectPage(db(), "8", { comment: "x".repeat(201) }, pageEtag(8)), 422))).toEqual([{ in: "body", path: "/comment", code: "too_long", params: { max: 200 } }]);
    expect(rejectPage(db(), "8", { comment: ` ${"x".repeat(200)} ` }, pageEtag(8)).data).toMatchObject({ status: "draft" });

    submitPageForReview(db(), "8", undefined, pageEtag(8));
    const out = rejectPage(db(), "8", { comment: "The hero needs an alt text." }, pageEtag(8));
    expect(out.data).toMatchObject({ status: "draft", review_revision: { id: expect.any(Number), version: expect.any(Number) } });
    const revisions = listPageRevisions(db(), "8", new URLSearchParams("kind=history")).data;
    expect(revisions.find((r) => r.id === out.data.review_revision.id)).toMatchObject({ kind: "history", change_note: "The hero needs an alt text." });
    expect(reasonOf(fails(() => rejectPage(db(), "8", { comment: "again" }, pageEtag(8)), 409, "INVALID_STATE"))).toBe("not_in_review");
  });

  it("the roles: the reviewer can reject but not submit; the writer can submit but not reject; posts: an author submits her own post only", () => {
    setWorkflowRole(db(), "reviewer");
    fails(() => submitPageForReview(db(), "8", undefined, pageEtag(8)), 403, "FORBIDDEN");
    setWorkflowRole(db(), "writer");
    submitPageForReview(db(), "8", undefined, pageEtag(8));
    fails(() => rejectPage(db(), "8", { comment: "no" }, pageEtag(8)), 403, "FORBIDDEN");

    setWorkflowRole(db(), "full");
    setPostRole(db(), "author");
    fails(() => submitPostForReview(db(), "5", undefined, postEtag(5)), 403, "FORBIDDEN"); // post 5 belongs to somebody else
    expect(submitPostForReview(db(), "3", undefined, postEtag(3)).data).toMatchObject({ status: "in_review" });
    fails(() => rejectPost(db(), "3", { comment: "no" }, postEtag(3)), 403, "FORBIDDEN"); // `review` is the editor's
  });

  it("BR-10: while a post is in review or scheduled, an author with only update_own gets 403 on PATCH, discard-draft (not even to translate)", () => {
    setPostRole(db(), "author");
    submitPostForReview(db(), "3", undefined, postEtag(3));
    fails(() => patchPost(db(), "3", { translations: { en: { title: "Trail notes" } } }, postEtag(3)), 403, "FORBIDDEN");
    fails(() => discardPostDraft(db(), "3", postEtag(3)), 403, "FORBIDDEN");
    // the editor (holds `update`) still can
    setPostRole(db(), "editor");
    patchPost(db(), "3", { translations: { en: { title: "Trail notes" } } }, postEtag(3));
  });

  it("albums have no review workflow (no routes in the backend): the engine does not offer one", () => {
    // the album module exposes schedule / unschedule only
    expect(typeof scheduleAlbum).toBe("function");
    expect(typeof unscheduleAlbum).toBe("function");
  });
});

describe("schedule / unschedule", () => {
  it("checks in the backend's order: body (422) -> range (422) -> If-Match (428 / 409) -> state -> publish rules (422 PUBLISH_BLOCKED)", () => {
    // a bad body wins over a missing If-Match
    expect(errorsOf(fails(() => schedulePage(db(), "8", {}, null), 422))).toEqual([{ in: "body", path: "/scheduled_at", code: "required" }]);
    expect(errorsOf(fails(() => schedulePage(db(), "8", { scheduled_at: "2026-12-01 09:00" }, null), 422))[0]).toMatchObject({ path: "/scheduled_at", code: "invalid_format" });
    expect(errorsOf(fails(() => schedulePage(db(), "8", { scheduled_at: "2026-12-01T09:00:00" }, null), 422))[0].code).toBe("invalid_format"); // no offset
    expect(errorsOf(fails(() => schedulePage(db(), "8", { scheduled_at: at(60), when: 1 }, null), 422))[0]).toMatchObject({ path: "/when", code: "unknown_field" });
    // the range wins over a missing If-Match, with params.min / max in +07:00
    const range = errorsOf(fails(() => schedulePage(db(), "8", { scheduled_at: at(0) }, null), 422))[0];
    expect(range).toMatchObject({ path: "/scheduled_at", code: "out_of_range", params: { min: "2026-11-10T10:01:00+07:00", max: "2027-11-10T10:00:00+07:00" } });
    fails(() => schedulePage(db(), "8", { scheduled_at: at(1) }, null), 428, "PRECONDITION_REQUIRED"); // exactly now + 1 minute is accepted by the range check
    fails(() => schedulePage(db(), "8", { scheduled_at: at(0.5) }, '"1"'), 422, "VALIDATION_FAILED");
    expect(errorsOf(fails(() => schedulePage(db(), "8", { scheduled_at: new Date(NOW.getTime() + 366 * 86_400_000).toISOString() }, '"1"'), 422))[0].code).toBe("out_of_range");
    fails(() => schedulePage(db(), "8", { scheduled_at: at(60) }, '"999"'), 409, "CONFLICT_LOCK_VERSION");
    expect(reasonOf(fails(() => schedulePage(db(), "7", { scheduled_at: at(60) }, pageEtag(7)), 409, "INVALID_STATE"))).toBe("trashed");
    expect(reasonOf(fails(() => schedulePage(db(), "10", { scheduled_at: at(60) }, pageEtag(10)), 409, "INVALID_STATE"))).toBe("nothing_to_publish");
    const blocked = fails(() => schedulePage(db(), "6", { scheduled_at: at(60) }, pageEtag(6)), 422, "PUBLISH_BLOCKED");
    expect(errorsOf(blocked).length).toBeGreaterThan(0);
    expect(errorsOf(blocked)[0].in).toBe("entity");
  });

  it("a draft becomes scheduled: the detail carries the schedule member (+07:00), scheduled_at is the root's, the ETag moves", () => {
    const before = pageEtag(8);
    const out = schedulePage(db(), "8", { scheduled_at: at(120) }, before);
    expect(out.etag).not.toBe(before);
    expect(out.data).toMatchObject({
      status: "scheduled",
      scheduled_at: "2026-11-10T12:00:00.000000+07:00",
      schedule: { action: "publish", run_at: "2026-11-10T12:00:00.000000+07:00", status: "pending", attempts: 0, last_error: null },
      aggregate: { status: "scheduled" },
    });
    // rescheduling an already scheduled entity is allowed (POST again)
    const again = schedulePage(db(), "8", { scheduled_at: at(300) }, out.etag);
    expect(again.data).toMatchObject({ status: "scheduled", schedule: { run_at: "2026-11-10T15:00:00.000000+07:00" } });
  });

  it("works from in_review and archived too; a published page WITHOUT a draft is nothing_to_publish", () => {
    submitPageForReview(db(), "8", undefined, pageEtag(8));
    expect(schedulePage(db(), "8", { scheduled_at: at(60) }, pageEtag(8)).data).toMatchObject({ status: "scheduled" });
    unpublishPage(db(), "10", new URLSearchParams(), pageEtag(10)); // archived
    expect(schedulePage(db(), "10", { scheduled_at: at(60) }, pageEtag(10)).data).toMatchObject({ status: "scheduled" });
  });

  it("a PUBLISHED page with a pending draft (apply_revision): it stays published, the schedule says when the draft goes live; unschedule only drops the booking", () => {
    const out = schedulePage(db(), "9", { scheduled_at: at(90) }, pageEtag(9));
    expect(out.data).toMatchObject({ status: "published", has_unpublished_changes: true, scheduled_at: null, schedule: { action: "apply_revision", status: "pending" } });
    const undone = unschedulePage(db(), "9", out.etag);
    expect(undone.data).toMatchObject({ status: "published", has_unpublished_changes: true, schedule: null });
    fails(() => unschedulePage(db(), "9", undone.etag), 409, "INVALID_STATE");
  });

  it("unschedule: scheduled -> draft when never published, -> archived when it was; not_scheduled otherwise; 428 / 409 as ever; no Idempotency or rate limit involved", () => {
    const first = schedulePage(db(), "8", { scheduled_at: at(60) }, pageEtag(8));
    fails(() => unschedulePage(db(), "8", null), 428, "PRECONDITION_REQUIRED");
    fails(() => unschedulePage(db(), "8", '"1"'), 409, "CONFLICT_LOCK_VERSION");
    expect(unschedulePage(db(), "8", first.etag).data).toMatchObject({ status: "draft", schedule: null, scheduled_at: null });
    expect(reasonOf(fails(() => unschedulePage(db(), "8", pageEtag(8)), 409, "INVALID_STATE"))).toBe("not_scheduled");

    // a page that was published once, then taken down, then scheduled: back to archived
    unpublishPage(db(), "10", new URLSearchParams(), pageEtag(10));
    const s = schedulePage(db(), "10", { scheduled_at: at(60) }, pageEtag(10));
    expect(unschedulePage(db(), "10", s.etag).data).toMatchObject({ status: "archived" });
  });

  it("the rate limit is 60 per hour and answers 429 RATE_LIMITED with Retry-After; the unschedule is never limited", () => {
    let etag = pageEtag(8);
    for (let i = 0; i < SCHEDULE_LIMIT_PER_HOUR; i += 1) etag = schedulePage(db(), "8", { scheduled_at: at(60 + i) }, etag).etag;
    const limited = fails(() => schedulePage(db(), "8", { scheduled_at: at(500) }, etag), 429, "RATE_LIMITED");
    expect(Number(limited.headers["Retry-After"])).toBeGreaterThan(0);
    expect(unschedulePage(db(), "8", etag).data).toMatchObject({ status: "draft" });
    vi.setSystemTime(new Date(NOW.getTime() + 3_700_000));
    schedulePage(db(), "8", { scheduled_at: at(300) }, pageEtag(8));
  });

  it("BR-11: schedule needs schedule AND publish - a role with schedule only, and one without it, get 403 on both routes", () => {
    const etag = pageEtag(8);
    for (const role of ["scheduler", "writer", "reviewer"] as const) {
      setWorkflowRole(db(), role);
      fails(() => schedulePage(db(), "8", { scheduled_at: at(60) }, etag), 403, "FORBIDDEN");
    }
    setWorkflowRole(db(), "full");
    const s = schedulePage(db(), "8", { scheduled_at: at(60) }, etag);
    setWorkflowRole(db(), "scheduler");
    fails(() => unschedulePage(db(), "8", s.etag), 403, "FORBIDDEN");
    // posts: an author holds neither schedule nor publish
    setWorkflowRole(db(), "full");
    setPostRole(db(), "author");
    fails(() => schedulePost(db(), "3", { scheduled_at: at(60) }, postEtag(3)), 403, "FORBIDDEN");
  });

  it("albums and collection entries schedule on the shared engine (no review); their detail carries the schedule member", () => {
    const album = schedulePageLess();
    expect(album).toMatchObject({ status: "scheduled", schedule: { action: "publish" } });
    const entry = db().collectionEntries.find((e) => e.status === "draft" && !e.deleted_at)!;
    const ref = [entry.collection_key, String(entry.id)] as const;
    const out = scheduleEntry(db(), ref[0], ref[1], { scheduled_at: at(60) }, getEntry(db(), ref[0], ref[1]).etag);
    expect(out.data).toMatchObject({ status: "scheduled", schedule: { action: "publish", status: "pending" } });
    expect(unscheduleEntry(db(), ref[0], ref[1], out.etag).data).toMatchObject({ status: "draft", schedule: null });
  });
  function schedulePageLess() {
    const out = scheduleAlbum(db(), "3", { scheduled_at: at(60) }, getAlbum(db(), "3").etag);
    return out.data;
  }

  it("an album published with a pending draft gets an apply_revision booking", () => {
    patchAlbum(db(), "1", { translations: { la: { title: "Forest photo story (edited)" } } }, getAlbum(db(), "1").etag);
    const out = scheduleAlbum(db(), "1", { scheduled_at: at(60) }, getAlbum(db(), "1").etag);
    expect(out.data).toMatchObject({ status: "published", has_unpublished_changes: true, schedule: { action: "apply_revision" } });
  });
});

describe("the scheduler worker stand-in (fire / fail / overdue)", () => {
  it("fire publishes the entity and removes the booking (publish and apply_revision)", () => {
    schedulePage(db(), "8", { scheduled_at: at(60) }, pageEtag(8));
    expect(fireSchedule(db(), "pages", 8)).toBe("published");
    expect(page(8)).toMatchObject({ status: "published", schedule: null, scheduled_at: null });

    schedulePage(db(), "9", { scheduled_at: at(60) }, pageEtag(9));
    expect(fireSchedule(db(), "pages", 9)).toBe("published");
    expect(page(9)).toMatchObject({ status: "published", has_unpublished_changes: false, schedule: null });
  });

  it("the rules run again: a blocked fire uses an attempt (retry), the third gives up - the entity stays scheduled with a failed booking", () => {
    schedulePage(db(), "8", { scheduled_at: at(60) }, pageEtag(8));
    // somebody breaks the page after it was scheduled
    const root = db().pages.find((p) => p.id === 8)!;
    root.live.translations[0].title = "";
    expect(fireSchedule(db(), "pages", 8)).toBe("retry");
    expect(fireSchedule(db(), "pages", 8)).toBe("retry");
    expect(fireSchedule(db(), "pages", 8)).toBe("failed");
    expect(page(8)).toMatchObject({ status: "scheduled", schedule: { status: "failed", attempts: 3, last_error: expect.stringContaining("empty_default_locale") } });
  });

  it("failSchedule / makeScheduleOverdue put a booking into the failed / overdue state; a publish clears it; unschedule still works", () => {
    const s = schedulePage(db(), "8", { scheduled_at: at(60) }, pageEtag(8));
    makeScheduleOverdue(db(), "pages", 8);
    expect(page(8).schedule).toMatchObject({ status: "pending" });
    expect(Date.parse(page(8).schedule!.run_at.replace(/(\.\d{3})\d*/, "$1"))).toBeLessThan(NOW.getTime());
    failSchedule(db(), "pages", 8, "media_alt_missing");
    expect(page(8).schedule).toMatchObject({ status: "failed", attempts: 3, last_error: "media_alt_missing" });
    void s;
    publishPage(db(), "8", new URLSearchParams(), undefined, pageEtag(8)); // "Publish now"
    expect(page(8)).toMatchObject({ status: "published", schedule: null });
  });

  it("posts and entries fire the same way; a patched page keeps its booking", () => {
    schedulePost(db(), "5", { scheduled_at: at(60) }, postEtag(5));
    expect(fireSchedule(db(), "posts", 5)).toBe("published");
    expect(getPost(db(), "5").data).toMatchObject({ status: "published", schedule: null });
    schedulePage(db(), "8", { scheduled_at: at(60) }, pageEtag(8));
    patchPage(db(), "8", { translations: { la: { seo_title: "New SEO title" } } }, pageEtag(8));
    expect(page(8)).toMatchObject({ status: "scheduled", schedule: { status: "pending" } });
    // a collection entry: id "<key>:<id>"
    const entry = db().collectionEntries.find((e) => e.status === "draft" && !e.deleted_at)!;
    scheduleEntry(db(), entry.collection_key, String(entry.id), { scheduled_at: at(60) }, getEntry(db(), entry.collection_key, String(entry.id)).etag);
    expect(fireSchedule(db(), "collection-entries", `${entry.collection_key}:${entry.id}`)).toBe("published");
    expect(getEntry(db(), entry.collection_key, String(entry.id)).data).toMatchObject({ status: "published", schedule: null });
  });
});
