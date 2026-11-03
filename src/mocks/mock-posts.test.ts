import { beforeEach, describe, expect, it } from "vitest";

import { MockHttpError, getMockDb, resetMockDb } from "@/mocks/mock-db";
import { createPreviewLink, listPreviewLinks, revokePreviewLink } from "@/mocks/mock-preview";
import {
  checkPostSlug,
  createPost,
  deletePost,
  discardPostDraft,
  getPost,
  listPostRevisions,
  listPosts,
  patchPost,
  publishPost,
  replacePostMedia,
  restorePost,
  restorePostRevision,
  setPostRole,
  unpublishPost,
} from "@/mocks/mock-posts";
import { listTaxonomy } from "@/mocks/mock-taxonomy";

// The posts part of the mock API (doc/05 section 13.3): the contract the posts screens are written against.
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
const etag = (id: number) => getPost(getMockDb(), String(id)).etag;
const reason = (e: MockHttpError) => (e.body.details as { reason: string }).reason;
const get = (id: number) => getPost(getMockDb(), String(id)).data;
// A real (not dry-run) publish answers the post + `published_revision` and the new ETag.
const publish = (id: string, params: URLSearchParams, body: unknown, ifMatch: string | null) =>
  publishPost(getMockDb(), id, params, body, ifMatch) as unknown as { data: ReturnType<typeof get> & { published_revision: { version: number } }; etag: string };

beforeEach(() => resetMockDb());

describe("GET /posts", () => {
  it("lists the seeded posts with the lifecycle block, the category and the translation status; the trash is separate", () => {
    const db = getMockDb();
    const { data, meta } = listPosts(db, q("limit=100&sort=title"));
    expect(meta.total).toBe(7); // post 6 is in the trash
    const music = data.find((p) => p.id === 1)!;
    expect(music).toMatchObject({ title: "Music night under the stars", slug: "music-night-under-the-stars", status: "published", created_by: null, category: { id: 1, key: "music", name: "Music" }, tag_count: 1 });
    expect(music.translation_status.en).toMatchObject({ enabled: true, title: true, excerpt: true, body: true });
    expect(data.find((p) => p.id === 4)).toMatchObject({ status: "published", has_unpublished_changes: true, lock_version: 3 });
    expect(data.find((p) => p.id === 4)!.draft).not.toBeNull();
    expect(listPosts(db, q("trashed=true")).data.map((p) => p.id)).toEqual([6]);
    expect(listPosts(db, q("trashed=true")).data[0].purge_at).not.toBeNull();
  });

  it("filters (status, category, tag, created_by, keyword, pending, published range) and sorts; anything else is a 422", () => {
    const db = getMockDb();
    const ids = (s: string) => listPosts(db, q(`limit=100&sort=title&${s}`)).data.map((p) => p.id);
    expect(new Set(ids("status=draft"))).toEqual(new Set([3, 5, 7, 8]));
    expect(new Set(ids("category_id=2"))).toEqual(new Set([4, 8]));
    expect(ids("tag_id=1")).toEqual(expect.arrayContaining([3, 7]));
    expect(ids("tag_id=1,2")).toEqual([]);
    expect(ids("created_by=4")).toEqual(expect.arrayContaining([4, 8]));
    expect(ids("keyword=TRAIL")).toEqual([3]);
    expect(ids("keyword=gear-checklist")).toEqual([4, 5]); // slugs are searched too, also the one in a pending draft (the working copy)
    expect(ids("has_unpublished_changes=true")).toEqual([4]);
    expect(ids("published_from=2026-09-01T00:00:00Z&published_to=2026-09-30T00:00:00Z")).toEqual([1]);
    expect(listPosts(db, q("sort=-title&limit=2")).data.map((p) => p.title)).toEqual(["Unfinished trail notes", "Sunrise paddle on the Mekong"]);
    fails(() => listPosts(db, q("bogus=1")), 422);
    fails(() => listPosts(db, q("template=x")), 422);
    fails(() => listPosts(db, q("status=nope")), 422);
    fails(() => listPosts(db, q("sort=slug")), 422);
    fails(() => listPosts(db, q("locale=xx")), 422);
    fails(() => listPosts(db, q("category_id=0")), 422);
    fails(() => listPosts(db, q("published_from=2026-10-01T00:00:00Z&published_to=2026-09-01T00:00:00Z")), 422);
    fails(() => listPosts(db, q("tag_id=1,2,3,4,5,6")), 422);
  });

  it("the post picker of the section editor reads this list: id, title, slug, status", () => {
    const rows = listPosts(getMockDb(), q("limit=20&keyword=trail")).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 3, title: "Unfinished trail notes", slug: "unfinished-trail-notes", status: "draft" });
  });

  it("taxonomy counts come from the posts: the trash counts for nothing", () => {
    const db = getMockDb();
    const camping = listTaxonomy(db, "categories", q("")).data.find((c) => c.key === "camping")!;
    expect(camping).toMatchObject({ post_count: 2, published_post_count: 1 }); // post 4 (published) and 8; post 6 is trashed
  });
});

describe("GET /posts/{id} and /posts/slug-check", () => {
  it("returns the working copy with the translations, tags and gallery, and an ETag of the lock version", () => {
    const got = getPost(getMockDb(), "1");
    expect(got.etag).toBe('"1"');
    expect(got.data).toMatchObject({ id: 1, tag_ids: [2], tags: [{ id: 2, key: "night-sky", name: "Night sky" }], missing_locales: [] });
    expect(got.data.media).toHaveLength(9);
    expect(got.data.media[0]).toMatchObject({ media_id: 17, sort_order: 0, media: { id: 17 } });
    expect(got.data.translations.la).toMatchObject({ slug: "music-night-under-the-stars", is_enabled: true });
    fails(() => getPost(getMockDb(), "999"), 404);
  });

  it("slug-check: an own slug is free with post_id, another post's real slug is a conflict with a suggestion, invalid is an answer", () => {
    const db = getMockDb();
    expect(checkPostSlug(db, q("locale=en&slug=gear-checklist"))).toMatchObject({ valid: true, available: false, conflict: { post_id: 5, title: "Gear checklist for beginners" }, suggestion: "gear-checklist-2" });
    expect(checkPostSlug(db, q("locale=en&slug=gear-checklist&post_id=5"))).toMatchObject({ available: true, conflict: null, suggestion: null });
    expect(checkPostSlug(db, q("locale=en&slug=Fresh-Slug"))).toMatchObject({ normalized: "fresh-slug", valid: true, available: true });
    expect(checkPostSlug(db, q("locale=en&slug=bad%20slug"))).toMatchObject({ valid: false, reason: "format", available: false });
    expect(checkPostSlug(db, q(`locale=en&slug=${"a".repeat(101)}`))).toMatchObject({ valid: false, reason: "too_long" });
    // a trashed post does not hold its slug
    expect(checkPostSlug(db, q("locale=en&slug=old-camp-rules"))).toMatchObject({ available: true });
    fails(() => checkPostSlug(db, q("slug=x")), 422);
    fails(() => checkPostSlug(db, q("locale=en")), 422);
    fails(() => checkPostSlug(db, q("locale=zz&slug=x")), 422);
    fails(() => checkPostSlug(db, q("locale=en&slug=x&bogus=1")), 422);
  });
});

describe("POST /posts", () => {
  it("creates a draft owned by me with a generated slug (title -> ASCII; a Lao title falls back to the English slug, then post-<id>)", () => {
    const db = getMockDb();
    const made = createPost(db, { translations: { la: { title: "Rainy Season Camp" }, en: { title: "Rainy season camp" } } });
    expect(made.etag).toBe('"1"');
    expect(made.data).toMatchObject({ status: "draft", created_by: { id: 6 }, translations: { la: { slug: "rainy-season-camp" }, en: { slug: "rainy-season-camp" } } });
    const lao = createPost(db, { translations: { la: { title: "ຄ່າຍພັກແຮມ" }, en: { title: "Camp" } } });
    expect(lao.data.translations.la.slug).toBe("camp"); // the English slug (camp is free)
    const only = createPost(db, { translations: { la: { title: "ຄ່າຍພັກແຮມ" } } });
    expect(only.data.translations.la.slug).toMatch(/^post-0192d3a4/);
    // a taken generated slug gets -2
    expect(createPost(db, { translations: { la: { title: "Rainy Season Camp" } } }).data.translations.la.slug).toBe("rainy-season-camp-2");
  });

  it("is strict: the default title is required, unknown field / bad author / bad limits are 422, a taken slug is 409 with a suggestion", () => {
    const db = getMockDb();
    expect(errorsOf(fails(() => createPost(db, {}), 422))[0]).toMatchObject({ path: "/translations", code: "required" });
    expect(errorsOf(fails(() => createPost(db, { translations: { en: { title: "x" } } }), 422))[0]).toMatchObject({ path: "/translations/la/title", code: "required" });
    // author_id is accepted since the authors feature (05 15.8): an unknown or a trashed author is `unknown_reference`, a switched-off one `author_inactive`.
    expect(errorsOf(fails(() => createPost(db, { translations: { la: { title: "x" } }, author_id: 99 }), 422))[0]).toMatchObject({ path: "/author_id", code: "unknown_reference", params: { ref_type: "authors" } });
    expect(errorsOf(fails(() => createPost(db, { translations: { la: { title: "x" } }, author_id: 4 }), 422))[0]).toMatchObject({ path: "/author_id", code: "unknown_reference" });
    expect(errorsOf(fails(() => createPost(db, { translations: { la: { title: "x" } }, author_id: 3 }), 422))[0]).toMatchObject({ path: "/author_id", code: "author_inactive" });
    expect(errorsOf(fails(() => createPost(db, { translations: { la: { title: "x" } }, bogus: 1 }), 422))[0]).toMatchObject({ path: "/bogus", code: "unknown_field" });
    expect(errorsOf(fails(() => createPost(db, { translations: { la: { title: "x".repeat(151) } } }), 422))[0]).toMatchObject({ path: "/translations/la/title", code: "too_long" });
    expect(errorsOf(fails(() => createPost(db, { translations: { la: { title: "x", slug: "Bad Slug" } } }), 422))[0]).toMatchObject({ path: "/translations/la/slug", code: "pattern_mismatch" });
    expect(errorsOf(fails(() => createPost(db, { translations: { la: { title: "x" } }, category_id: 99 }), 422))[0]).toMatchObject({ path: "/category_id", code: "unknown_reference" });
    const clash = fails(() => createPost(db, { translations: { la: { title: "x", slug: "gear-checklist" } } }), 409, "CONFLICT_DUPLICATE");
    expect(errorsOf(clash)[0]).toMatchObject({ path: "/translations/la/slug", code: "duplicate", params: { suggestion: "gear-checklist-2" } });
    fails(() => createPost(db, { translations: { la: { title: "x" } }, published_at: new Date(Date.now() + 86_400_000).toISOString() }), 422);
  });
});

describe("PATCH /posts/{id}", () => {
  it("needs If-Match (428), refuses a stale one (409 CONFLICT_LOCK_VERSION), an empty body and unknown / immutable fields (422)", () => {
    const db = getMockDb();
    fails(() => patchPost(db, "3", { is_featured: true }, null), 428);
    fails(() => patchPost(db, "3", { is_featured: true }, '"9"'), 409, "CONFLICT_LOCK_VERSION");
    expect(errorsOf(fails(() => patchPost(db, "3", {}, etag(3)), 422))[0].code).toBe("min_properties");
    const e = errorsOf(fails(() => patchPost(db, "3", { status: "published", scheduled_at: "x", bogus: 1 }, etag(3)), 422));
    expect(e.map((x) => `${x.path}:${x.code}`)).toEqual(["/status:immutable", "/scheduled_at:not_applicable", "/bogus:unknown_field"]);
  });

  it("merges the translations per language, bumps the ETag once, and a change that alters nothing keeps it", () => {
    const db = getMockDb();
    const r = patchPost(db, "3", { translations: { en: { title: "Unfinished trail notes (en)" }, la: { excerpt: "Short." } }, tag_ids: [1, 3], category_id: 2 }, etag(3));
    expect(r.etag).toBe('"2"');
    expect(r.data).toMatchObject({ category: { id: 2 }, tag_ids: [1, 3], translations: { la: { excerpt: "Short.", title: "Unfinished trail notes" }, en: { title: "Unfinished trail notes (en)", slug: "unfinished-trail-notes-en" } } });
    const same = patchPost(db, "3", { category_id: 2 }, r.etag);
    expect(same.etag).toBe(r.etag);
    // deleting the default language is refused, another one is deleted
    expect(errorsOf(fails(() => patchPost(db, "3", { translations: { la: null } }, r.etag), 422))[0]).toMatchObject({ path: "/translations/la", code: "required" });
    expect(patchPost(db, "3", { translations: { en: null } }, r.etag).data.translations.en).toBeUndefined();
  });

  it("checks lengths, the body (profile full), tags (<= 10, no duplicates, existing), references and the display date", () => {
    const db = getMockDb();
    const tag = etag(3);
    const bad = (body: unknown) => errorsOf(fails(() => patchPost(db, "3", body, tag), 422))[0];
    expect(bad({ translations: { la: { excerpt: "x".repeat(301) } } })).toMatchObject({ path: "/translations/la/excerpt", code: "too_long", params: { max: 300 } });
    expect(bad({ translations: { la: { label: "x".repeat(81) } } })).toMatchObject({ code: "too_long" });
    expect(bad({ translations: { la: { body: { type: "doc", content: [{ type: "script" }] } } } })).toMatchObject({ path: "/translations/la/body/content/0", code: "not_in_enum" });
    expect(bad({ translations: { la: { body: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [] }] } } } })).toMatchObject({ path: "/translations/la/body/content/0/attrs/level", code: "not_in_enum" });
    expect(bad({ translations: { la: { body: { type: "doc", content: [{ type: "paragraph" }, { type: "lead" }] } } } })).toMatchObject({ path: "/translations/la/body/content/1", code: "forbidden" });
    expect(bad({ translations: { la: { body: { type: "doc", content: [{ type: "image", attrs: { media_id: 999 } }] } } } })).toMatchObject({ code: "unknown_reference" });
    expect(bad({ translations: { la: { body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] } } } })).toMatchObject({ code: "pattern_mismatch" });
    expect(bad({ translations: { la: { body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(210_000) }] }] } } } })).toMatchObject({ path: "/translations/la/body", code: "too_long", params: { unit: "bytes" } });
    expect(bad({ tag_ids: Array.from({ length: 11 }, (_, i) => i + 1) })).toMatchObject({ path: "/tag_ids", code: "limit_exceeded", params: { max: 10 } });
    expect(bad({ tag_ids: [1, 1] })).toMatchObject({ path: "/tag_ids/1", code: "duplicate" });
    expect(bad({ tag_ids: [4] })).toMatchObject({ path: "/tag_ids/0", code: "unknown_reference" }); // tag 4 is trashed
    expect(bad({ hero_media_id: 999 })).toMatchObject({ path: "/hero_media_id", code: "unknown_reference" });
    expect(bad({ translations: { la: { og_image_id: 999 } } })).toMatchObject({ code: "unknown_reference" });
    expect(bad({ published_at: new Date(Date.now() + 3_600_000).toISOString() })).toMatchObject({ path: "/published_at", code: "out_of_range" });
    expect(bad({ media_translations: { 999: { en: { alt: "x" } } } })).toMatchObject({ path: "/media_translations/999", code: "unknown_reference" });
    // a past display date is fine
    expect(patchPost(db, "3", { published_at: "2026-09-01T00:00:00Z" }, tag).data.published_at).toBe("2026-09-01T00:00:00Z");
  });

  it("a slug is checked against the REAL rows of other posts (409 + suggestion), also when the pending draft of another post holds the same one", () => {
    const db = getMockDb();
    const e = fails(() => patchPost(db, "3", { translations: { en: { title: "x", slug: "gear-checklist" } } }, etag(3)), 409, "CONFLICT_DUPLICATE");
    expect(errorsOf(e)[0]).toMatchObject({ path: "/translations/en/slug", code: "duplicate", params: { suggestion: "gear-checklist-2" } });
    // post 4's pending draft has the slug `gear-checklist` too: invisible to the save of post 5 -> allowed
    expect(patchPost(db, "5", { translations: { en: { slug: "gear-checklist" } } }, etag(5)).etag).toBe(etag(5));
  });

  it("a published post writes into its draft (the live rows stay), the ETag moves, slug_changed_published warns", () => {
    const db = getMockDb();
    const r = patchPost(db, "2", { translations: { en: { slug: "dawn-paddle" } } }, etag(2));
    expect(r.data).toMatchObject({ status: "published", has_unpublished_changes: true });
    expect(r.data.warnings).toEqual([{ path: "/translations/en/slug", code: "slug_changed_published", params: { locale: "en", old_slug: "sunrise-paddle-on-the-mekong" } }]);
    expect(db.posts.find((p) => p.id === 2)!.live.translations.find((t) => t.locale_code === "en")!.slug).toBe("sunrise-paddle-on-the-mekong");
    expect(r.etag).toBe('"2"');
  });

  it("serp / label warnings are returned (never blocking)", () => {
    const r = patchPost(getMockDb(), "3", { translations: { la: { label: "a label that is longer than eighteen", seo_title: "x".repeat(70) } } }, etag(3));
    expect(r.data.warnings.map((w) => w.code).sort()).toEqual(["label_long", "serp_title_long"]);
  });

  it("a delete_own-only author sees only their own posts in the trash", () => {
    const db = getMockDb();
    deletePost(db, "8", q(), etag(8));
    expect(listPosts(db, q("trashed=true")).data.map((p) => p.id).sort()).toEqual([6, 8]);
    setPostRole(db, "author");
    expect(listPosts(db, q("trashed=true")).data.map((p) => p.id)).toEqual([6]);
  });

  it("a trashed post is 409 INVALID_STATE trashed", () => {
    expect(reason(fails(() => patchPost(getMockDb(), "6", { is_featured: true }, etag(6)), 409, "INVALID_STATE"))).toBe("trashed");
  });
});

describe("roles: update_own / delete_own / translate (05 13.3.2, 13.3.3)", () => {
  it("an author edits their own post (any language) but only the non-default languages of somebody else's; no shared fields, no media PUT", () => {
    const db = getMockDb();
    setPostRole(db, "author");
    expect(patchPost(db, "3", { category_id: 2 }, etag(3)).data.category?.id).toBe(2); // mine
    const theirs = etag(8);
    const e = fails(() => patchPost(db, "8", { category_id: 3 }, theirs), 403, "FORBIDDEN");
    expect(detailsOf(e).summary).toContain("/category_id");
    fails(() => patchPost(db, "8", { translations: { la: { title: "New" } } }, theirs), 403);
    expect(patchPost(db, "8", { translations: { en: { title: "Camp kitchen", slug: "camp-kitchen" } } }, theirs).data.translations.en.slug).toBe("camp-kitchen");
    fails(() => patchPost(db, "8", { translations: { en: { is_enabled: false } } }, etag(8)), 403);
    fails(() => replacePostMedia(db, "8", { media: [] }, etag(8)), 403);
    expect(replacePostMedia(db, "3", { media: [] }, etag(3)).data.media).toEqual([]);
    // a form may send the whole object: values that equal the stored ones are not a write
    const d = get(8);
    expect(patchPost(db, "8", { category_id: d.category?.id, translations: { la: { title: d.translations.la.title } } }, etag(8)).etag).toBe(etag(8));
  });

  it("an author cannot publish / unpublish / restore from the trash; delete_own only of an own post that was never published", () => {
    const db = getMockDb();
    setPostRole(db, "author");
    fails(() => publishPost(db, "3", q(), undefined, etag(3)), 403, "FORBIDDEN");
    fails(() => unpublishPost(db, "2", q(), etag(2)), 403);
    fails(() => deletePost(db, "2", q(), etag(2)), 403); // mine but published once
    fails(() => deletePost(db, "8", q(), etag(8)), 403); // not mine
    expect(deletePost(db, "7", q(), etag(7)).data).toMatchObject({ aggregate: { entity_type: "cms.posts" } });
    fails(() => restorePost(db, "7", etag(7)), 403);
    expect(createPost(db, { translations: { la: { title: "My own" } } }).data.created_by?.id).toBe(6);
  });

  it("a translator can only translate: no create, no shared fields, no default language, the trash is closed", () => {
    const db = getMockDb();
    setPostRole(db, "translator");
    fails(() => createPost(db, { translations: { la: { title: "x" } } }), 403);
    fails(() => patchPost(db, "3", { is_featured: true }, etag(3)), 403);
    fails(() => patchPost(db, "3", { translations: { la: { excerpt: "x" } } }, etag(3)), 403);
    expect(patchPost(db, "3", { translations: { en: { title: "Trail notes", excerpt: "x" } } }, etag(3)).data.translations.en).toMatchObject({ title: "Trail notes" });
    fails(() => listPosts(db, q("trashed=true")), 403);
    fails(() => discardPostDraft(db, "4", etag(4)), 403);
  });
});

describe("PUT /posts/{id}/media (the gallery)", () => {
  it("replaces the whole set in the array's order, keeps the ids of existing rows, reserves ids for new ones, answers the gallery + the stamp", () => {
    const db = getMockDb();
    const before = get(4).media;
    const r = replacePostMedia(
      db,
      "4",
      { media: [{ id: before[2].id, media_id: 8, translations: { la: { alt: "C" } } }, { media_id: 5, translations: { en: { alt: "New", caption: "Cap" } } }, { id: before[0].id, media_id: 6, translations: {} }] },
      etag(4)
    );
    expect(r.etag).toBe('"4"');
    expect(r.data.media.map((m) => [m.id, m.media_id, m.sort_order])).toEqual([[before[2].id, 8, 0], [expect.any(Number), 5, 1], [before[0].id, 6, 2]]);
    expect(r.data.media[1].id).toBeGreaterThan(Math.max(...before.map((m) => m.id)));
    expect(r.data.media[1].translations.en).toEqual({ alt: "New", caption: "Cap" });
    expect(r.data.aggregate).toMatchObject({ entity_type: "cms.posts", lock_version: 4, has_unpublished_changes: true });
    // an omitted `translations` clears the texts (the strict reading)
    const cleared = replacePostMedia(db, "4", { media: [{ id: before[0].id, media_id: 6 }] }, r.etag);
    expect(cleared.data.media[0].translations).toEqual({});
    // the same set again alters nothing
    expect(replacePostMedia(db, "4", { media: [{ id: before[0].id, media_id: 6 }] }, cleared.etag).etag).toBe(cleared.etag);
  });

  it("is strict: 60 at most, unknown / duplicate ids, unknown media, texts too long, unknown fields", () => {
    const db = getMockDb();
    const tag = etag(3);
    const bad = (body: unknown) => errorsOf(fails(() => replacePostMedia(db, "3", body, tag), 422))[0];
    expect(bad({ media: Array.from({ length: 61 }, () => ({ media_id: 5 })) })).toMatchObject({ path: "/media", code: "limit_exceeded", params: { max: 60 } });
    expect(bad({ media: [{ id: 999, media_id: 5 }] })).toMatchObject({ path: "/media/0/id", code: "unknown_reference" });
    expect(bad({ media: [{ media_id: 999 }] })).toMatchObject({ path: "/media/0/media_id", code: "unknown_reference" });
    expect(bad({ media: [{ media_id: 5, translations: { en: { alt: "x".repeat(251) } } }] })).toMatchObject({ code: "too_long", params: { max: 250 } });
    expect(bad({ media: [{ media_id: 5, translations: { en: { caption: "x".repeat(301) } } }] })).toMatchObject({ code: "too_long", params: { max: 300 } });
    expect(bad({ media: [], bogus: 1 })).toMatchObject({ path: "/bogus", code: "unknown_field" });
    expect(bad({})).toMatchObject({ path: "/media", code: "required" });
    fails(() => replacePostMedia(db, "3", { media: [] }, null), 428);
    fails(() => replacePostMedia(db, "3", { media: [] }, '"9"'), 409, "CONFLICT_LOCK_VERSION");
    expect(replacePostMedia(db, "3", { media: Array.from({ length: 60 }, () => ({ media_id: 5, translations: {} })) }, tag).data.media).toHaveLength(60);
    // two rows with the same id
    const rows = get(4).media;
    expect(errorsOf(fails(() => replacePostMedia(db, "4", { media: [{ id: rows[0].id, media_id: 6 }, { id: rows[0].id, media_id: 6 }] }, etag(4)), 422))[0]).toMatchObject({ code: "duplicate" });
  });

  it("alt / caption of existing rows go through PATCH media_translations", () => {
    const db = getMockDb();
    const row = get(4).media[0];
    const r = patchPost(db, "4", { media_translations: { [row.id]: { en: { alt: "Edited", caption: "Cap" } } } }, etag(4));
    expect(r.data.media[0].translations.en).toEqual({ alt: "Edited", caption: "Cap" });
  });
});

describe("publish engine (05 13.3.6)", () => {
  it("a draft with every kind of problem is PUBLISH_BLOCKED with JSON pointers; warnings travel in details", () => {
    const db = getMockDb();
    const e = fails(() => publishPost(db, "7", q("dry_run=true"), undefined, etag(7)), 422, "PUBLISH_BLOCKED");
    const blockers = errorsOf(e).map((x) => `${x.path}:${x.code}`);
    expect(blockers).toEqual(
      expect.arrayContaining(["/category_id:required", "/hero_media_id:media_alt_missing", "/translations/la/excerpt:empty_default_locale", "/translations/la/seo_title:empty_default_locale"])
    );
    expect(blockers.find((b) => b.startsWith("/media/") && b.endsWith(":media_alt_missing"))).toBeTruthy();
    expect(errorsOf(e).every((x) => x.in === "entity")).toBe(true);
    const warnings = (detailsOf(e).warnings as Array<{ code: string }>).map((w) => w.code);
    expect(warnings).toEqual(expect.arrayContaining(["label_long", "body_empty", "translation_incomplete"]));
    expect(detailsOf(e).blocker_count).toBe(errorsOf(e).length);
  });

  it("a slug that another post holds for real is blocked at /translations/<l>/slug (post 4's pending draft vs post 5)", () => {
    const e = fails(() => publishPost(getMockDb(), "4", q(), undefined, etag(4)), 422, "PUBLISH_BLOCKED");
    expect(errorsOf(e)).toEqual([expect.objectContaining({ path: "/translations/en/slug", code: "duplicate", in: "entity" })]);
  });

  it("dry run changes nothing; a real publish keeps/sets published_at (PT-7), moves status and ETag, and a draft publishes as `published_revision`", () => {
    const db = getMockDb();
    const dry = publishPost(db, "8", q("dry_run=true"), undefined, etag(8));
    expect(dry.etag).toBeUndefined();
    expect(dry.data).toMatchObject({ publishable: true });
    expect(get(8).status).toBe("draft");
    patchPost(db, "8", { published_at: "2026-08-01T00:00:00Z" }, etag(8)); // alone: a column of the root
    const done = publish("8", q(), { change_note: "first" }, etag(8));
    expect(done.data).toMatchObject({ status: "published", has_unpublished_changes: false, published_revision: { version: 1 } });
    expect(done.data.published_at).toBeTruthy();
    const firstAt = done.data.published_at;
    expect(firstAt).toBe("2026-08-01T00:00:00Z");
    // an edit + a re-publish keeps the date
    const edited = patchPost(db, "8", { translations: { la: { excerpt: "Changed" } } }, done.etag);
    expect(edited.data.has_unpublished_changes).toBe(true);
    const again = publish("8", q(), undefined, edited.etag);
    expect(again.data.published_at).toBe(firstAt);
    // a date a person set wins
    const dated = patchPost(db, "8", { published_at: "2026-08-01T00:00:00Z", translations: { la: { excerpt: "Again" } } }, again.etag);
    expect(publish("8", q(), undefined, dated.etag).data.published_at).toBe("2026-08-01T00:00:00Z");
    fails(() => publishPost(db, "8", q(), undefined, etag(8)), 409, "INVALID_STATE");
  });

  it("publish needs If-Match, rejects unknown params / body fields, and `nothing_to_publish` for a post without a draft", () => {
    const db = getMockDb();
    fails(() => publishPost(db, "8", q(), undefined, null), 428);
    fails(() => publishPost(db, "8", q("bogus=1"), undefined, etag(8)), 422);
    fails(() => publishPost(db, "8", q(), { bogus: 1 }, etag(8)), 422);
    expect(reason(fails(() => publishPost(db, "2", q(), undefined, etag(2)), 409, "INVALID_STATE"))).toBe("nothing_to_publish");
    expect(reason(fails(() => publishPost(db, "6", q(), undefined, etag(6)), 409, "INVALID_STATE"))).toBe("trashed");
  });

  it("unpublish ALWAYS succeeds: a pending draft is kept as history; post_referenced is a warning (never a 409, no confirm_references)", () => {
    const db = getMockDb();
    const r = unpublishPost(db, "1", q(), etag(1));
    expect(r.data.status).toBe("archived");
    expect(r.data.warnings.map((w) => w.code)).toEqual(["post_referenced"]);
    expect(r.data.warnings[0].params!.total_references).toBeGreaterThanOrEqual(3); // the blog_strip items of the home page
    fails(() => unpublishPost(db, "2", q("confirm_references=true"), etag(2)), 422);
    const withDraft = unpublishPost(db, "4", q(), etag(4));
    expect(withDraft.data.warnings.map((w) => w.code)).toContain("draft_kept_as_history");
    expect(withDraft.data.has_unpublished_changes).toBe(false);
    expect(reason(fails(() => unpublishPost(db, "3", q(), etag(3)), 409, "INVALID_STATE"))).toBe("not_published");
  });

  it("discard turns the draft into a history row; no draft is 409 no_draft", () => {
    const db = getMockDb();
    const r = discardPostDraft(db, "4", etag(4));
    expect(r.data).toMatchObject({ status: "published", has_unpublished_changes: false });
    expect(listPostRevisions(db, "4", q("kind=history")).data.some((x) => x.change_note === "discarded")).toBe(true);
    expect(reason(fails(() => discardPostDraft(db, "4", r.etag), 409, "INVALID_STATE"))).toBe("no_draft");
  });
});

describe("the display date (published_at is a column of the root, PT-7)", () => {
  it("is changed by a PATCH that carries nothing else: together with a change it is 422 send_alone and nothing is written; unchanged = no-op", () => {
    const db = getMockDb();
    const e = fails(() => patchPost(db, "3", { published_at: "2026-09-01T00:00:00Z", is_featured: true }, etag(3)), 422);
    expect(errorsOf(e)[0]).toMatchObject({ path: "/published_at", code: "not_applicable", params: { reason: "send_alone" } });
    expect(get(3)).toMatchObject({ published_at: null, is_featured: false, lock_version: 1 });
    const r = patchPost(db, "3", { published_at: "2026-09-01T00:00:00Z" }, etag(3));
    expect(r.etag).toBe('"2"');
    // a form may resend it together with a real change
    const again = patchPost(db, "3", { published_at: "2026-09-01T00:00:00Z", is_featured: true }, r.etag);
    expect(again.data).toMatchObject({ is_featured: true, published_at: "2026-09-01T00:00:00Z" });
    expect(patchPost(db, "3", { published_at: "2026-09-01T00:00:00Z" }, again.etag).etag).toBe(again.etag);
  });

  it("a published post shows the new date at once (no draft, one ETag move); it can not be cleared; a draft's can; the future is out_of_range", () => {
    const db = getMockDb();
    const r = patchPost(db, "2", { published_at: "2026-08-15T00:00:00Z" }, etag(2));
    expect(r.data).toMatchObject({ status: "published", has_unpublished_changes: false, published_at: "2026-08-15T00:00:00Z" });
    expect(r.etag).toBe('"2"');
    expect(errorsOf(fails(() => patchPost(db, "2", { published_at: null }, r.etag), 422))[0]).toMatchObject({ path: "/published_at", code: "required" });
    patchPost(db, "3", { published_at: "2026-09-01T00:00:00Z" }, etag(3));
    expect(patchPost(db, "3", { published_at: null }, etag(3)).data.published_at).toBeNull();
    expect(errorsOf(fails(() => patchPost(db, "3", { published_at: new Date(Date.now() + 86_400_000).toISOString() }, etag(3)), 422))[0]).toMatchObject({ code: "out_of_range" });
  });

  it("a revision restore does not touch it", () => {
    const db = getMockDb();
    const history = listPostRevisions(db, "4", q("kind=history")).data[0];
    patchPost(db, "4", { published_at: "2026-08-15T00:00:00Z" }, etag(4));
    expect(restorePostRevision(db, "4", String(history.id), undefined, etag(4)).data.published_at).toBe("2026-08-15T00:00:00Z");
  });

  it("an author sets it on their own post only", () => {
    const db = getMockDb();
    setPostRole(db, "author");
    expect(patchPost(db, "3", { published_at: "2026-09-01T00:00:00Z" }, etag(3)).data.published_at).toBe("2026-09-01T00:00:00Z");
    fails(() => patchPost(db, "8", { published_at: "2026-09-01T00:00:00Z" }, etag(8)), 403);
  });
});

describe("delete and restore (05 13.3.10)", () => {
  it("DELETE is a soft delete (30 days); a published post leaves published first with post_referenced / draft_kept_as_history; again = 200 null", () => {
    const db = getMockDb();
    const r = deletePost(db, "1", q(), etag(1));
    expect(r.data!.warnings.map((w) => w.code)).toEqual(["post_referenced"]);
    expect(get(1)).toMatchObject({ status: "archived", deleted_at: expect.any(String) });
    expect(deletePost(db, "1", q(), etag(1)).data).toBeNull();
    fails(() => deletePost(db, "3", q(), null), 428);
    fails(() => deletePost(db, "3", q("confirm_references=true"), etag(3)), 422);
    const withDraft = deletePost(db, "4", q(), etag(4));
    expect(withDraft.data!.warnings.map((w) => w.code)).toContain("draft_kept_as_history");
    // the slugs are free again
    expect(checkPostSlug(db, q("locale=en&slug=dry-season-gear-list"))).toMatchObject({ available: true });
  });

  it("restore brings a post back as a draft; a slug taken meanwhile is a 409 with errors per language; not trashed is INVALID_STATE", () => {
    const db = getMockDb();
    expect(restorePost(db, "6", etag(6)).data).toMatchObject({ status: "draft", deleted_at: null });
    expect(reason(fails(() => restorePost(db, "6", etag(6)), 409, "INVALID_STATE"))).toBe("not_trashed");
    deletePost(db, "5", q(), etag(5));
    createPost(db, { translations: { la: { title: "Gear checklist for beginners", slug: "gear-checklist" } } });
    const e = fails(() => restorePost(db, "5", etag(5)), 409, "CONFLICT_DUPLICATE");
    expect(errorsOf(e).map((x) => `${x.in}${x.path}`)).toEqual(expect.arrayContaining(["entity/translations/la/slug"]));
  });
});

describe("revisions", () => {
  it("lists draft / published / history rows with is_live, hides preview rows, and restores a row as the draft (a restore row is kept)", () => {
    const db = getMockDb();
    const list = listPostRevisions(db, "4", q());
    expect(list.data.map((r) => r.kind).sort()).toEqual(["draft", "history", "published"]);
    expect(list.data.find((r) => r.kind === "published")!.is_live).toBe(true);
    const history = list.data.find((r) => r.kind === "history")!;
    const r = restorePostRevision(db, "4", String(history.id), undefined, etag(4));
    expect(r.data.restored_from).toMatchObject({ version: history.version });
    expect(r.data.translations.la.title).toBe("Gear list (old)");
    expect(listPostRevisions(db, "4", q()).data.some((x) => x.kind === "restore")).toBe(true);
    fails(() => restorePostRevision(db, "4", String(history.id), undefined, null), 428);
    fails(() => listPostRevisions(db, "4", q("bogus=1")), 422);
    // a snapshot written by a newer schema
    const future = listPostRevisions(db, "1", q("kind=history")).data[0];
    expect(reason(fails(() => restorePostRevision(db, "1", String(future.id), undefined, etag(1)), 409, "INVALID_STATE"))).toBe("snapshot_incompatible");
  });
});

describe("preview links of a post (05 13.3.8, Q-A34)", () => {
  it("issue a link for /blog/<slug of the language>, frozen at the working copy; list and revoke; the owner may with update_own", () => {
    const db = getMockDb();
    const created = createPreviewLink(db, "3", { locale: "en", ttl_minutes: 60 }, "posts");
    expect(created.entity).toEqual({ type: "cms.posts", id: 3 });
    expect(created.url).toContain("path=%2Fblog%2Funfinished-trail-notes"); // no English slug: the default language's slug
    const own = createPreviewLink(db, "2", {}, "posts");
    expect(decodeURIComponent(own.url)).toContain("/blog/sunrise-paddle-on-the-mekong");
    const list = listPreviewLinks(db, "3", q(), "posts");
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ locale: "en", state: "active", is_stale: false });
    patchPost(db, "3", { is_featured: true }, etag(3));
    expect(listPreviewLinks(db, "3", q(), "posts").data[0].is_stale).toBe(true);
    expect(revokePreviewLink(db, String(created.id)).state).toBe("revoked");
    // pages keep their own links
    expect(listPreviewLinks(db, "3", q()).data).toEqual([]);
  });

  it("an author may issue a link for their OWN post only; a translator for none; a trashed post is 409", () => {
    const db = getMockDb();
    setPostRole(db, "author");
    expect(createPreviewLink(db, "3", {}, "posts").id).toBeGreaterThan(0);
    fails(() => createPreviewLink(db, "8", {}, "posts"), 403, "FORBIDDEN");
    setPostRole(db, "translator");
    fails(() => createPreviewLink(db, "3", {}, "posts"), 403);
    setPostRole(db, "editor");
    expect(reason(fails(() => createPreviewLink(db, "6", {}, "posts"), 409, "INVALID_STATE"))).toBe("trashed");
  });
});
