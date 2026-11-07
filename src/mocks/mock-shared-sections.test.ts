import { beforeEach, describe, expect, it } from "vitest";

import { MockHttpError, getMockDb, resetMockDb } from "@/mocks/mock-db";
import { createSection, detachSection, getPage, listSections, patchSection, publishPage, restorePageRevision, listPageRevisions } from "@/mocks/mock-pages";
import {
  createSharedSection,
  deleteSharedSection,
  discardSharedDraft,
  getSharedSection,
  getUsages,
  listSharedSections,
  patchSharedSection,
  publishSharedSection,
  restoreSharedRevision,
  restoreSharedSection,
  unpublishSharedSection,
} from "@/mocks/mock-shared-sections";

// The shared-sections part of the mock API (doc/05 section 18): the contract the SCR-22 screens and the SCR-20 shared parts are written against.
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
const errorsOf = (e: MockHttpError) => e.body.errors as Array<{ path: string; code: string; params?: Record<string, unknown> }>;
const detailsOf = (e: MockHttpError) => e.body.details as Record<string, unknown>;
const q = (s = "") => new URLSearchParams(s);
const db = () => getMockDb();
const sEtag = (id: number) => getSharedSection(db(), String(id)).etag;
const pEtag = (id: number) => getPage(db(), String(id)).etag;
// Page 8 is "standard", page 1 is "home" (hero + collage + blog strip + gallery ...): the seeded pages hold no reference.
const place = (pageId: number, sharedId: number, extra: Record<string, unknown> = {}) => createSection(db(), String(pageId), { shared_section_id: sharedId, ...extra }, pEtag(pageId));
const sectionId = (result: ReturnType<typeof createSection>) => (result.data.section as { id: number }).id;

beforeEach(() => resetMockDb());

describe("list and get", () => {
  it("lists with the usage counts, no props; the trash needs delete", () => {
    const { data, meta } = listSharedSections(db(), q());
    expect(meta.total).toBe(3);
    expect(data[0]).not.toHaveProperty("props");
    expect(data.find((r) => r.id === 3)).toMatchObject({ has_unpublished_changes: true, used_in_pages: 0, used_in_trashed_pages: 0, name: "Forest photo story" });
    expect(listSharedSections(db(), q("trashed=true")).data.map((r) => r.id)).toEqual([4]);
    db().sharedSectionRole = "viewer";
    fails(() => listSharedSections(db(), q("trashed=true")), 403);
    fails(() => getSharedSection(db(), "4"), 404);
  });

  it("is strict about query keys and values", () => {
    expect(errorsOf(fails(() => listSharedSections(db(), q("foo=1")), 422))[0]).toMatchObject({ code: "unknown_field" });
    expect(errorsOf(fails(() => listSharedSections(db(), q("section_type=nope")), 422))[0]).toMatchObject({ path: "/section_type", code: "unknown_reference" });
    expect(errorsOf(fails(() => listSharedSections(db(), q("status=live")), 422))[0]).toMatchObject({ path: "/status", code: "not_in_enum" });
    expect(errorsOf(fails(() => listSharedSections(db(), q("placeable_on_page=999")), 422))[0]).toMatchObject({ path: "/placeable_on_page", code: "unknown_reference" });
  });

  it("filters by keyword, type, status, pending changes and use", () => {
    expect(listSharedSections(db(), q("keyword=gallery")).data.map((r) => r.id)).toEqual([1]);
    expect(listSharedSections(db(), q("section_type=photo_story,intro_text")).meta.total).toBe(2);
    expect(listSharedSections(db(), q("status=draft")).data.map((r) => r.id)).toEqual([2]);
    expect(listSharedSections(db(), q("has_unpublished_changes=true")).data.map((r) => r.id)).toEqual([3]);
    place(8, 1);
    expect(listSharedSections(db(), q("in_use=true")).data.map((r) => r.id)).toEqual([1]);
    expect(listSharedSections(db(), q("in_use=false")).meta.total).toBe(2);
  });

  it("placeable_on_page drops types the template forbids and the required slots (SS-7)", () => {
    db().pages.find((p) => p.id === 8)!.live.page.template = "contact";
    const ids = listSharedSections(db(), q("placeable_on_page=8")).data.map((r) => r.id);
    // The contact template allows no gallery or photo story; the home template no photo story.
    expect(ids).toEqual([2]);
    expect(listSharedSections(db(), q("placeable_on_page=1")).data.map((r) => r.id).sort()).toEqual([1, 2]);
  });
});

describe("create and patch", () => {
  it("reports every problem at once; the type is checked for the shared scope", () => {
    const e = fails(() => createSharedSection(db(), { name: " ", section_type_key: "nope", variant: 3, foo: 1 }), 422);
    expect(errorsOf(e).map((x) => `${x.path}:${x.code}`).sort()).toEqual(["/foo:unknown_field", "/name:too_short", "/section_type_key:unknown_reference"].sort());
    expect(errorsOf(fails(() => createSharedSection(db(), { section_type_key: "intro_text" }), 422))[0]).toMatchObject({ path: "/name", code: "required" });
    expect(errorsOf(fails(() => createSharedSection(db(), { name: "x", section_type_key: "gallery_cards", variant: "wide" }), 422))[0]).toMatchObject({ path: "/variant", code: "not_in_enum" });
  });

  it("creates a draft with the default props and ETag 1", () => {
    const r = createSharedSection(db(), { name: "  Intro  ", section_type_key: "intro_text" });
    expect(r.etag).toBe('"1"');
    expect(r.data).toMatchObject({ name: "Intro", status: "draft", lock_version: 1, used_in_pages: 0, section_type: { key: "intro_text", version: 1 } });
    expect(r.location).toBe(`/api/v1/shared-sections/${r.data.id}`);
  });

  it("needs If-Match, rejects the immutable type, and an unchanged PATCH keeps the ETag", () => {
    fails(() => patchSharedSection(db(), "2", { name: "x" }, null), 428);
    fails(() => patchSharedSection(db(), "2", { name: "x" }, '"9"'), 409, "CONFLICT_LOCK_VERSION");
    expect(errorsOf(fails(() => patchSharedSection(db(), "2", { section_type_key: "faq" }, sEtag(2)), 422))[0]).toMatchObject({ path: "/section_type_key", code: "immutable" });
    expect(errorsOf(fails(() => patchSharedSection(db(), "2", {}, sEtag(2)), 422))[0]).toMatchObject({ code: "min_properties" });
    const before = sEtag(2);
    expect(patchSharedSection(db(), "2", { name: "Our promise (text)" }, before).etag).toBe(before);
  });

  it("a published section writes to a draft (no change on the website) and the lock version moves once", () => {
    const r = patchSharedSection(db(), "1", { name: "Teaser v2" }, sEtag(1));
    expect(r.data).toMatchObject({ name: "Teaser v2", status: "published", has_unpublished_changes: true, lock_version: 2 });
    expect(r.etag).toBe('"2"');
    expect(listSharedSections(db(), q("keyword=teaser")).data.map((x) => x.id)).toEqual([1]);
    expect(db().sharedSections.find((s) => s.id === 1)!.live.name).toBe("Gallery teaser");
  });

  it("a translator changes only text under x-localized; viewer is read only", () => {
    db().translateOnly = ["shared-sections"];
    fails(() => patchSharedSection(db(), "2", { name: "no" }, sEtag(2)), 403);
    fails(() => deleteSharedSection(db(), "2", q(), sEtag(2)), 403);
    db().translateOnly = [];
    db().sharedSectionRole = "viewer";
    fails(() => patchSharedSection(db(), "2", { name: "no" }, sEtag(2)), 403);
    fails(() => createSharedSection(db(), { name: "n", section_type_key: "intro_text" }), 403);
  });
});

describe("placing it on a page (18.9)", () => {
  it("takes the type of the shared section, props {}, variant null, and warns while it is not live", () => {
    const r = place(8, 2, { position: 1 });
    expect(r.data.section).toMatchObject({ props: {}, variant: null, shared_section_id: 2, section_type: { key: "intro_text" }, translation_status: {}, shared_section: { id: 2, live: false, status: "draft" } });
    expect(r.data.warnings[0]).toMatchObject({ code: "shared_section_not_live", path: "/shared_section_id", params: { shared_section_id: 2, shared_state: "draft" } });
    expect(place(8, 1).data.warnings).toEqual([]);
  });

  it("refuses props / variant (not_applicable), a wrong type key, an unknown or trashed one, and a required slot", () => {
    const e = fails(() => place(8, 2, { variant: "x", props: { a: 1 } }), 422);
    expect(errorsOf(e).map((x) => `${x.path}:${x.code}`).sort()).toEqual(["/props:not_applicable", "/variant:not_applicable"]);
    expect(errorsOf(fails(() => place(8, 2, { section_type_key: "faq" }), 422))[0]).toMatchObject({ path: "/section_type_key", code: "not_in_enum", params: { expected: ["intro_text"] } });
    expect(errorsOf(fails(() => place(8, 99), 422))[0]).toMatchObject({ path: "/shared_section_id", code: "unknown_reference", params: { ref_type: "cms_shared_sections", ref_id: 99 } });
    expect(errorsOf(fails(() => place(8, 4), 422))[0]).toMatchObject({ code: "unknown_reference" });
    const hero = createSharedSection(db(), { name: "Hero", section_type_key: "hero_brand" }).data;
    expect(errorsOf(fails(() => place(8, hero.id), 422))[0]).toMatchObject({ path: "/shared_section_id", code: "template_violation", params: { rule: "shared_in_required_slot" } });
  });

  it("the section of the page can only be shown / hidden or get an anchor (not_applicable, reason shared_reference)", () => {
    const id = sectionId(place(8, 1));
    const e = errorsOf(fails(() => patchSection(db(), "8", String(id), { props: {} }, pEtag(8)), 422))[0];
    expect(e).toMatchObject({ path: "/props", code: "not_applicable", params: { reason: "shared_reference" } });
    expect(errorsOf(fails(() => patchSection(db(), "8", String(id), { variant: null }, pEtag(8)), 422))[0]).toMatchObject({ path: "/variant", code: "not_applicable" });
    expect(errorsOf(fails(() => patchSection(db(), "8", String(id), { shared_section_id: null }, pEtag(8)), 422))[0]).toMatchObject({ code: "immutable" });
    expect(patchSection(db(), "8", String(id), { is_visible: false }, pEtag(8)).data.section).toMatchObject({ is_visible: false });
    const warned = patchSection(db(), "8", String(sectionId(place(8, 2))), { is_visible: true }, pEtag(8));
    expect(warned.data.warnings).toEqual([]);
  });

  it("lists the shared block with the working name", () => {
    place(8, 1);
    const rows = listSections(db(), "8", q()).data;
    expect(rows.find((s) => s.shared_section_id === 1)!.shared_section).toMatchObject({ id: 1, name: "Gallery teaser", live: true });
  });
});

describe("publishing a page that references a shared section (SS-2)", () => {
  it("is blocked while the shared one is a draft (path /sections/<public_id>/shared_section_id), passes once it is published; hidden = skipped", () => {
    const r = place(8, 2);
    const section = r.data.section as { id: number; public_id: string };
    const blocked = fails(() => publishPage(db(), "8", q("dry_run=true"), undefined, pEtag(8)), 422, "PUBLISH_BLOCKED");
    expect(errorsOf(blocked)[0]).toMatchObject({ path: `/sections/${section.public_id}/shared_section_id`, code: "reference_not_published", params: { ref_type: "cms_shared_sections", ref_id: 2, shared_state: "draft", section_id: section.id } });
    // Hidden: the page can be published, a warning says it was not checked.
    patchSection(db(), "8", String(section.id), { is_visible: false }, pEtag(8));
    expect((publishPage(db(), "8", q("dry_run=true"), undefined, pEtag(8)).data as { warnings: Array<{ code: string }> }).warnings.map((w) => w.code)).toContain("section_hidden_unchecked");
    patchSection(db(), "8", String(section.id), { is_visible: true }, pEtag(8));
    publishSharedSection(db(), "2", q(), undefined, sEtag(2));
    expect(publishPage(db(), "8", q(), undefined, pEtag(8)).data).toMatchObject({ status: "published" });
  });

  it("a trashed shared section is unknown_reference; props of the reference never block", () => {
    const section = place(8, 1).data.section as { id: number; public_id: string };
    unpublishSharedSection(db(), "1", q(), sEtag(1));
    expect(errorsOf(fails(() => publishPage(db(), "8", q("dry_run=true"), undefined, pEtag(8)), 422))[0]).toMatchObject({ code: "reference_not_published", params: { shared_state: "archived" } });
    db().sharedSections.find((s) => s.id === 1)!.deleted_at = "2026-11-06T10:00:00.000000+07:00";
    expect(errorsOf(fails(() => publishPage(db(), "8", q("dry_run=true"), undefined, pEtag(8)), 422))[0]).toMatchObject({ code: "unknown_reference", path: `/sections/${section.public_id}/shared_section_id`, params: { shared_state: "trashed" } });
  });
});

describe("publish, unpublish, discard (18.8)", () => {
  it("publishes a draft shared section, a second publish has nothing to publish", () => {
    const r = publishSharedSection(db(), "2", q(), undefined, sEtag(2));
    expect(r.data).toMatchObject({ status: "published", published_revision: { version: 1 } });
    fails(() => publishSharedSection(db(), "2", q(), undefined, r.etag!), 409, "INVALID_STATE");
  });

  it("blocks a publish with props that fail the default language (empty text)", () => {
    const created = createSharedSection(db(), { name: "Empty", section_type_key: "intro_text" }).data;
    const e = fails(() => publishSharedSection(db(), String(created.id), q(), undefined, '"1"'), 422, "PUBLISH_BLOCKED");
    expect(errorsOf(e)[0]).toMatchObject({ code: "empty_default_locale" });
  });

  it("unpublish always works (no confirm_references) and warns with the live pages that lose the section", () => {
    place(1, 1);
    publishPage(db(), "1", q(), undefined, pEtag(1));
    place(8, 1);
    fails(() => unpublishSharedSection(db(), "1", q("confirm_references=true"), sEtag(1)), 422, "VALIDATION_FAILED");
    const r = unpublishSharedSection(db(), "1", q(), sEtag(1));
    const warning = (r.data as { warnings: Array<{ code: string; params: Record<string, unknown> }> }).warnings.find((w) => w.code === "shared_section_referenced")!;
    expect(warning.params).toMatchObject({ total_references: expect.any(Number), live_pages_total: 1, pages_blocked_on_publish: 2, truncated: false });
    expect(warning.params.live_pages).toEqual([{ id: 1, title: expect.any(String), path: "/" }]);
  });

  it("unpublish of an unreferenced section has no warning; discard needs a draft", () => {
    const r = unpublishSharedSection(db(), "1", q(), sEtag(1));
    expect((r.data as { warnings: unknown[] }).warnings).toEqual([]);
    fails(() => discardSharedDraft(db(), "1", r.etag!), 409, "INVALID_STATE");
    expect(discardSharedDraft(db(), "3", sEtag(3)).data).toMatchObject({ has_unpublished_changes: false });
  });
});

describe("usages and delete (SS-3, SS-15)", () => {
  it("counts real rows and drafts per page; trashed pages are counted apart", () => {
    place(8, 1);
    publishPage(db(), "8", q(), undefined, pEtag(8));
    place(8, 1);
    place(1, 1);
    // Page 7 is in the trash: its real row names the shared section.
    const trashedPage = db().pages.find((p) => p.id === 7)!;
    trashedPage.live.sections.push({ ...trashedPage.live.sections[0], id: 900, public_id: "0192d3a4-7c1e-7b52-9d0a-3f5e2a1b5900", section_type: "gallery_cards", shared_section_id: 1, props: {} });
    const u = getUsages(db(), "1", q()).data;
    expect(u.pages.map((p) => [p.page_id, p.sections.map((s) => s.where).join()])).toEqual([[1, "draft"], [7, "live"], [8, "live,draft,draft"]]);
    expect(u.pages.find((p) => p.page_id === 1)).toMatchObject({ status: "published", live_on_site: false });
    expect(u.pages.find((p) => p.page_id === 8)).toMatchObject({ status: "published", live_on_site: true });
    expect(getUsages(db(), "1", q("include_trashed=false")).data.pages.map((p) => p.page_id)).not.toContain(7);
    const row = listSharedSections(db(), q()).data.find((r) => r.id === 1)!;
    expect(row).toMatchObject({ used_in_pages: 2, used_in_trashed_pages: 1 });
  });

  it("delete is 409 ENTITY_REFERENCED with the reason and rows, then works after the references are detached", () => {
    const s8 = sectionId(place(8, 1));
    const e = fails(() => deleteSharedSection(db(), "1", q(), sEtag(1)), 409, "ENTITY_REFERENCED");
    expect(detailsOf(e)).toMatchObject({ reason: "shared_section_in_use", total_references: 1, truncated: false });
    expect((detailsOf(e).references as Array<Record<string, unknown>>)[0]).toMatchObject({ entity_type: "cms.page", id: 8, kind: "section_ref", in_draft: false, page_trashed: false, section_id: s8, is_visible: true });
    detachSection(db(), "8", String(s8), undefined, pEtag(8));
    const gone = deleteSharedSection(db(), "1", q(), sEtag(1));
    expect(gone.data).toMatchObject({ aggregate: { status: "archived" } });
    expect(deleteSharedSection(db(), "1", q(), sEtag(1)).data).toBeNull();
    expect(restoreSharedSection(db(), "1", sEtag(1)).data).toMatchObject({ status: "draft", deleted_at: null });
    fails(() => restoreSharedSection(db(), "1", sEtag(1)), 409, "INVALID_STATE");
  });

  it("a page draft that names it blocks the delete too (draft_section_ref)", () => {
    publishPage(db(), "8", q(), undefined, pEtag(8));
    place(8, 2);
    const e = fails(() => deleteSharedSection(db(), "2", q(), sEtag(2)), 409, "ENTITY_REFERENCED");
    expect((detailsOf(e).references as Array<{ kind: string }>).map((r) => r.kind)).toEqual(["draft_section_ref"]);
  });
});

describe("detach (SS-5)", () => {
  it("copies the working copy (the draft) into the page section, clears the reference, warns shared_draft_copied", () => {
    const id = sectionId(place(8, 3));
    const r = detachSection(db(), "8", String(id), undefined, pEtag(8));
    expect(r.data.section).toMatchObject({ shared_section_id: null, shared_section: null, variant: null });
    expect((r.data.section as unknown as { props: { accessible_heading: { la: string } } }).props.accessible_heading.la).toBe("The forest photo story (revised)");
    expect(r.data.warnings[0]).toMatchObject({ code: "shared_draft_copied", params: { shared_section_id: 3 } });
  });

  it("is idempotent: a section that references nothing answers 200 with the same ETag", () => {
    const id = sectionId(place(8, 1));
    detachSection(db(), "8", String(id), undefined, pEtag(8));
    const before = pEtag(8);
    const again = detachSection(db(), "8", String(id), {}, before);
    expect(again.etag).toBe(before);
    expect(again.data.warnings).toEqual([]);
  });

  it("needs the page's If-Match, 404 for a section of another page (IDOR), unknown body field is 422", () => {
    const id = sectionId(place(8, 1));
    fails(() => detachSection(db(), "8", String(id), undefined, null), 428);
    fails(() => detachSection(db(), "1", String(id), undefined, pEtag(1)), 404);
    fails(() => detachSection(db(), "8", String(id), { x: 1 }, pEtag(8)), 422);
    db().translateOnly = ["sections"];
    fails(() => detachSection(db(), "8", String(id), undefined, pEtag(8)), 403);
  });

  it("a trashed shared section can be detached (the way out of SS-3)", () => {
    const id = sectionId(place(8, 1));
    db().sharedSections.find((s) => s.id === 1)!.deleted_at = "2026-11-06T10:00:00.000000+07:00";
    expect(detachSection(db(), "8", String(id), undefined, pEtag(8)).data.section).toMatchObject({ shared_section_id: null });
  });
});

describe("revisions", () => {
  it("restores a revision of the same type; a snapshot of another type or a missing page link is refused", () => {
    publishSharedSection(db(), "2", q(), undefined, sEtag(2));
    const revs = db().revisions["shared-sections/1"];
    const live = revs.find((r) => r.kind === "published")!;
    patchSharedSection(db(), "1", { name: "Changed" }, sEtag(1));
    const r = restoreSharedRevision(db(), "1", String(live.id), undefined, sEtag(1));
    expect(r.data).toMatchObject({ name: "Gallery teaser", restored_from: { revision_id: live.id } });
    live.snapshot = { ...live.snapshot, section_type: "faq" };
    fails(() => restoreSharedRevision(db(), "1", String(live.id), undefined, sEtag(1)), 409, "INVALID_STATE");
  });

  it("a page revision that names a shared section that is gone is refused (18.9.4)", () => {
    const id = sectionId(place(8, 1));
    void id;
    publishPage(db(), "8", q(), undefined, pEtag(8));
    const revs = listPageRevisions(db(), "8", q("kind=published")).data;
    db().sharedSections.find((s) => s.id === 1)!.deleted_at = "2026-11-06T10:00:00.000000+07:00";
    patchSection(db(), "8", String(db().pages.find((p) => p.id === 8)!.live.sections[0].id), { is_visible: false }, pEtag(8));
    const e = fails(() => restorePageRevision(db(), "8", String(revs[0].id), undefined, pEtag(8)), 422);
    expect(errorsOf(e)[0]).toMatchObject({ code: "unknown_reference", params: { ref_type: "cms_shared_sections", ref_id: 1 } });
  });
});
