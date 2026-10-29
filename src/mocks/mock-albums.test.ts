import { beforeEach, describe, expect, it } from "vitest";

import {
  albumItemView,
  albumWorking,
  createAlbum,
  createAlbumItems,
  deleteAlbum,
  deleteAlbumItem,
  discardAlbumDraft,
  getAlbum,
  listAlbumItems,
  listAlbumRevisions,
  listAlbums,
  patchAlbum,
  patchAlbumItem,
  publishAlbum,
  referenceAlbumItemFromPage,
  reorderAlbumItems,
  restoreAlbum,
  restoreAlbumRevision,
  unpublishAlbum,
} from "@/mocks/mock-albums";
import { MockHttpError, getMockDb, resetMockDb } from "@/mocks/mock-db";

// The albums part of the mock API (doc/05 section 13.4): the contract the gallery screens are written against.
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
const etag = (id: number) => getAlbum(db(), String(id)).etag;
const items = (id: number) => listAlbumItems(db(), String(id)).data;

beforeEach(() => resetMockDb());

describe("GET /albums", () => {
  it("lists the seeded albums with cover, counts, usage and translation status; the trash is separate", () => {
    const { data, meta } = listAlbums(db(), q("limit=100"));
    expect(meta.total).toBe(4); // album 4 is in the trash
    expect(data.map((a) => a.key)).toEqual(["camp-life", "forest-photo-story", "spring-rivers", "summit-week"]);
    const forest = data.find((a) => a.id === 1)!;
    expect(forest).toMatchObject({ title: "Forest photo story", status: "published", item_count: 5, usage_count: 1, cover_media: { id: 18 } }); // the gallery page (4) of the examples uses it
    expect(forest.translation_status).toEqual({ la: { enabled: true, title: true, description: true }, en: { enabled: true, title: true, description: false } });
    // the spring page (6) names album 2
    expect(data.find((a) => a.id === 2)).toMatchObject({ usage_count: 1, status: "draft" });
    expect(data.find((a) => a.id === 5)).toMatchObject({ has_unpublished_changes: true, title: "Camp life (autumn)", item_count: 3 });
    expect(listAlbums(db(), q("trashed=true")).data.map((a) => a.id)).toEqual([4]);
  });

  it("filters, sorts and refuses what it does not know", () => {
    expect(listAlbums(db(), q("keyword=RIVERS")).data.map((a) => a.id)).toEqual([2]);
    expect(listAlbums(db(), q("status=published")).data.map((a) => a.id)).toEqual([5, 1]);
    expect(listAlbums(db(), q("has_unpublished_changes=true")).data.map((a) => a.id)).toEqual([5]);
    expect(listAlbums(db(), q("sort=-key")).data[0].key).toBe("summit-week");
    fails(() => listAlbums(db(), q("bogus=1")), 422);
    fails(() => listAlbums(db(), q("sort=item_count")), 422);
    fails(() => listAlbums(db(), q("status=nope")), 422);
    fails(() => listAlbums(db(), q("locale=xx")), 422);
  });
});

describe("POST /albums", () => {
  it("creates a draft with lock_version 1 and an empty list of pictures; the key is a letter first and unique", () => {
    const { data, etag: tag } = createAlbum(db(), { key: "new-album", translations: { la: { title: "New" } } });
    expect(tag).toBe('"1"');
    expect(data).toMatchObject({ key: "new-album", status: "draft", item_count: 0, title: "New", aggregate: { entity_type: "cms.albums", lock_version: 1 } });
    expect(items(data.id)).toEqual([]);
    expect(errorsOf(fails(() => createAlbum(db(), { key: "1bad", translations: { la: { title: "x" } } }), 422))).toEqual([{ in: "body", path: "/key", code: "pattern_mismatch" }]);
    expect(errorsOf(fails(() => createAlbum(db(), { key: "new-album", translations: { la: { title: "x" } } }), 409, "CONFLICT_DUPLICATE"))[0].path).toBe("/key");
    expect(errorsOf(fails(() => createAlbum(db(), { key: "ok", translations: { en: { title: "x" } } }), 422)).map((e) => e.path)).toEqual(["/translations/la/title"]);
    expect(errorsOf(fails(() => createAlbum(db(), { key: "ok", translations: { la: { title: "x".repeat(121) } } }), 422))[0]).toMatchObject({ path: "/translations/la/title", code: "too_long" });
    fails(() => createAlbum(db(), { key: "ok", translations: { la: { title: "x" } }, cover_media_id: 999 }), 422);
    fails(() => createAlbum(db(), { key: "ok", translations: { la: { title: "x" } }, extra: 1 }), 422);
  });
});

describe("PATCH /albums/{id}", () => {
  it("needs If-Match, merges languages, refuses key, moves the ETag; an empty change keeps it", () => {
    fails(() => patchAlbum(db(), "3", { cover_media_id: 3 }, null), 428);
    fails(() => patchAlbum(db(), "3", { cover_media_id: 3 }, '"9"'), 409, "CONFLICT_LOCK_VERSION");
    expect(errorsOf(fails(() => patchAlbum(db(), "3", { key: "x" }, etag(3)), 422))[0]).toMatchObject({ path: "/key", code: "immutable" });
  });

  it("changes title and cover; the same values answer the same ETag; a new language row needs a title", () => {
    const before = etag(3);
    const { data, etag: after } = patchAlbum(db(), "3", { translations: { la: { title: "Summit" } }, cover_media_id: 3 }, before);
    expect(after).toBe('"2"');
    expect(data).toMatchObject({ title: "Summit", cover_media_id: 3 });
    expect(patchAlbum(db(), "3", { translations: { la: { title: "Summit" } } }, after).etag).toBe(after);
    expect(errorsOf(fails(() => patchAlbum(db(), "2", { translations: { en: { description: "d" } } }, etag(2)), 422))[0]).toMatchObject({ path: "/translations/en/title", code: "required" });
    const removed = patchAlbum(db(), "3", { translations: { en: null } }, after);
    expect(removed.data.translations.en).toBeUndefined();
  });

  it("a published album writes a draft: the live version stays until publish", () => {
    const { data, etag: tag } = patchAlbum(db(), "1", { translations: { la: { title: "Forest, edited" } } }, etag(1));
    expect(data).toMatchObject({ title: "Forest, edited", has_unpublished_changes: true, status: "published", aggregate: { has_unpublished_changes: true } });
    expect(db().albums[0].live.translations[0].title).toBe("Forest photo story");
    expect(discardAlbumDraft(db(), "1", tag).data.title).toBe("Forest photo story");
  });
});

describe("items", () => {
  it("adds pictures at a position (duplicates allowed), renumbers, returns the new ones and the order; limits are 422", () => {
    const { data, etag: tag } = createAlbumItems(db(), "3", { items: [{ media_id: 9, translations: { la: { caption_title: "Falls" } } }, { media_id: 9 }], position: 1 }, etag(3));
    expect(tag).toBe('"2"');
    expect(data.items.map((i) => i.media_id)).toEqual([9, 9]);
    expect(data.order.map((o) => o.sort_order)).toEqual([0, 1, 2, 3, 4]);
    expect(items(3).map((i) => i.media_id)).toEqual([2, 9, 9, 3, 4]);
    expect(items(3)[1].translations.la.caption_title).toBe("Falls");
    expect(errorsOf(fails(() => createAlbumItems(db(), "3", { items: [{ media_id: 999 }] }, etag(3)), 422))[0]).toMatchObject({ path: "/items/0/media_id", code: "unknown_reference" });
    expect(errorsOf(fails(() => createAlbumItems(db(), "3", { items: Array.from({ length: 51 }, () => ({ media_id: 2 })) }, etag(3)), 422))[0]).toMatchObject({ path: "/items", code: "limit_exceeded", params: { max: 50 } });
    expect(errorsOf(fails(() => createAlbumItems(db(), "3", { items: [{ media_id: 2, layout_hint: "Bad Hint" }] }, etag(3)), 422))[0].code).toBe("pattern_mismatch");
    fails(() => createAlbumItems(db(), "3", { items: [{ media_id: 2 }], position: 99 }, etag(3)), 422);
  });

  it("stops at 200 pictures with the room that is left", () => {
    for (const n of [50, 50, 50, 47]) createAlbumItems(db(), "3", { items: Array.from({ length: n }, () => ({ media_id: 2 })) }, etag(3));
    expect(items(3)).toHaveLength(200);
    expect(errorsOf(fails(() => createAlbumItems(db(), "3", { items: [{ media_id: 2 }] }, etag(3)), 422))[0]).toMatchObject({ path: "/items", code: "limit_exceeded", params: { max: 200, remaining: 0 } });
  });

  it("patches caption / alt / layout hint / picture; merges languages; null removes a language row", () => {
    const first = items(1)[0];
    const { data } = patchAlbumItem(db(), "1", String(first.id), { layout_hint: "wide", translations: { la: { alt: "Canopy" }, en: null } }, etag(1));
    expect(data.item).toMatchObject({ layout_hint: "wide", translations: { la: { caption_title: "Beneath the canopy", alt: "Canopy" } } });
    expect(data.item.translations.en).toBeUndefined();
    expect(data.aggregate.has_unpublished_changes).toBe(true); // album 1 is published: a draft now
    fails(() => patchAlbumItem(db(), "1", "9999", { layout_hint: null }, etag(1)), 404);
    fails(() => patchAlbumItem(db(), "1", String(first.id), { media_id: 999 }, etag(1)), 422);
    fails(() => patchAlbumItem(db(), "1", String(first.id), { translations: { la: { alt: "x".repeat(251) } } }, etag(1)), 422);
    fails(() => patchAlbumItem(db(), "1", String(first.id), { layout_hint: "x" }, null), 428);
  });

  it("reorders with the WHOLE set in one request: duplicate / unknown / missing ids are 422; the same order keeps the ETag", () => {
    const ids = items(3).map((i) => i.id);
    const before = etag(3);
    expect(reorderAlbumItems(db(), "3", { items: ids.map((id) => ({ id })) }, before).etag).toBe(before);
    const reversed = ids.slice().reverse();
    const { data, etag: after } = reorderAlbumItems(db(), "3", { items: reversed.map((id) => ({ id })) }, before);
    expect(after).not.toBe(before);
    expect(data.order.map((o) => o.id)).toEqual(reversed);
    expect(items(3).map((i) => i.id)).toEqual(reversed);
    expect(errorsOf(fails(() => reorderAlbumItems(db(), "3", { items: [{ id: ids[0] }, { id: ids[0] }, { id: ids[1] }] }, after), 422))[0].code).toBe("duplicate");
    expect(errorsOf(fails(() => reorderAlbumItems(db(), "3", { items: [{ id: 999 }, ...ids.slice(1).map((id) => ({ id })) ] }, after), 422))[0].code).toBe("unknown_reference");
    expect(errorsOf(fails(() => reorderAlbumItems(db(), "3", { items: [{ id: ids[0] }] }, after), 422))[0]).toMatchObject({ code: "required", params: { missing: expect.any(Array) } });
    fails(() => reorderAlbumItems(db(), "3", { items: reversed.map((id) => ({ id })) }, null), 428);
  });

  it("deletes a picture and renumbers; a picture a photo story uses is a 409 ENTITY_REFERENCED with the page and nothing confirms it", () => {
    const target = items(3)[1];
    const { data } = deleteAlbumItem(db(), "3", String(target.id), etag(3));
    expect(data.order.map((o) => o.sort_order)).toEqual([0, 1]);
    const used = items(2)[0];
    referenceAlbumItemFromPage(db(), 6, used.id);
    expect(albumItemView(db(), albumWorking(db(), db().albums[1]).items[0])).toMatchObject({ in_use: true, usage_count: 1 });
    const e = fails(() => deleteAlbumItem(db(), "2", String(used.id), etag(2)), 409, "ENTITY_REFERENCED");
    expect(detailsOf(e)).toMatchObject({ total_references: 1, references: [{ entity_type: "cms.page", id: 6, kind: "section_props", in_draft: false }] });
    expect(items(2)).toHaveLength(2);
  });
});

describe("delete / restore / unpublish", () => {
  it("an album a section names is refused with the list of pages (spring page 6 names album 2); an unused one goes to the trash and back", () => {
    const e = fails(() => deleteAlbum(db(), "2", q(), etag(2)), 409, "ENTITY_REFERENCED");
    expect(detailsOf(e)).toMatchObject({ total_references: 1, references: [{ id: 6, title: "Spring campaign" }] });
    const res = deleteAlbum(db(), "3", q(), etag(3));
    expect(res.data).toMatchObject({ aggregate: { entity_type: "cms.albums" } });
    expect(listAlbums(db(), q("trashed=true")).data.map((a) => a.id)).toEqual([4, 3]);
    // a key taken in the meantime blocks the restore
    createAlbum(db(), { key: "summit-week", translations: { la: { title: "Again" } } });
    fails(() => restoreAlbum(db(), "3", etag(3)), 409, "CONFLICT_DUPLICATE");
    fails(() => restoreAlbum(db(), "1", etag(1)), 409, "INVALID_STATE");
    expect(restoreAlbum(db(), "4", etag(4)).data).toMatchObject({ status: "draft", deleted_at: null });
  });

  it("unpublish of a used album needs confirm_references and warns; without a user it just archives and keeps the draft as history", () => {
    // album 2 is a draft: publish it after the blocker is gone, then use it
    patchAlbumItem(db(), "2", String(items(2)[0].id), { translations: { la: { alt: "Thaw" } } }, etag(2));
    patchAlbum(db(), "2", { translations: { la: { title: "Spring rivers" }, en: { title: "Spring rivers" } } }, etag(2));
    publishAlbum(db(), "2", q(), {}, etag(2));
    const e = fails(() => unpublishAlbum(db(), "2", q(), etag(2)), 409, "ENTITY_REFERENCED");
    expect(detailsOf(e).total_references).toBe(1);
    const done = unpublishAlbum(db(), "2", q("confirm_references=true"), etag(2));
    expect(done.data).toMatchObject({ status: "archived", warnings: [{ code: "album_referenced", params: { total_references: 1 } }] });
    patchAlbum(db(), "5", { cover_media_id: 3 }, etag(5));
    const two = unpublishAlbum(db(), "5", q(), etag(5));
    expect(two.data.warnings.map((w: { code: string }) => w.code)).toEqual(["draft_kept_as_history"]);
  });
});

describe("publish rules (13.4.7)", () => {
  const dry = (id: number) => publishAlbum(db(), String(id), q("dry_run=true"), undefined, etag(id));
  it("album 2 is blocked by the first picture's missing alt (pointer by public id, item_id / item_index) and warns about English; album 3 passes", () => {
    const e = fails(() => dry(2), 422, "PUBLISH_BLOCKED");
    const [blocker] = errorsOf(e);
    expect(blocker).toMatchObject({ code: "media_alt_missing", path: `/items/${items(2)[0].public_id}/media_id`, params: { item_id: items(2)[0].id, item_index: 0, locale: "la" } });
    expect((detailsOf(e).warnings as Array<{ code: string; path: string }>).map((w) => `${w.code}@${w.path}`)).toEqual(["translation_incomplete@/translations/en"]);
    expect(dry(3).data).toEqual({ publishable: true, warnings: [] });
  });

  it("a picture's own alt text satisfies the rule; an empty album only warns; the title in the default language blocks", () => {
    const { data } = createAlbum(db(), { key: "empty", translations: { la: { title: "Empty" }, en: { title: "Empty" } } });
    expect(dry(data.id).data).toMatchObject({ warnings: [{ code: "album_empty", path: "/items" }] });
    expect(errorsOf(fails(() => patchAlbum(db(), "3", { translations: { la: { title: "  " } } }, etag(3)), 422))[0]).toMatchObject({ path: "/translations/la/title", code: "required" });
  });

  it("publish makes the draft live, keeps first_published_at, history shows the published row; publish without changes is INVALID_STATE", () => {
    const first = publishAlbum(db(), "3", q(), { change_note: "go" }, etag(3));
    expect(first.data).toMatchObject({ status: "published", published_revision: { version: 1 } });
    fails(() => publishAlbum(db(), "3", q(), {}, etag(3)), 409, "INVALID_STATE");
    const rows = listAlbumRevisions(db(), "3", q()).data;
    expect(rows.map((r) => r.kind)).toEqual(["published"]);
    expect(rows[0].is_live).toBe(true);
  });
});

describe("revisions", () => {
  it("restore as draft is refused when it would drop a picture a photo story uses (album 1: the gallery page names its pictures)", () => {
    const rows = listAlbumRevisions(db(), "1", q("kind=history")).data;
    expect(rows).toHaveLength(1); // the older version with 3 pictures
    const e = fails(() => restoreAlbumRevision(db(), "1", String(rows[0].id), {}, etag(1)), 409, "ENTITY_REFERENCED");
    expect(detailsOf(e).total_references).toBeGreaterThan(0);
  });

  it("restores an older version as the working draft and keeps the current one as a restore row", () => {
    createAlbumItems(db(), "3", { items: [{ media_id: 9 }] }, etag(3)); // the first write checkpoints the 3-picture version
    const rows = listAlbumRevisions(db(), "3", q("kind=history")).data;
    expect(rows).toHaveLength(1);
    const { data, etag: tag } = restoreAlbumRevision(db(), "3", String(rows[0].id), {}, etag(3));
    expect(tag).toBe('"3"');
    expect(data).toMatchObject({ item_count: 3, restored_from: { version: rows[0].version } });
    expect(listAlbumRevisions(db(), "3", q("kind=restore")).data).toHaveLength(1);
  });
});

describe("translate-only writer (05 13.4.2)", () => {
  beforeEach(() => {
    db().translateOnly = ["albums"];
  });
  it("edits titles and captions of existing language rows in every language; everything structural is 403", () => {
    patchAlbum(db(), "1", { translations: { la: { title: "Forest" } } }, etag(1));
    patchAlbumItem(db(), "1", String(items(1)[0].id), { translations: { en: { alt: "Canopy" } } }, etag(1));
    fails(() => patchAlbum(db(), "1", { cover_media_id: 2 }, etag(1)), 403);
    fails(() => patchAlbum(db(), "3", { translations: { th: { title: "x" } } }, etag(3)), 403);
    fails(() => patchAlbum(db(), "3", { translations: { en: null } }, etag(3)), 403);
    fails(() => patchAlbumItem(db(), "1", String(items(1)[0].id), { layout_hint: "wide" }, etag(1)), 403);
    fails(() => createAlbumItems(db(), "3", { items: [{ media_id: 2 }] }, etag(3)), 403);
    fails(() => reorderAlbumItems(db(), "3", { items: items(3).map((i) => ({ id: i.id })) }, etag(3)), 403);
    fails(() => deleteAlbumItem(db(), "3", String(items(3)[0].id), etag(3)), 403);
    fails(() => createAlbum(db(), { key: "x", translations: { la: { title: "x" } } }), 403);
    fails(() => deleteAlbum(db(), "3", q(), etag(3)), 403);
    fails(() => publishAlbum(db(), "3", q(), {}, etag(3)), 403);
    fails(() => listAlbums(db(), q("trashed=true")), 403);
  });
});
