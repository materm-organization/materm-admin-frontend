import { beforeEach, describe, expect, it } from "vitest";

import { MockHttpError, getMockDb, resetMockDb } from "@/mocks/mock-db";
import {
  createPage,
  deletePage,
  discardDraft,
  getPage,
  getPageRevision,
  getReferences,
  getTemplates,
  listPageRevisions,
  listPages,
  listSections,
  patchPage,
  patchSection,
  publishPage,
  restorePage,
  restorePageRevision,
  setHome,
  unpublishPage,
  withIdempotency,
} from "@/mocks/mock-pages";
import type { PublishIssue } from "@/types/publishing";

// The pages / publish engine / page revisions part of the mock API (doc/05 section 12): the contract a screen written
// against it may rely on.
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
const etag = (id: number) => getPage(getMockDb(), String(id)).etag;
const reason = (e: MockHttpError) => (e.body.details as { reason: string }).reason;

beforeEach(() => resetMockDb());

describe("GET /pages and /page-templates", () => {
  it("lists the seeded pages with the lifecycle block, translation status and the draft ref of page 9", () => {
    const db = getMockDb();
    const { data, meta } = listPages(db, q("limit=100"));
    expect(meta.total).toBe(9); // page 7 is in the trash
    const events = data.find((p) => p.id === 9)!;
    expect(events).toMatchObject({ key: "events", status: "published", has_unpublished_changes: true, lock_version: 4, is_system: false, section_count: 3 });
    expect(events.draft).toMatchObject({ version: 5 });
    expect(events.translation_status.en).toEqual({ enabled: true, title: true, seo_title: true, seo_description: true });
    expect(data.find((p) => p.id === 1)).toMatchObject({ is_home: true, is_system: true, path: "/" });
    expect(listPages(db, q("trashed=true")).data.map((p) => p.id)).toEqual([7]);
    expect(listPages(db, q("trashed=true")).data[0].purge_at).not.toBeNull();
  });

  it("filters (status, template, is_home, has_unpublished_changes, keyword) and sorts; the menu picker still gets id / name / title / path / status", () => {
    const db = getMockDb();
    expect(listPages(db, q("status=draft")).data.map((p) => p.id)).toEqual([6, 8]);
    expect(listPages(db, q("status=draft,archived&template=standard")).data.map((p) => p.id)).toEqual([6, 8]);
    expect(listPages(db, q("is_home=true")).data.map((p) => p.id)).toEqual([1]);
    expect(listPages(db, q("has_unpublished_changes=true")).data.map((p) => p.id)).toEqual([9]);
    expect(listPages(db, q("keyword=SUMMER")).data.map((p) => p.id)).toEqual([8]);
    expect(listPages(db, q("sort=-path&limit=3")).data.map((p) => p.path)).toEqual(["/team", "/summer", "/spring"]);
    const row = listPages(db, q("limit=100")).data.find((p) => p.id === 3)!;
    expect(row).toMatchObject({ name: "The Blog", title: "The Blog", path: "/blog", status: "published" });
  });

  it("is strict: an unknown parameter, a bad status / sort / boolean / locale are 422 with pointers", () => {
    const db = getMockDb();
    expect(errorsOf(fails(() => listPages(db, q("foo=1")), 422))).toEqual([{ in: "query", path: "/foo", code: "unknown_field" }]);
    const e = fails(() => listPages(db, q("status=live&sort=colour&locale=xx")), 422);
    expect(errorsOf(e).map((x) => x.path).sort()).toEqual(["/locale", "/sort", "/status"]);
    expect(errorsOf(fails(() => listPages(db, q("is_home=yes")), 422))).toEqual([{ in: "query", path: "/is_home", code: "invalid_format" }]);
    fails(() => listPages(db, q("has_draft=true")), 422); // the old name is gone: it is has_unpublished_changes
  });

  it("GET /pages/{id}: working copy + ETag \"<lock_version>\"; the working copy of a published page with a draft is the draft", () => {
    const db = getMockDb();
    const events = getPage(db, "9");
    expect(events.etag).toBe('"4"');
    expect(events.data.title).toBe("Events and treks");
    expect(events.data.translations.la.title).toBe("Events and treks");
    expect(events.data.sections_missing).toEqual({ la: 0, en: 0 });
    fails(() => getPage(db, "999"), 404);
    // page 6: the hero has no default-language title
    expect(getPage(db, "6").data.sections_missing.la).toBeGreaterThan(0);
    expect(getPage(db, "6").data.missing_locales).toEqual([]);
  });

  it("page-templates: four rows, `standard` is the default, no parameters accepted", () => {
    const db = getMockDb();
    const t = getTemplates(db, q());
    expect(t.map((x) => x.key)).toEqual(["home", "standard", "blog_index", "contact"]);
    expect(t.filter((x) => x.is_default).map((x) => x.key)).toEqual(["standard"]);
    expect(t.find((x) => x.key === "contact")!.initial_sections.map((s) => s.section_type_key)).toEqual(["hero_brand", "contact_section"]);
    expect(t.find((x) => x.key === "contact")!.required.map((r) => r.kind)).toEqual(["group", "type"]);
    expect(t.find((x) => x.key === "standard")!.page_count).toBe(6); // our-path, gallery, 6, 8, 9, 10
    fails(() => getTemplates(db, q("x=1")), 422);
  });
});

describe("POST /pages", () => {
  const body = { template: "standard", path: "/events-2", translations: { la: { title: "Events 2" }, en: { title: "Events two" } } };

  it("creates a draft with the template's initial sections, ETag \"1\", key from the path", () => {
    const db = getMockDb();
    const { data, etag: tag } = createPage(db, body);
    expect(tag).toBe('"1"');
    expect(data).toMatchObject({ key: "events-2", name: "Events 2", status: "draft", lock_version: 1, has_unpublished_changes: false, section_count: 1, is_home: false });
    expect(data.sections).toHaveLength(1);
    expect(data.sections[0]).toMatchObject({ section_type: { key: "hero_brand" }, required: true });
    expect(data.aggregate).toMatchObject({ entity_type: "cms.pages", lock_version: 1, status: "draft" });
    // the new hero has no default-language title, so it blocks by itself
    expect(data.sections_missing.la).toBeGreaterThan(0);
  });

  it("validates path, template, translations and unknown fields; duplicates are 409 with the pointer", () => {
    const db = getMockDb();
    const paths = ["/", "/Bad", "/admin/x", "/blog/x", "/_next", "/a b"];
    for (const path of paths) expect(errorsOf(fails(() => createPage(db, { ...body, path }), 422))[0]).toMatchObject({ path: "/path", code: "pattern_mismatch" });
    expect(errorsOf(fails(() => createPage(db, { ...body, path: "/blog/x" }), 422))[0].params).toEqual({ rule: "blog_child" });
    expect(errorsOf(fails(() => createPage(db, { ...body, template: "nope" }), 422))[0]).toMatchObject({ path: "/template", code: "not_in_enum" });
    expect(errorsOf(fails(() => createPage(db, { ...body, translations: { en: { title: "x" } } }), 422))[0]).toMatchObject({ path: "/translations/la/title", code: "required" });
    expect(errorsOf(fails(() => createPage(db, { ...body, colour: "red" }), 422))).toEqual([{ in: "body", path: "/colour", code: "unknown_field" }]);
    const dup = fails(() => createPage(db, { ...body, path: "/team" }), 409, "CONFLICT_DUPLICATE");
    expect(errorsOf(dup)[0]).toMatchObject({ path: "/path", code: "duplicate" });
    fails(() => createPage(db, { ...body, key: "team" }), 409, "CONFLICT_DUPLICATE");
  });

  it("Idempotency-Key: the same key + request replays, the same key with another request is a 422", () => {
    const db = getMockDb();
    const run = () => ({ status: 201, ...createPage(db, body) });
    const first = withIdempotency(db, "k1", "POST /pages", run);
    const again = withIdempotency(db, "k1", "POST /pages", run);
    expect(again.replayed).toBe(true);
    expect((again.data as { id: number }).id).toBe((first.data as { id: number }).id);
    expect(db.pages.filter((p) => p.live.page.path === "/events-2")).toHaveLength(1);
    fails(() => withIdempotency(db, "k1", "POST /other", run), 422, "IDEMPOTENCY_KEY_REUSED");
  });
});

describe("PATCH /pages/{id} and the working copy (05 12.2.2)", () => {
  it("If-Match is mandatory (428), a stale one is 409; immutable and not-applicable fields are 422", () => {
    const db = getMockDb();
    fails(() => patchPage(db, "8", { name: "x" }, null), 428);
    fails(() => patchPage(db, "8", { name: "x" }, '"99"'), 409, "CONFLICT_LOCK_VERSION");
    const e = fails(() => patchPage(db, "8", { key: "k", is_home: true, parent_id: 3, nope: 1 }, etag(8)), 422);
    expect(errorsOf(e).map((x) => `${x.path}:${x.code}`)).toEqual(["/key:immutable", "/is_home:immutable", "/parent_id:not_applicable", "/nope:unknown_field"]);
    fails(() => patchPage(db, "8", {}, etag(8)), 422);
  });

  it("a page that is not published is written in place; a published one gets ONE draft row and its live rows stay", () => {
    const db = getMockDb();
    const draftPage = patchPage(db, "8", { name: "Summer 2027" }, etag(8));
    expect(draftPage.data).toMatchObject({ name: "Summer 2027", has_unpublished_changes: false, lock_version: 2 });
    expect(draftPage.etag).toBe('"2"');

    const before = getPage(db, "10");
    const patched = patchPage(db, "10", { translations: { en: { title: "The team" } } }, before.etag);
    expect(patched.data).toMatchObject({ has_unpublished_changes: true, status: "published", lock_version: 2 });
    expect(patched.data.aggregate.has_unpublished_changes).toBe(true);
    expect(db.pages.find((p) => p.id === 10)!.live.translations[1].title).toBe("Team"); // live untouched
    const second = patchPage(db, "10", { translations: { en: { title: "The Materm team" } } }, patched.etag);
    expect(second.data.lock_version).toBe(3);
    expect(db.revisions["pages/10"].filter((r) => r.kind === "draft")).toHaveLength(1);
  });

  it("no change = 200 with the same ETag and no side effect; a changed path of a published page warns", () => {
    const db = getMockDb();
    const same = patchPage(db, "8", { name: "Summer trek" }, etag(8));
    expect(same.etag).toBe('"1"');
    const moved = patchPage(db, "10", { path: "/people" }, etag(10));
    expect(moved.data.warnings).toEqual([{ path: "/path", code: "path_changed_published", params: { old_path: "/team" } }]);
  });

  it("the home page can not change its path, a taken path is 409, the default language can not be removed", () => {
    const db = getMockDb();
    expect(errorsOf(fails(() => patchPage(db, "1", { path: "/x" }, etag(1)), 422))[0]).toMatchObject({ path: "/path", code: "immutable", params: { reason: "is_home" } });
    fails(() => patchPage(db, "8", { path: "/team" }, etag(8)), 409, "CONFLICT_DUPLICATE");
    expect(errorsOf(fails(() => patchPage(db, "8", { translations: { la: null } }, etag(8)), 422))[0]).toMatchObject({ path: "/translations/la", code: "required" });
  });

  it("sections: PATCH replaces props / visibility, needs the page's ETag and moves it", () => {
    const db = getMockDb();
    const sections = listSections(db, "8", q()).data;
    expect(sections[0]).toMatchObject({ section_type: { key: "hero_brand" }, required: true });
    fails(() => patchSection(db, "8", String(sections[0].id), { is_visible: false }, null), 428);
    const done = patchSection(db, "8", String(sections[0].id), { is_visible: false }, etag(8));
    expect(done.data.section.is_visible).toBe(false);
    expect(done.data.aggregate.lock_version).toBe(2);
    expect(done.etag).toBe('"2"');
    fails(() => patchSection(db, "8", String(sections[0].id), { section_type_key: "faq" }, etag(8)), 422);
  });
});

describe("publish (05 12.7.2)", () => {
  const blockers = (e: MockHttpError) => errorsOf(e) as PublishIssue[];

  it("needs If-Match even for a dry run (428); dry_run is the only query parameter, change_note the only field", () => {
    const db = getMockDb();
    fails(() => publishPage(db, "8", q("dry_run=true"), undefined, null), 428);
    fails(() => publishPage(db, "8", q("force=true"), undefined, etag(8)), 422);
    fails(() => publishPage(db, "8", q(), { note: "x" }, etag(8)), 422);
    fails(() => publishPage(db, "8", q("dry_run=maybe"), undefined, etag(8)), 422);
    fails(() => publishPage(db, "8", q(), undefined, '"7"'), 409, "CONFLICT_LOCK_VERSION");
  });

  it("blockers of a page that can not be published: empty default-language texts, a trashed page, an unpublished album", () => {
    const db = getMockDb();
    const e = fails(() => publishPage(db, "6", q(), undefined, etag(6)), 422, "PUBLISH_BLOCKED");
    const list = blockers(e);
    const codes = list.map((x) => `${x.code}@${x.path.replace(/0192d3a4-7c1e-7b52-9d0a-3f5e2a1b5\d{3}/, "<sec>")}`);
    expect(codes).toEqual([
      "empty_default_locale@/translations/la/seo_title",
      "unknown_reference@/sections/<sec>/props/cta/link/page_id",
      "empty_default_locale@/sections/<sec>/props/title/la",
      "reference_not_published@/sections/<sec>/props/album_id",
    ]);
    expect(list.every((x) => x.in === "entity")).toBe(true);
    // every section blocker carries the section it belongs to
    expect(list[1].params).toMatchObject({ section_key: "hero_brand", section_index: 0, ref_type: "pages", ref_id: 7 });
    expect(list[3].params).toMatchObject({ section_key: "photo_story", section_index: 1, ref_type: "albums", ref_id: 2 });
    expect(detailsOf(e)).toMatchObject({ blocker_count: 4, truncated: false });
    // the hidden intro_text would block too: one warning, not a blocker; the English SEO text is there
    const warnings = detailsOf(e).warnings as PublishIssue[];
    expect(warnings.map((w) => w.code)).toEqual(["section_hidden_unchecked"]);
    // a failed publish changes nothing
    expect(etag(6)).toBe('"1"');
  });

  it("template rules: no visible hero is hero_required, a missing contact_section is section_required", () => {
    const db = getMockDb();
    const hero = listSections(db, "8", q()).data[0];
    const r1 = patchSection(db, "8", String(hero.id), { is_visible: false }, etag(8));
    const e = fails(() => publishPage(db, "8", q("dry_run=true"), undefined, r1.etag), 422, "PUBLISH_BLOCKED");
    expect(blockers(e).find((x) => x.code === "template_violation")).toMatchObject({ in: "entity", path: "/sections", params: { rule: "hero_required", template: "standard" } });

    const contact = createPage(db, { template: "contact", path: "/hello", translations: { la: { title: "Hello", seo_title: "Hello" } } });
    const secs = listSections(db, String(contact.data.id), q()).data;
    const hide = patchSection(db, String(contact.data.id), String(secs[1].id), { is_visible: false }, contact.etag);
    const f = fails(() => publishPage(db, String(contact.data.id), q("dry_run=true"), undefined, hide.etag), 422);
    expect(blockers(f).find((x) => x.code === "template_violation")).toMatchObject({ params: { rule: "section_required", section_key: "contact_section" } });
  });

  it("dry_run that passes: publishable + warnings, no ETag, nothing changed (a link to an unpublished page is a WARNING)", () => {
    const db = getMockDb();
    const r = publishPage(db, "8", q("dry_run=true"), undefined, etag(8));
    expect(r.etag).toBeUndefined();
    expect(r.data).toMatchObject({ publishable: true });
    const codes = (r.data as { warnings: PublishIssue[] }).warnings.map((w) => w.code);
    expect(codes).toEqual(["translation_incomplete", "link_page_not_published"]);
    expect((r.data as { warnings: PublishIssue[] }).warnings[0].params).toMatchObject({ locale: "en", missing: 1 });
    expect(etag(8)).toBe('"1"');
    expect(db.pages.find((p) => p.id === 8)!.status).toBe("draft");
  });

  it("publishes a draft page: status, published_at, a `published` revision, the new ETag and the aggregate stamp", () => {
    const db = getMockDb();
    const r = publishPage(db, "8", q(), { change_note: "first version" }, etag(8));
    expect(r.etag).toBe('"2"');
    const data = r.data as { status: string; published_at: string; first_published_at: string; has_unpublished_changes: boolean; aggregate: { lock_version: number; status: string }; published_revision: { id: number; version: number }; warnings: unknown[] };
    expect(data).toMatchObject({ status: "published", has_unpublished_changes: false });
    expect(data.published_at).toBe(data.first_published_at);
    expect(data.aggregate).toMatchObject({ lock_version: 2, status: "published" });
    expect(data.warnings).toHaveLength(2);
    const revs = listPageRevisions(db, "8", q()).data;
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ kind: "published", change_note: "first version", is_live: true, id: data.published_revision.id });
    // published without a draft: nothing to publish
    expect(reason(fails(() => publishPage(db, "8", q(), undefined, r.etag!), 409, "INVALID_STATE"))).toBe("nothing_to_publish");
  });

  it("publishes the pending draft of a published page: the draft's rows go live and the draft row becomes the `published` row", () => {
    const db = getMockDb();
    const r = publishPage(db, "9", q(), undefined, etag(9));
    expect(r.data).toMatchObject({ status: "published", has_unpublished_changes: false, title: "Events and treks" });
    const page = db.pages.find((p) => p.id === 9)!;
    expect(page.live.translations[0].title).toBe("Events and treks");
    expect(page.live.sections).toHaveLength(3);
    const rows = db.revisions["pages/9"];
    expect(rows.some((x) => x.kind === "draft")).toBe(false);
    expect(rows.filter((x) => x.kind === "published").map((x) => x.version)).toEqual([1, 3, 5]);
  });

  it("a trashed page answers INVALID_STATE trashed", () => {
    const db = getMockDb();
    expect(reason(fails(() => publishPage(db, "7", q(), undefined, etag(7)), 409, "INVALID_STATE"))).toBe("trashed");
  });
});

describe("unpublish, discard-draft and the draft history (decided 2026-10-28)", () => {
  it("unpublish ALWAYS succeeds: a pending draft becomes a history row, the warning draft_kept_as_history is returned, live stays", () => {
    const db = getMockDb();
    // page 9 is referenced by page 10: confirm it first (that is another rule)
    const e = fails(() => unpublishPage(db, "9", q(), etag(9)), 409, "ENTITY_REFERENCED");
    expect((detailsOf(e).references as unknown[]).length).toBe(1);
    expect(detailsOf(e).total_references).toBe(1);
    const r = unpublishPage(db, "9", q("confirm_references=true"), etag(9));
    expect(r.data).toMatchObject({ status: "archived", has_unpublished_changes: false });
    expect(r.data.warnings.map((w) => w.code)).toEqual(["page_referenced", "draft_kept_as_history"]);
    expect(r.data.title).toBe("Events"); // the live rows, not the draft
    const rows = db.revisions["pages/9"];
    expect(rows.find((x) => x.version === 5)).toMatchObject({ kind: "history", change_note: "unpublish" });
    expect(rows.some((x) => x.kind === "draft")).toBe(false);
  });

  it("unpublish without a draft has no draft_kept_as_history; the home page, an unpublished page and a stale ETag are refused", () => {
    const db = getMockDb();
    const r = unpublishPage(db, "10", q(), etag(10));
    expect(r.data.warnings).toEqual([]);
    expect(r.data.status).toBe("archived");
    expect(reason(fails(() => unpublishPage(db, "1", q(), etag(1)), 409, "INVALID_STATE"))).toBe("is_home");
    expect(reason(fails(() => unpublishPage(db, "8", q(), etag(8)), 409, "INVALID_STATE"))).toBe("not_published");
    fails(() => unpublishPage(db, "10", q(), '"1"'), 409, "CONFLICT_LOCK_VERSION");
    fails(() => unpublishPage(db, "10", q("force=true"), etag(10)), 422);
    fails(() => unpublishPage(db, "10", q(), null), 428);
  });

  it("discard-draft turns the draft into a history row (change note \"discarded\", still listed), the page equals live", () => {
    const db = getMockDb();
    fails(() => discardDraft(db, "9", null), 428);
    const r = discardDraft(db, "9", etag(9));
    expect(r.data).toMatchObject({ has_unpublished_changes: false, lock_version: 5, title: "Events" });
    expect(r.etag).toBe('"5"');
    const rows = listPageRevisions(db, "9", q()).data;
    expect(rows.find((x) => x.version === 5)).toMatchObject({ kind: "history", change_note: "discarded" });
    expect(reason(fails(() => discardDraft(db, "9", r.etag), 409, "INVALID_STATE"))).toBe("no_draft");
    expect(reason(fails(() => discardDraft(db, "8", etag(8)), 409, "INVALID_STATE"))).toBe("no_draft");
  });
});

describe("delete, restore, set-home, references", () => {
  it("delete: the home and the system pages are refused, a referenced page needs confirm_references, a deleted page can be restored", () => {
    const db = getMockDb();
    expect(reason(fails(() => deletePage(db, "1", q(), etag(1)), 409, "INVALID_STATE"))).toBe("is_home");
    expect(reason(fails(() => deletePage(db, "2", q(), etag(2)), 409, "INVALID_STATE"))).toBe("system_page");
    fails(() => deletePage(db, "9", q(), null), 428);
    fails(() => deletePage(db, "9", q(), etag(9)), 409, "ENTITY_REFERENCED");
    const done = deletePage(db, "9", q("confirm_references=true"), etag(9));
    expect(done.data!.warnings.map((w) => w.code)).toEqual(["page_referenced", "draft_kept_as_history"]);
    expect(listPages(db, q("trashed=true")).data.map((p) => p.id)).toEqual([9, 7]);
    // deleting again is a no-op
    expect(deletePage(db, "9", q(), done.etag).data).toBeNull();

    const back = restorePage(db, "9", done.etag);
    expect(back.data).toMatchObject({ status: "draft", deleted_at: null });
    expect(reason(fails(() => restorePage(db, "9", back.etag), 409, "INVALID_STATE"))).toBe("not_trashed");
  });

  it("restore: a path or key taken meanwhile is 409 CONFLICT_DUPLICATE with the pointers", () => {
    const db = getMockDb();
    createPage(db, { template: "standard", path: "/old-promo", translations: { la: { title: "New promo" } } });
    const e = fails(() => restorePage(db, "7", etag(7)), 409, "CONFLICT_DUPLICATE");
    expect(errorsOf(e).map((x) => x.path)).toContain("/path");
  });

  it("set-home: only a published page, atomic swap, both ETags move, the draft paths are patched too", () => {
    const db = getMockDb();
    expect(reason(fails(() => setHome(db, "8", undefined, etag(8)), 409, "INVALID_STATE"))).toBe("not_published");
    fails(() => setHome(db, "10", undefined, null), 428);
    expect(errorsOf(fails(() => setHome(db, "10", { previous_home_path: "/events" }, etag(10)), 409, "CONFLICT_DUPLICATE"))[0]).toMatchObject({ path: "/previous_home_path", code: "duplicate" });
    fails(() => setHome(db, "10", { colour: 1 }, etag(10)), 422);
    const r = setHome(db, "9", { previous_home_path: "/old-home" }, etag(9));
    expect(r.data.page).toMatchObject({ id: 9, is_home: true, path: "/" });
    expect(r.data.previous_home).toMatchObject({ id: 1, key: "home", path: "/old-home" });
    expect(r.data.aggregates).toHaveLength(2);
    expect(listPages(db, q("is_home=true")).data.map((p) => p.id)).toEqual([9]);
    // the draft of page 9 carries the new path as well (a later publish must not undo it)
    expect((db.revisions["pages/9"].find((x) => x.kind === "draft")!.snapshot as { page: { path: string } }).page.path).toBe("/");
    // already home: a no-op
    expect(setHome(db, "9", undefined, r.etag).data.previous_home).toBeNull();
  });

  it("set-home without a body names the old home's key as its path", () => {
    const db = getMockDb();
    setHome(db, "10", undefined, etag(10));
    expect(db.pages.find((p) => p.id === 1)!.live.page.path).toBe("/home");
  });

  it("references: menu items and section props (live and draft) that point at the page", () => {
    const db = getMockDb();
    expect(getReferences(db, "9")).toMatchObject({ total_references: 1, truncated: false, references: [{ entity_type: "cms.page", id: 10, kind: "section_props", in_draft: false }] });
    expect(getReferences(db, "3").references.map((r) => r.kind)).toEqual(expect.arrayContaining(["menu_item"]));
    expect(getReferences(db, "3").references.find((r) => r.kind === "menu_item")).toMatchObject({ entity_type: "cms.menu_item", field: "/link/page_id" });
    expect(getReferences(db, "8").total_references).toBe(0);
  });
});

describe("revisions of a publishable page (05 12.8)", () => {
  it("lists draft / published / history / restore rows, hides the preview row, marks the live one", () => {
    const db = getMockDb();
    const rows = listPageRevisions(db, "9", q()).data;
    expect(rows.map((r) => `${r.version}:${r.kind}`)).toEqual(["5:draft", "3:published", "2:history", "1:published"]);
    expect(rows.find((r) => r.is_live)!.version).toBe(3);
    const all = listPageRevisions(db, "9", q("include_preview=true")).data;
    expect(all.map((r) => r.version)).toEqual([5, 4, 3, 2, 1]);
    expect(all.find((r) => r.version === 4)).toMatchObject({ kind: "history", change_note: "preview", is_preview: true });
    expect(listPageRevisions(db, "9", q("kind=published")).data.map((r) => r.version)).toEqual([3, 1]);
    expect(listPageRevisions(db, "9", q("sort=version")).data[0].version).toBe(1);
  });

  it("is strict: unknown kind / parameter are 422", () => {
    const db = getMockDb();
    fails(() => listPageRevisions(db, "9", q("kind=live")), 422);
    fails(() => listPageRevisions(db, "9", q("x=1")), 422);
    fails(() => listPageRevisions(db, "999", q()), 404);
  });

  it("one revision: the snapshot of doc/04 5.2 and is_live", () => {
    const db = getMockDb();
    const rev = listPageRevisions(db, "9", q()).data.find((r) => r.is_live)!;
    const detail = getPageRevision(db, "9", String(rev.id));
    expect(detail).toMatchObject({ is_live: true, entity: { type: "cms.pages", id: 9, key: "events" } });
    expect(Object.keys(detail.snapshot)).toEqual(["page", "translations", "sections"]);
    fails(() => getPageRevision(db, "9", "99999"), 404);
  });

  it("restore of a published page becomes the DRAFT (not live) and keeps the previous working copy as a `restore` row", () => {
    const db = getMockDb();
    const old = listPageRevisions(db, "9", q("sort=version")).data[0]; // v1: "Events (old)", one section
    fails(() => restorePageRevision(db, "9", String(old.id), undefined, null), 428);
    fails(() => restorePageRevision(db, "9", String(old.id), undefined, '"1"'), 409, "CONFLICT_LOCK_VERSION");
    const r = restorePageRevision(db, "9", String(old.id), { change_note: "back to the first" }, etag(9));
    expect(r.data).toMatchObject({ title: "Events (old)", has_unpublished_changes: true, status: "published", restored_from: { revision_id: old.id, version: 1 } });
    expect(r.etag).toBe('"5"');
    expect(db.pages.find((p) => p.id === 9)!.live.translations[0].title).toBe("Events"); // still the live text
    const rows = listPageRevisions(db, "9", q()).data;
    expect(rows.find((x) => x.kind === "restore")).toMatchObject({ change_note: "back to the first" });
    expect(rows.filter((x) => x.kind === "draft")).toHaveLength(1);
  });

  it("restore of a page that is not published is applied to the real rows (has_unpublished_changes stays false)", () => {
    const db = getMockDb();
    // page 8: edit it, then restore the checkpoint taken before the edit
    patchPage(db, "8", { name: "Summer 2027" }, etag(8));
    const checkpoint = listPageRevisions(db, "8", q()).data[0];
    expect(checkpoint.kind).toBe("history");
    const r = restorePageRevision(db, "8", String(checkpoint.id), undefined, etag(8));
    expect(r.data).toMatchObject({ name: "Summer trek", has_unpublished_changes: false });
    expect(db.pages.find((p) => p.id === 8)!.live.page.name).toBe("Summer trek");
  });

  it("restoring the current draft is a 200 without side effects; a snapshot of a newer schema is INVALID_STATE", () => {
    const db = getMockDb();
    const draft = listPageRevisions(db, "9", q()).data.find((r) => r.kind === "draft")!;
    const r = restorePageRevision(db, "9", String(draft.id), undefined, etag(9));
    expect(r.etag).toBe('"4"');
    const future = db.revisions["pages/1"].find((x) => x.schema_version === 99)!;
    expect(reason(fails(() => restorePageRevision(db, "1", String(future.id), undefined, etag(1)), 409, "INVALID_STATE"))).toBe("snapshot_incompatible");
  });

  it("restore checks references first (422 in:entity, nothing applied) and the path (409)", () => {
    const db = getMockDb();
    const rows = listPageRevisions(db, "9", q("sort=version")).data;
    // page 4 holds a link to page 3; trash page 3's target in the revision by pointing the snapshot at page 7 (trashed)
    const old = db.revisions["pages/9"].find((x) => x.id === rows[0].id)!;
    const snap = old.snapshot as unknown as { sections: Array<{ props: Record<string, unknown> }> };
    snap.sections[0].props.cta = { label: { la: "x" }, link: { type: "page", page_id: 7 } };
    const e = fails(() => restorePageRevision(db, "9", String(old.id), undefined, etag(9)), 422);
    expect(errorsOf(e)[0]).toMatchObject({ in: "entity", code: "unknown_reference" });
    expect(errorsOf(e)[0].path).toMatch(/^\/sections\/.+\/props\/cta\/link\/page_id$/);
    expect(etag(9)).toBe('"4"');

    const dup = db.revisions["pages/9"].find((x) => x.id === rows[0].id)!;
    (dup.snapshot as unknown as { sections: Array<{ props: Record<string, unknown> }>; page: { path: string } }).page.path = "/team";
    snap.sections[0].props.cta = undefined as never;
    delete snap.sections[0].props.cta;
    const d = fails(() => restorePageRevision(db, "9", String(old.id), undefined, etag(9)), 409, "CONFLICT_DUPLICATE");
    expect(errorsOf(d)[0]).toMatchObject({ in: "entity", path: "/page/path", code: "duplicate" });
  });
});
