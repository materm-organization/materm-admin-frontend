import { beforeEach, describe, expect, it } from "vitest";

import { MockHttpError, getMockDb, resetMockDb } from "@/mocks/mock-db";
import {
  createFaqGroup,
  createFaqItem,
  deleteFaqGroup,
  deleteFaqItem,
  discardFaqGroupDraft,
  getFaqGroup,
  listFaqGroups,
  listFaqItems,
  listFaqRevisions,
  patchFaqGroup,
  patchFaqItem,
  publishFaqGroup,
  reorderFaqItems,
  restoreFaqGroup,
  restoreFaqRevision,
  unpublishFaqGroup,
} from "@/mocks/mock-faq";

// The FAQ part of the mock API (doc/05 section 13.5): the contract the FAQ screens are written against.
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
const etag = (id: number) => getFaqGroup(db(), String(id)).etag;
const items = (id: number) => listFaqItems(db(), String(id)).data;
const para = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

beforeEach(() => resetMockDb());

describe("groups", () => {
  it("lists the seeded groups with counts and usage; the trash is separate", () => {
    const { data, meta } = listFaqGroups(db(), q());
    expect(meta.total).toBe(3);
    expect(data.map((g) => g.key)).toEqual(["booking", "contact", "trips"]);
    expect(data.find((g) => g.key === "contact")).toMatchObject({ name: "Contact questions", status: "published", item_count: 4, visible_item_count: 3 });
    expect(data.find((g) => g.key === "trips")).toMatchObject({ has_unpublished_changes: true, name: "Trips and tours", item_count: 3 });
    expect(listFaqGroups(db(), q("trashed=true")).data.map((g) => g.key)).toEqual(["old-faq"]);
    fails(() => listFaqGroups(db(), q("locale=la")), 422);
    fails(() => listFaqGroups(db(), q("sort=item_count")), 422);
  });

  it("creates a draft (key: letter first, unique; name 1-120) and renames it; the key is immutable", () => {
    const { data, etag: tag } = createFaqGroup(db(), { key: "new-group", name: "New" });
    expect(tag).toBe('"1"');
    expect(data).toMatchObject({ key: "new-group", name: "New", status: "draft", item_count: 0 });
    expect(errorsOf(fails(() => createFaqGroup(db(), { key: "Bad", name: "x" }), 422))[0]).toMatchObject({ path: "/key", code: "pattern_mismatch" });
    expect(errorsOf(fails(() => createFaqGroup(db(), { key: "contact", name: "x" }), 409, "CONFLICT_DUPLICATE"))[0].path).toBe("/key");
    expect(errorsOf(fails(() => createFaqGroup(db(), { key: "ok", name: "x".repeat(121) }), 422))[0].code).toBe("too_long");
    expect(patchFaqGroup(db(), String(data.id), { name: "Renamed" }, tag).data).toMatchObject({ name: "Renamed", lock_version: 2 });
    expect(errorsOf(fails(() => patchFaqGroup(db(), String(data.id), { key: "x" }, '"2"'), 422))[0].code).toBe("immutable");
    fails(() => patchFaqGroup(db(), String(data.id), { name: "x" }, null), 428);
  });

  it("a group a faq section names is refused with the pages; an unused one goes to the trash and back", () => {
    // the contact page (5) of the examples carries a faq section for `contact` or none: make it certain
    const used = db().pages.find((p) => p.live.sections.some((s) => s.section_type === "faq"));
    const key = used ? (used.live.sections.find((s) => s.section_type === "faq")!.props as { group_key?: string }).group_key : undefined;
    if (key) {
      const g = db().faqGroups.find((x) => x.key === key)!;
      const e = fails(() => deleteFaqGroup(db(), String(g.id), q(), etag(g.id)), 409, "ENTITY_REFERENCED");
      expect(detailsOf(e).total_references).toBeGreaterThan(0);
    }
    deleteFaqGroup(db(), "2", q(), etag(2));
    expect(listFaqGroups(db(), q("trashed=true")).data.map((g) => g.key)).toEqual(["booking", "old-faq"]);
    expect(restoreFaqGroup(db(), "2", etag(2)).data).toMatchObject({ status: "draft", deleted_at: null });
    fails(() => restoreFaqGroup(db(), "2", etag(2)), 409, "INVALID_STATE");
  });
});

describe("items", () => {
  it("adds a question: the default language needs BOTH texts, a row needs both, the answer is rich text lite", () => {
    const { data, etag: tag } = createFaqItem(db(), "2", { translations: { la: { question: "New?", answer: para("Yes.") } }, position: 0 }, etag(2));
    expect(tag).toBe('"2"');
    expect(data.item).toMatchObject({ is_visible: true, sort_order: 0, translations: { la: { question: "New?" } } });
    expect(items(2).map((i) => i.id)[0]).toBe(data.item.id);
    expect(errorsOf(fails(() => createFaqItem(db(), "2", { translations: { en: { question: "x", answer: para("y") } } }, etag(2)), 422)).map((e) => e.path)).toEqual(["/translations/la/question", "/translations/la/answer"]);
    expect(errorsOf(fails(() => createFaqItem(db(), "2", { translations: { la: { question: "x" } } }, etag(2)), 422))[0]).toMatchObject({ path: "/translations/la/answer", code: "required" });
    expect(errorsOf(fails(() => createFaqItem(db(), "2", { translations: { la: { question: "x".repeat(201), answer: para("y") } } }, etag(2)), 422))[0].code).toBe("too_long");
    expect(errorsOf(fails(() => createFaqItem(db(), "2", { translations: { la: { question: "x", answer: { type: "doc", content: [{ type: "heading" }] } } } }, etag(2)), 422))[0].path).toBe("/translations/la/answer/content/0/type");
    fails(() => createFaqItem(db(), "2", { translations: { la: { question: "x", answer: para("y") } } }, null), 428);
  });

  it("patches visibility and texts; one text of an existing row; a default-language row can not be removed; nothing changed keeps the ETag", () => {
    const first = items(1)[0];
    const before = etag(1);
    expect(patchFaqItem(db(), "1", String(first.id), { translations: { la: { question: "How do I book?" } } }, before).data.item.translations.la.question).toBe("How do I book?");
    const tag = etag(1);
    expect(patchFaqItem(db(), "1", String(first.id), { is_visible: true }, tag).etag).toBe(tag);
    expect(patchFaqItem(db(), "1", String(first.id), { translations: { en: null } }, tag).data.item.translations.en).toBeUndefined();
    expect(errorsOf(fails(() => patchFaqItem(db(), "1", String(first.id), { translations: { la: null } }, etag(1)), 422))[0].path).toBe("/translations/la");
    expect(errorsOf(fails(() => patchFaqItem(db(), "1", String(items(1)[2].id), { translations: { en: { question: "Only a question" } } }, etag(1)), 422))[0]).toMatchObject({ path: "/translations/en/answer", code: "required" });
    fails(() => patchFaqItem(db(), "1", "9999", { is_visible: false }, etag(1)), 404);
  });

  it("reorders with the whole set, deletes and renumbers; an item has no references (the section names the group)", () => {
    const ids = items(1).map((i) => i.id);
    const reversed = ids.slice().reverse();
    expect(reorderFaqItems(db(), "1", { items: reversed.map((id) => ({ id })) }, etag(1)).data.order.map((o) => o.id)).toEqual(reversed);
    expect(errorsOf(fails(() => reorderFaqItems(db(), "1", { items: [{ id: ids[0] }] }, etag(1)), 422))[0].code).toBe("required");
    const { data } = deleteFaqItem(db(), "1", String(ids[0]), etag(1));
    expect(data.order.map((o) => o.sort_order)).toEqual([0, 1, 2]);
  });

  it("stops at 100 questions", () => {
    for (let i = 0; i < 96; i++) createFaqItem(db(), "1", { translations: { la: { question: `Q${i}`, answer: para("A") } } }, etag(1));
    expect(items(1)).toHaveLength(100);
    expect(errorsOf(fails(() => createFaqItem(db(), "1", { translations: { la: { question: "x", answer: para("A") } } }, etag(1)), 422))[0]).toMatchObject({ code: "limit_exceeded", params: { max: 100 } });
  });
});

describe("publish rules (13.5.5)", () => {
  it("booking: the empty default answer of a visible question blocks (pointer by public id); a hidden question is skipped; English is a warning", () => {
    const e = fails(() => publishFaqGroup(db(), "2", q("dry_run=true"), undefined, etag(2)), 422, "PUBLISH_BLOCKED");
    const second = items(2)[1];
    expect(errorsOf(e)).toEqual([expect.objectContaining({ code: "empty_default_locale", path: `/items/${second.public_id}/translations/la/answer`, params: expect.objectContaining({ item_id: second.id, item_index: 1 }) })]);
    expect((detailsOf(e).warnings as Array<{ code: string; params: { missing: number } }>)[0]).toMatchObject({ code: "translation_incomplete", params: { locale: "en", missing: 2 } });
    patchFaqItem(db(), "2", String(second.id), { is_visible: false }, etag(2));
    expect(publishFaqGroup(db(), "2", q("dry_run=true"), undefined, etag(2)).data).toMatchObject({ publishable: true });
    const done = publishFaqGroup(db(), "2", q(), { change_note: "go" }, etag(2));
    expect(done.data).toMatchObject({ status: "published", published_revision: { version: expect.any(Number) } });
  });

  it("a group without a visible question only warns", () => {
    const { data } = createFaqGroup(db(), { key: "empty", name: "Empty" });
    expect(publishFaqGroup(db(), String(data.id), q("dry_run=true"), undefined, '"1"').data).toMatchObject({ warnings: [{ code: "faq_group_empty", path: "/items" }] });
  });

  it("unpublish of the contact group (a faq section names it) needs confirm_references, warns and keeps the draft as history; discard turns a draft into history", () => {
    patchFaqGroup(db(), "1", { name: "Contact" }, etag(1));
    const e = fails(() => unpublishFaqGroup(db(), "1", q(), etag(1)), 409, "ENTITY_REFERENCED");
    expect(detailsOf(e).total_references).toBeGreaterThan(0);
    const un = unpublishFaqGroup(db(), "1", q("confirm_references=true"), etag(1));
    expect(un.data).toMatchObject({ status: "archived" });
    expect(un.data.warnings.map((w: { code: string }) => w.code)).toEqual(["faq_group_referenced", "draft_kept_as_history"]);
    patchFaqGroup(db(), "3", { name: "Trips again" }, etag(3));
    expect(discardFaqGroupDraft(db(), "3", etag(3)).data.has_unpublished_changes).toBe(false);
    expect(listFaqRevisions(db(), "3", q()).data.map((r) => r.kind)).toEqual(expect.arrayContaining(["published", "history"]));
  });

  it("restores an older revision as the working draft", () => {
    const rows = listFaqRevisions(db(), "1", q("kind=history")).data;
    const { data } = restoreFaqRevision(db(), "1", String(rows[0].id), {}, etag(1));
    expect(data).toMatchObject({ item_count: 2, has_unpublished_changes: true });
  });
});

describe("translate-only writer (05 13.5.2)", () => {
  beforeEach(() => {
    db().translateOnly = ["faq-groups"];
  });
  it("edits question and answer in every language; name, hiding, adding, removing, ordering are 403", () => {
    const first = items(1)[0];
    patchFaqItem(db(), "1", String(first.id), { translations: { en: { question: "Q", answer: para("A") }, th: { question: "Q", answer: para("A") } } }, etag(1));
    fails(() => patchFaqGroup(db(), "1", { name: "x" }, etag(1)), 403);
    fails(() => patchFaqItem(db(), "1", String(first.id), { is_visible: false }, etag(1)), 403);
    fails(() => patchFaqItem(db(), "1", String(first.id), { translations: { en: null } }, etag(1)), 403);
    fails(() => createFaqItem(db(), "1", { translations: { la: { question: "x", answer: para("y") } } }, etag(1)), 403);
    fails(() => reorderFaqItems(db(), "1", { items: items(1).map((i) => ({ id: i.id })) }, etag(1)), 403);
    fails(() => deleteFaqItem(db(), "1", String(first.id), etag(1)), 403);
    fails(() => createFaqGroup(db(), { key: "x", name: "x" }), 403);
    fails(() => deleteFaqGroup(db(), "2", q(), etag(2)), 403);
    fails(() => publishFaqGroup(db(), "1", q(), {}, etag(1)), 403);
  });
});
