import { beforeEach, describe, expect, it } from "vitest";

import { MockHttpError, getMockDb, resetMockDb } from "@/mocks/mock-db";
import { getSectionType, listSectionTypes } from "@/mocks/mock-cms-lookups";
import { createSection, deleteSection, getPage, listSections, patchPage, patchSection, reorderSections } from "@/mocks/mock-pages";

// The sections part of the mock API (doc/05 12.5): the contract the page editor is written against.
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
const q = (s = "") => new URLSearchParams(s);
const etag = (id: number) => getPage(getMockDb(), String(id)).etag;
const list = (id: number) => listSections(getMockDb(), String(id), q("include=props")).data;

beforeEach(() => resetMockDb());

describe("POST /pages/{id}/sections", () => {
  it("adds a section with the type's default props at a position, moves the page's ETag and answers the order", () => {
    const db = getMockDb();
    const done = createSection(db, "8", { section_type_key: "intro_heading", position: 1 }, etag(8));
    expect(done.data.section).toMatchObject({ section_type: { key: "intro_heading" }, sort_order: 1, is_visible: true });
    expect(done.data.sections.map((s) => s.sort_order)).toEqual([0, 1, 2]);
    expect(done.data.section.props).toEqual(getSectionType("intro_heading").default_props);
    expect(done.etag).toBe('"2"');
    expect(done.location).toBe(`/api/v1/pages/8/sections/${done.data.section.id}`);
    expect(list(8).map((s) => s.section_type.key)).toEqual(["hero_brand", "intro_heading", "intro_text"]);
  });

  it("needs the ETag (428), a stale one is 409, a trashed page is 409 trashed", () => {
    const db = getMockDb();
    fails(() => createSection(db, "8", { section_type_key: "faq" }, null), 428);
    fails(() => createSection(db, "8", { section_type_key: "faq" }, '"99"'), 409, "CONFLICT_LOCK_VERSION");
    fails(() => createSection(db, "7", { section_type_key: "faq" }, etag(7)), 409, "INVALID_STATE");
  });

  it("template rules: not allowed, max per page, hero first, after the hero", () => {
    const db = getMockDb();
    const rule = (body: unknown, id = 8) => errorsOf(fails(() => createSection(db, String(id), body, etag(id)), 422))[0];
    expect(rule({ section_type_key: "contact_section" })).toMatchObject({ path: "/section_type_key", code: "template_violation", params: { rule: "section_not_allowed" } });
    expect(rule({ section_type_key: "hero_article" })).toMatchObject({ code: "template_violation", params: { rule: "max_per_page" } });
    expect(rule({ section_type_key: "intro_text", position: 0 })).toMatchObject({ path: "/position", params: { rule: "hero_first" } });
    // contact page: the form has to come after the hero
    expect(rule({ section_type_key: "faq", position: 0 }, 5)).toMatchObject({ params: { rule: "hero_first" } });
  });

  it("position out of range, a variant that does not exist, props that are too long or point nowhere, a duplicate anchor", () => {
    const db = getMockDb();
    expect(errorsOf(fails(() => createSection(db, "8", { section_type_key: "faq", position: 9 }, etag(8)), 422))[0]).toMatchObject({ path: "/position", code: "out_of_range", params: { max: 2 } });
    expect(errorsOf(fails(() => createSection(db, "8", { section_type_key: "faq", variant: "nope" }, etag(8)), 422))[0]).toMatchObject({ path: "/variant", code: "not_in_enum", params: { expected: ["soft", "white"] } });
    const long = errorsOf(fails(() => createSection(db, "8", { section_type_key: "intro_heading", props: { title: { la: "x".repeat(500) } } }, etag(8)), 422));
    expect(long[0]).toMatchObject({ path: "/props/title/la", code: "too_long" });
    expect(errorsOf(fails(() => createSection(db, "8", { section_type_key: "intro_heading", props: { image: { media_id: 99999 } } }, etag(8)), 422))[0]).toMatchObject({ path: "/props/image/media_id", code: "unknown_reference" });
    createSection(db, "8", { section_type_key: "faq", anchor_id: "questions" }, etag(8));
    fails(() => createSection(db, "8", { section_type_key: "faq", anchor_id: "questions" }, etag(8)), 409, "CONFLICT_DUPLICATE");
    expect(errorsOf(fails(() => createSection(db, "8", { section_type_key: "faq", shared_section_id: 99 }, etag(8)), 422))[0]).toMatchObject({ path: "/shared_section_id", code: "unknown_reference" });
  });

  it("on a published page the write goes to the draft and the page then has unpublished changes", () => {
    const db = getMockDb();
    const done = createSection(db, "10", { section_type_key: "intro_heading" }, etag(10));
    expect(done.data.aggregate).toMatchObject({ status: "published", has_unpublished_changes: true });
  });
});

describe("PUT /pages/{id}/sections/order", () => {
  it("reorders the whole set at once", () => {
    const db = getMockDb();
    createSection(db, "8", { section_type_key: "faq" }, etag(8));
    const [hero, text, faq] = list(8).map((s) => s.id);
    const done = reorderSections(db, "8", { sections: [{ id: hero }, { id: faq }, { id: text }] }, etag(8));
    expect(done.data.sections.map((s) => s.id)).toEqual([hero, faq, text]);
    expect(list(8).map((s) => s.id)).toEqual([hero, faq, text]);
  });

  it("the same order is 200 with the same ETag; a set that differs is 422; the hero can not leave the top", () => {
    const db = getMockDb();
    const [hero, text] = list(8).map((s) => s.id);
    const same = reorderSections(db, "8", { sections: [{ id: hero }, { id: text }] }, etag(8));
    expect(same.etag).toBe('"1"');
    expect(errorsOf(fails(() => reorderSections(db, "8", { sections: [{ id: hero }] }, etag(8)), 422))[0]).toMatchObject({ code: "required", params: { missing: [String(text)] } });
    expect(errorsOf(fails(() => reorderSections(db, "8", { sections: [{ id: hero }, { id: hero }] }, etag(8)), 422))[0]).toMatchObject({ path: "/sections/1/id", code: "duplicate" });
    expect(errorsOf(fails(() => reorderSections(db, "8", { sections: [{ id: hero }, { id: 99999 }] }, etag(8)), 422))[0]).toMatchObject({ code: "unknown_reference" });
    expect(errorsOf(fails(() => reorderSections(db, "8", { sections: [{ id: text }, { id: hero }] }, etag(8)), 422))[0]).toMatchObject({ path: "/sections/1/id", code: "template_violation", params: { rule: "hero_first" } });
  });
});

describe("DELETE and PATCH of a section", () => {
  it("deletes a section and renumbers; the last hero / the contact form of the template can not be deleted", () => {
    const db = getMockDb();
    const [hero, text] = list(8).map((s) => s.id);
    const err = fails(() => deleteSection(db, "8", String(hero), etag(8)), 409, "INVALID_STATE");
    expect((err.body.details as { reason: string }).reason).toBe("section_required");
    const done = deleteSection(db, "8", String(text), etag(8));
    expect(done.data.sections).toHaveLength(1);
    expect(done.etag).toBe('"2"');
    fails(() => deleteSection(db, "8", String(text), etag(8)), 404);
  });

  it("props are checked at the draft level and the variant by the type's list", () => {
    const db = getMockDb();
    const faqId = createSection(db, "8", { section_type_key: "faq" }, etag(8)).data.section.id;
    expect(errorsOf(fails(() => patchSection(db, "8", String(faqId), { variant: "x" }, etag(8)), 422))[0]).toMatchObject({ path: "/variant", code: "not_in_enum" });
    const heroId = list(8)[0].id;
    const bad = errorsOf(fails(() => patchSection(db, "8", String(heroId), { props: { title: { la: "x".repeat(300) } } }, etag(8)), 422));
    expect(bad[0]).toMatchObject({ path: "/props/title/la", code: "too_long" });
  });

  it("a change that alters nothing keeps the ETag", () => {
    const db = getMockDb();
    const s = list(8)[0];
    const done = patchSection(db, "8", String(s.id), { is_visible: true, props: s.props }, etag(8));
    expect(done.etag).toBe('"1"');
  });

  it("a translator may change text under x-localized, nothing else (403)", () => {
    const db = getMockDb();
    db.translateOnly = ["sections"];
    const s = list(8)[0];
    const props = structuredClone(s.props!) as { title: Record<string, string>; show_logo?: boolean };
    props.title.en = "Summer trek (English)";
    expect(patchSection(db, "8", String(s.id), { props }, etag(8)).data.section.props).toMatchObject({ title: { en: "Summer trek (English)" } });
    fails(() => patchSection(db, "8", String(s.id), { props: { ...props, show_logo: !props.show_logo } }, etag(8)), 403, "FORBIDDEN");
    fails(() => patchSection(db, "8", String(s.id), { is_visible: false }, etag(8)), 403, "FORBIDDEN");
    fails(() => createSection(db, "8", { section_type_key: "faq" }, etag(8)), 403);
    fails(() => reorderSections(db, "8", { sections: [{ id: s.id }, { id: list(8)[1].id }] }, etag(8)), 403);
  });

  it("the page ETag moves on every write, so a stale one is 409", () => {
    const db = getMockDb();
    const old = etag(8);
    createSection(db, "8", { section_type_key: "faq" }, old);
    fails(() => patchPage(db, "8", { sort_order: 4 }, old), 409, "CONFLICT_LOCK_VERSION");
  });
});

describe("page PATCH for a translator", () => {
  it("titles and SEO texts yes, the address and the flags 403", () => {
    const db = getMockDb();
    db.translateOnly = ["pages"];
    expect(patchPage(db, "8", { translations: { en: { seo_title: "Summer trek in English" } } }, etag(8)).data.translations.en.seo_title).toBe("Summer trek in English");
    fails(() => patchPage(db, "8", { path: "/summer-2" }, etag(8)), 403);
    fails(() => patchPage(db, "8", { noindex: true }, etag(8)), 403);
    fails(() => patchPage(db, "8", { translations: { en: { og_image_id: 3 } } }, etag(8)), 403);
  });
});

describe("GET /section-types", () => {
  it("lists the 12 types, narrows by template and rejects unknown parameters", () => {
    const db = getMockDb();
    expect(listSectionTypes(db, q())).toHaveLength(12);
    expect(listSectionTypes(db, q("template=contact")).map((t) => t.key).sort()).toEqual(["contact_section", "faq", "hero_brand", "intro_text"]);
    expect(listSectionTypes(db, q("include=schema"))[0].json_schema).toBeTruthy();
    fails(() => listSectionTypes(db, q("x=1")), 422);
    fails(() => getSectionType("nope"), 404);
  });
});
