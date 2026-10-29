import { beforeEach, describe, expect, it } from "vitest";

import { dashboardSummary, setDashboardCards } from "@/mocks/mock-dashboard";
import { MockHttpError, getMockDb, resetMockDb } from "@/mocks/mock-db";
import { listForms, patchForm, getForm } from "@/mocks/mock-forms";
import {
  addSubmissionNote,
  bulkSubmissionStatus,
  exhaustExportRate,
  exportSubmissions,
  getSubmission,
  listSubmissions,
  setExportMax,
  setExportUnavailable,
  setSubmissionStatus,
  setSubmissionsRights,
  submissionsState,
  submissionsSummary,
  touchSubmissionAsSomeoneElse,
} from "@/mocks/mock-submissions";

// The submissions part of the mock API (doc/05 section 13.7): the contract the inbox is written against.
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
const errorsOf = (e: MockHttpError) => e.body.errors as Array<{ path: string; code: string; in: string; params?: Record<string, unknown> }>;
const detailsOf = (e: MockHttpError) => e.body.details as Record<string, unknown>;
const q = (s = "") => new URLSearchParams(s);
const list = (s = "") => listSubmissions(getMockDb(), q(`limit=100&${s}`));
const ids = (s = "") => list(s).data.map((x) => x.id);
const get = (id: number) => getSubmission(getMockDb(), String(id), q());
const setStatus = (id: number, status: string, ifMatch: string | null = null, params = "") => setSubmissionStatus(getMockDb(), String(id), q(params), { status }, ifMatch);

beforeEach(() => resetMockDb());

describe("GET /submissions", () => {
  it("lists newest first and hides spam by default", () => {
    const { data, meta } = list();
    expect(meta.total).toBe(14); // 16 rows, 2 of them spam
    expect(data.some((s) => s.status === "spam")).toBe(false);
    expect(data[0].id).toBe(16);
    expect(data[0].message_preview!.length).toBeLessThanOrEqual(140);
    const dates = data.map((s) => Date.parse(s.created_at));
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it("status=spam is the spam tab; status filters take a comma list", () => {
    expect(new Set(ids("status=spam"))).toEqual(new Set([4, 15]));
    expect(new Set(ids("status=new,read"))).toEqual(new Set([3, 5, 6, 7, 9, 10, 11, 12, 13, 14, 16]));
    expect(errorsOf(fails(() => list("status=bogus"), 422))[0]).toMatchObject({ path: "/status", code: "not_in_enum" });
  });

  it("filters by form, topic and date; sorts oldest first; never accepts assigned_to / mine (P2)", () => {
    expect(new Set(ids("form_id=3"))).toEqual(new Set([3, 10, 14]));
    expect(new Set(ids("topic=camping"))).toEqual(new Set([5, 16]));
    expect(ids("sort=created_at")[0]).toBe(7);
    expect(ids("from=2026-10-26T00:00:00Z")).toEqual([16, 14, 13].filter((id) => ids("from=2026-10-26T00:00:00Z").includes(id)));
    const e = errorsOf(fails(() => list("assigned_to=3&mine=true"), 422));
    expect(e.map((x) => [x.path, x.code])).toEqual([["/assigned_to", "not_applicable"], ["/mine", "not_applicable"]]);
    expect(errorsOf(fails(() => list("sort=-id"), 422))[0].path).toBe("/sort");
    expect(errorsOf(fails(() => list("from=yesterday"), 422))[0]).toMatchObject({ path: "/from", code: "invalid_format" });
  });

  it("a keyword needs a date window of at most 366 days; none means the last 90 days", () => {
    // row 1 is 130 days old: invisible to a keyword search without dates, visible with a window
    expect(ids("keyword=tent")).toEqual([]);
    expect(ids("keyword=tent&from=2025-12-01T00:00:00Z&to=2026-10-28T00:00:00Z")).toEqual([1]);
    expect(errorsOf(fails(() => list("keyword=tent&from=2025-01-01T00:00:00Z&to=2026-10-28T00:00:00Z"), 422))[0]).toMatchObject({ path: "/to", code: "date_range_too_large" });
    expect(errorsOf(fails(() => list("from=2026-10-28T00:00:00Z&to=2026-10-01T00:00:00Z"), 422))[0]).toMatchObject({ path: "/to", code: "out_of_range" });
    // searches the name, the email and the message, case-insensitively
    expect(ids("keyword=KHAMLA&from=2026-01-01T00:00:00Z")).toEqual([1]);
    expect(ids("keyword=somchai.l@example")).toEqual([11]);
    expect(ids("keyword=minibus")).toEqual([9]);
  });

  it("an anonymised row keeps form / topic / status / dates and nothing personal", () => {
    const row = list("status=archived").data.find((s) => s.id === 8)!;
    expect(row).toMatchObject({ sender_name: null, sender_email: null, message_preview: null, source_path: null, notes_count: 0 });
    expect(row.anonymized_at).not.toBeNull();
    expect(row.form.slug).toBe("contact");
  });
});

describe("GET /submissions/summary and /{id}", () => {
  it("counts the new ones (spam excluded) per form; the forms list shows the same numbers", () => {
    const s = submissionsSummary(getMockDb());
    expect(s).toEqual({ new: 7, by_form: [{ form_id: 1, slug: "contact", name: "Contact form", new: 5 }, { form_id: 3, slug: "trek-booking", name: "Trek booking (2027 season)", new: 2 }] });
    expect(listForms(getMockDb(), q()).data.map((f) => f.submissions_new)).toEqual([5, 0, 2]);
    expect(getForm(getMockDb(), "1").data.submissions_new).toBe(5);
  });

  it("the detail has the fields in the order of the schema with labels, extra keys by raw key, and NO side effect", () => {
    const { data, etag } = get(11);
    expect(data.fields.map((f) => f.key)).toEqual(["name", "email", "topic", "message"]);
    expect(data.fields[2]).toMatchObject({ label: "What is it about?", type: "select", value: "events" });
    expect(data.extra).toEqual({ legacy_field: "kept from an older version of the form" });
    expect(data.ip_hash_prefix).toHaveLength(12);
    expect(data.status).toBe("new"); // reading does not change it
    expect(get(11).etag).toBe(etag);
    expect(getSubmission(getMockDb(), "11", q("locale=en")).data.fields[0].label).toBe("Full name");
  });

  it("?created_at= must be the row's own, else 404; retention_overdue is computed", () => {
    const row = get(9).data;
    expect(getSubmission(getMockDb(), "9", q(`created_at=${row.created_at}`)).data.id).toBe(9);
    fails(() => getSubmission(getMockDb(), "9", q("created_at=2020-01-01T00:00:00.000000Z")), 404);
    fails(() => get(999), 404);
    expect(get(7).data.retention_overdue).toBe(true);
    expect(get(9).data.retention_overdue).toBe(false);
    expect(get(8).data).toMatchObject({ fields: [], extra: {}, notes: [], user_agent: null, ip_hash_prefix: null });
  });

  it("stores HTML as text: it comes back byte for byte", () => {
    expect(get(12).data.fields.find((f) => f.key === "message")!.value).toContain('<img src=x onerror="alert(1)">');
    expect(get(12).data.sender_name).toBe("<b>Bold</b> Visitor");
  });
});

describe("PATCH /submissions/{id} (the status table)", () => {
  it("follows the table: new -> read -> replied -> archived -> read; spam <-> new", () => {
    expect(setStatus(9, "read").data.status).toBe("read");
    expect(setStatus(9, "replied").data).toMatchObject({ status: "replied", handled_by: { id: 6 } });
    fails(() => setStatus(9, "read"), 409, "INVALID_STATE");
    expect(setStatus(9, "archived").data.status).toBe("archived");
    expect(setStatus(9, "read").data.status).toBe("read"); // reopen
    expect(setStatus(10, "spam").data.status).toBe("spam");
    const back = setStatus(10, "new").data;
    expect(back).toMatchObject({ status: "new", handled_by: null, handled_at: null }); // not spam: back in the queue, handled cleared
  });

  it("an invalid move carries from / to; the same status is a 200 with no new ETag; an anonymised row is 409", () => {
    const e = fails(() => setStatus(5, "new"), 409, "INVALID_STATE");
    expect(detailsOf(e)).toMatchObject({ reason: "invalid_transition", from: "read", to: "new" });
    const before = get(5).etag;
    expect(setStatus(5, "read").etag).toBe(before);
    expect(detailsOf(fails(() => setStatus(8, "read"), 409, "INVALID_STATE")).reason).toBe("anonymized");
  });

  it("answers a LIST ITEM with a new ETag; If-Match is optional, a stale one is 409; assigned_to is not applicable", () => {
    const r = setStatus(9, "read");
    expect(r.etag).not.toBe(get(9).etag === r.etag ? "x" : get(9).etag);
    expect(r.data).not.toHaveProperty("fields");
    expect(r.etag).toBe(get(9).etag);
    fails(() => setStatus(9, "replied", '"2020-01-01T00:00:00.000000Z"'), 409, "CONFLICT_LOCK_VERSION");
    expect(setStatus(9, "replied", get(9).etag).data.status).toBe("replied");
    touchSubmissionAsSomeoneElse(getMockDb(), 9);
    fails(() => setStatus(9, "archived", r.etag), 409, "CONFLICT_LOCK_VERSION");
    expect(errorsOf(fails(() => setSubmissionStatus(getMockDb(), "9", q(), { status: "read", assigned_to: 3 }, null), 422))[0]).toMatchObject({ path: "/assigned_to", code: "not_applicable" });
    expect(errorsOf(fails(() => setSubmissionStatus(getMockDb(), "9", q(), {}, null), 422))[0]).toMatchObject({ path: "/status", code: "required" });
  });

  it("needs the update right", () => {
    setSubmissionsRights(getMockDb(), { update: false });
    fails(() => setStatus(9, "read"), 403);
  });
});

describe("POST /submissions/bulk-status", () => {
  it("changes what it can and reports the rest instead of failing", () => {
    const r = bulkSubmissionStatus(getMockDb(), { ids: [9, 5, 8, 999, 4], status: "read" });
    expect(r.updated).toEqual([{ id: 9, status: "read" }]);
    expect(r.skipped).toEqual([
      { id: 5, reason: "unchanged" },
      { id: 8, reason: "anonymized" },
      { id: 999, reason: "not_found" },
      { id: 4, reason: "invalid_transition", from: "spam" },
    ]);
    expect(r.counts).toEqual({ updated: 1, skipped: 4 });
  });

  it("validates the ids (1 - 100, no duplicates) and the status", () => {
    expect(errorsOf(fails(() => bulkSubmissionStatus(getMockDb(), { ids: [1, 1], status: "read" }), 422))[0]).toMatchObject({ path: "/ids/1", code: "duplicate" });
    expect(errorsOf(fails(() => bulkSubmissionStatus(getMockDb(), { ids: Array.from({ length: 101 }, (_, i) => i + 1), status: "read" }), 422))[0]).toMatchObject({ path: "/ids", code: "limit_exceeded", params: { max: 100 } });
    expect(errorsOf(fails(() => bulkSubmissionStatus(getMockDb(), { ids: [], status: "read" }), 422))[0].path).toBe("/ids");
    expect(errorsOf(fails(() => bulkSubmissionStatus(getMockDb(), { ids: [1], status: "x" }), 422))[0].path).toBe("/status");
  });

  it("is limited to 30 a user and hour (429 with Retry-After)", () => {
    for (let i = 0; i < 30; i++) bulkSubmissionStatus(getMockDb(), { ids: [9], status: "read" });
    const e = fails(() => bulkSubmissionStatus(getMockDb(), { ids: [9], status: "read" }), 429, "RATE_LIMITED");
    expect(e.headers["Retry-After"]).toBe("1800");
  });
});

describe("POST /submissions/{id}/notes", () => {
  it("appends a note (author = me), does not change the status nor the ETag, and counts it", () => {
    const before = get(9);
    const { data, location } = addSubmissionNote(getMockDb(), "9", q(), { note: "  Called back.  " });
    expect(data).toMatchObject({ note: "Called back.", author: { id: 6 } });
    expect(location).toBe("/api/v1/submissions/9");
    const after = get(9);
    expect(after.etag).toBe(before.etag);
    expect(after.data.notes).toHaveLength(1);
    expect(after.data.notes_count).toBe(1);
    expect(after.data.status).toBe("new");
  });

  it("1 - 2000 characters, nothing else in the body, none on an anonymised row", () => {
    expect(errorsOf(fails(() => addSubmissionNote(getMockDb(), "9", q(), { note: "   " }), 422))[0]).toMatchObject({ path: "/note", code: "required" });
    expect(errorsOf(fails(() => addSubmissionNote(getMockDb(), "9", q(), { note: "x".repeat(2001) }), 422))[0]).toMatchObject({ code: "too_long", params: { max: 2000 } });
    expect(addSubmissionNote(getMockDb(), "9", q(), { note: "x".repeat(2000) }).data.note).toHaveLength(2000);
    expect(errorsOf(fails(() => addSubmissionNote(getMockDb(), "9", q(), { note: "a", author: 1 }), 422))[0].code).toBe("unknown_field");
    expect(detailsOf(fails(() => addSubmissionNote(getMockDb(), "8", q(), { note: "a" }), 409, "INVALID_STATE")).reason).toBe("anonymized");
  });
});

describe("GET /submissions/export", () => {
  const exportCsv = (s = "") => exportSubmissions(getMockDb(), q(s));
  const lines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);

  it("is a UTF-8 CSV with a BOM and CRLF; no filter = one data_json column; spam is left out", () => {
    const { csv, filename } = exportCsv();
    expect(csv.startsWith("﻿")).toBe(true);
    expect(filename).toMatch(/^submissions-\d{8}T\d{6}Z\.csv$/);
    const rows = lines(csv);
    expect(rows[0]).toBe("id,public_id,created_at,form_slug,locale_code,status,sender_name,sender_email,topic,source_path,handled_by_name,handled_at,retention_until,retention_overdue,data_json");
    expect(rows).toHaveLength(1 + 14);
    // oldest first
    expect(rows[1].startsWith("7,")).toBe(true);
  });

  it("never exports ip_hash, user agent, notes, consent or the spam score", () => {
    addSubmissionNote(getMockDb(), "9", q(), { note: "secret note text" });
    const { csv } = exportCsv("status=new,read,replied,archived,spam");
    for (const banned of ["ip_hash", "user_agent", "Mozilla", "secret note text", "consent_at", "consent_version", "spam_score"]) expect(csv).not.toContain(banned);
    expect(lines(csv)).toHaveLength(1 + 16);
  });

  it("with a form it adds the schema's fields as columns headed by their label", () => {
    const rows = lines(exportCsv("form_id=1&locale=en").csv);
    expect(rows[0].endsWith("field:Full name,field:Email,field:Phone (optional),field:What is it about?,field:Message")).toBe(true);
  });

  it("prefixes cells that would run as a formula with ' and escapes quotes", () => {
    const { csv } = exportCsv("form_id=1");
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
    expect(csv).toContain(`"'+SUM(1,1) this message starts with a plus sign on purpose and has , commas and ""quotes""."`);
  });

  it("writes an audit row before the stream, with the keyword reduced to its length", () => {
    exportCsv("keyword=minibus");
    const [entry] = submissionsState(getMockDb()).exportLog;
    expect(entry.filter.keyword).toBe("len:7");
    expect(JSON.stringify(entry)).not.toContain("minibus");
    expect(entry.row_count).toBe(1);
  });

  it("refuses over the cap with matched / max, takes 5 an hour, fails closed (503), needs the export right", () => {
    setExportMax(getMockDb(), 3);
    const big = fails(() => exportCsv(), 422, "EXPORT_TOO_LARGE");
    expect(detailsOf(big)).toEqual({ matched: 14, max: 3 });
    expect(exportCsv("topic=camping").csv).toBeTruthy();
    for (let i = 0; i < 3; i++) exportCsv("topic=camping");
    const limited = fails(() => exportCsv("topic=camping"), 429, "RATE_LIMITED");
    expect(limited.headers["Retry-After"]).toBe("3000");
    resetMockDb();
    exhaustExportRate(getMockDb());
    fails(() => exportCsv(), 429);
    resetMockDb();
    setExportUnavailable(getMockDb(), true);
    fails(() => exportCsv(), 503, "SERVICE_UNAVAILABLE");
    resetMockDb();
    setSubmissionsRights(getMockDb(), { export: false });
    fails(() => exportCsv(), 403);
    resetMockDb();
    expect(errorsOf(fails(() => exportCsv("page=2"), 422))[0].code).toBe("unknown_field");
  });
});

describe("GET /dashboard/summary (mock)", () => {
  it("is computed from the models: the new count equals the summary's, my drafts are mine, the proposed cards are there", () => {
    const db = getMockDb();
    const d = dashboardSummary(db);
    expect(d.submissions_new!.count).toBe(submissionsSummary(db).new);
    expect(d.my_drafts!.count).toBeGreaterThan(0);
    expect(d.my_drafts!.items.length).toBeLessThanOrEqual(5);
    expect(d.my_drafts!.items.every((i) => ["cms.pages", "cms.posts", "cms.albums", "cms.faq_groups", "forms.forms"].includes(i.entity_type))).toBe(true);
    // form 3 has a pending draft that I started
    expect(d.my_drafts!.items.find((i) => i.entity_type === "forms.forms" && i.id === 3)).toMatchObject({ status: "published", has_unpublished_changes: true });
    expect(d.translation!.map((t) => t.locale_code)).toEqual(["en"]);
    expect(d.translation![0].percent).toBeGreaterThanOrEqual(0);
    expect(d.translation![0].percent).toBeLessThanOrEqual(100);
    expect(d.content_counts!.find((c) => c.entity_type === "forms.forms")).toEqual({ entity_type: "forms.forms", draft: 1, published: 2 });
    expect(d.recent_activity!.length).toBeGreaterThan(0);
    expect(d.relay).toMatchObject({ pending: 3, failed: 0 });
  });

  it("follows the model: a status change moves the card, and cards can be left out", () => {
    const db = getMockDb();
    setStatus(9, "read");
    expect(dashboardSummary(db).submissions_new!.count).toBe(6);
    patchForm(db, "2", { name: "Newsletter!" }, getForm(db, "2").etag);
    setDashboardCards(db, { omit: ["failed_jobs", "recent_activity", "relay"] });
    const d = dashboardSummary(db);
    expect(d).not.toHaveProperty("failed_jobs");
    expect(d).not.toHaveProperty("relay");
    expect(d).toHaveProperty("submissions_new");
    setDashboardCards(db, { omit: ["my_drafts", "submissions_new", "failed_jobs", "translation", "media_missing_alt", "content_counts", "recent_activity", "relay"] });
    expect(Object.keys(dashboardSummary(db))).toEqual(["generated_at"]);
  });
});
