import { beforeEach, describe, expect, it } from "vitest";

import { etagOf, MockHttpError } from "@/mocks/mock-core";
import { createMockDb } from "@/mocks/mock-db";
import { createAuthor, deleteAuthor, getAuthor, listAuthors, patchAuthor, restoreAuthorFromTrash } from "@/mocks/mock-authors";
import { patchPost, postWorking } from "@/mocks/mock-posts";

let db = createMockDb();
beforeEach(() => {
  db = createMockDb();
});
const q = (s = "") => new URLSearchParams(s);
const fails = (fn: () => unknown, status: number) => {
  try {
    fn();
  } catch (e) {
    const err = e as MockHttpError;
    expect(err.status).toBe(status);
    return err;
  }
  throw new Error("expected a failure");
};
const errs = (e: MockHttpError) => e.body.errors as Array<{ path: string; code: string; params?: unknown }>;
const etag = (id: number) => etagOf(db.authors.find((a) => a.id === id)!.updated_at);

describe("authors mock (doc/05 section 15)", () => {
  it("lists with counts, filters, sorts and the trash", () => {
    const all = listAuthors(db, q());
    expect(all.data.map((a) => a.display_name)).toEqual(["Dara Phommachan", "Mali Keo", "Somchai Vongsa"]);
    expect(all.data.find((a) => a.id === 1)).toMatchObject({ post_count: 1, published_post_count: 1, user: { id: 4, username: "somchai" } });
    expect(listAuthors(db, q("is_active=false")).data.map((a) => a.id)).toEqual([3]);
    expect(listAuthors(db, q("has_user=false")).data.map((a) => a.id)).toEqual([3]);
    expect(listAuthors(db, q("keyword=photographer")).data.map((a) => a.id)).toEqual([2]);
    expect(listAuthors(db, q("sort=-post_count")).data[0].post_count).toBeGreaterThanOrEqual(1);
    expect(listAuthors(db, q("trashed=true")).data.map((a) => a.id)).toEqual([4]);
    fails(() => listAuthors(db, q("bogus=1")), 422);
    fails(() => listAuthors(db, q("sort=bio")), 422);
    fails(() => listAuthors(db, q("has_user=maybe")), 422);
  });

  it("creates: every problem in one 422, a taken account is 409 duplicate at /user_id", () => {
    const e = fails(() => createAuthor(db, { display_name: "", user_id: 99, avatar_media_id: 99, bogus: 1, translations: { xx: { bio: "a" }, en: { bio: "x".repeat(2001) } } }), 422);
    expect(errs(e).map((x) => `${x.path}:${x.code}`)).toEqual(["/bogus:unknown_field", "/display_name:required", "/user_id:unknown_reference", "/avatar_media_id:unknown_reference", "/translations/xx:unknown_reference", "/translations/en/bio:too_long"]);
    const dup = fails(() => createAuthor(db, { display_name: "Copy", user_id: 4 }), 409);
    expect(dup.body.code).toBe("CONFLICT_DUPLICATE");
    expect(errs(dup)[0]).toMatchObject({ path: "/user_id", code: "duplicate" });
    const ok = createAuthor(db, { display_name: " New ", translations: { en: { job_title: "Guide" }, la: { bio: "  " } } });
    expect(ok.data).toMatchObject({ display_name: "New", is_active: true, translations: { en: { bio: null, job_title: "Guide" } }, post_count: 0 });
    expect(ok.data.translations.la).toBeUndefined();
  });

  it("an image is required for the avatar", () => {
    const video = db.assets.find((a) => a.kind !== "image");
    if (video) expect(errs(fails(() => createAuthor(db, { display_name: "A", avatar_media_id: video.id }), 422))[0]).toMatchObject({ code: "kind_mismatch", params: { expected: "image" } });
    const image = db.assets.find((a) => a.kind === "image")!;
    expect(createAuthor(db, { display_name: "A", avatar_media_id: image.id }).data.avatar).toMatchObject({ id: image.id });
  });

  it("PATCH needs If-Match, merges per member, unchanged = same ETag and no revision, a change adds a revision", () => {
    fails(() => patchAuthor(db, "1", { is_active: false }, null), 428);
    fails(() => patchAuthor(db, "1", { is_active: false }, '"9"'), 409);
    expect(errs(fails(() => patchAuthor(db, "1", {}, etag(1)), 422))[0].code).toBe("min_properties");
    const before = db.revisions["authors/1"].length;
    const same = patchAuthor(db, "1", { display_name: "Somchai Vongsa" }, etag(1));
    expect(same.etag).toBe(etag(1));
    expect(db.revisions["authors/1"]).toHaveLength(before);
    const merged = patchAuthor(db, "1", { translations: { en: { bio: "New bio" } } }, etag(1));
    expect(merged.data.translations.en).toEqual({ bio: "New bio", job_title: "Editor in chief" });
    expect(db.revisions["authors/1"]).toHaveLength(before + 1);
    // a member cleared to null; a language left with neither text goes away
    const cleared = patchAuthor(db, "2", { translations: { en: { job_title: null } } }, etag(2));
    expect(cleared.data.translations.en).toBeUndefined();
    // unlink and a taken account
    expect(patchAuthor(db, "2", { user_id: null }, etag(2)).data.user_id).toBeNull();
    fails(() => patchAuthor(db, "2", { user_id: 4 }, etag(2)), 409);
  });

  it("translate-only: other fields, the default language and deleting a language are 403", () => {
    db.translateOnly = ["authors"];
    fails(() => patchAuthor(db, "1", { display_name: "x" }, etag(1)), 403);
    fails(() => patchAuthor(db, "1", { translations: { la: { bio: "x" } } }, etag(1)), 403);
    fails(() => patchAuthor(db, "1", { translations: { en: null } }, etag(1)), 403);
    expect(patchAuthor(db, "1", { translations: { en: { bio: "ok" } } }, etag(1)).data.translations.en?.bio).toBe("ok");
  });

  it("delete is blocked while posts use the author (409 ENTITY_REFERENCED, author_has_posts + post_count); trashed posts do not count", () => {
    const e = fails(() => deleteAuthor(db, "1", etag(1)), 409);
    expect(e.body).toMatchObject({ code: "ENTITY_REFERENCED", details: { reason: "author_has_posts", post_count: 1 } });
    // post 6 (trashed) names author 1 too and is not counted
    expect(db.posts.find((p) => p.id === 6)?.deleted_at).toBeTruthy();
    expect(db.authors[0].deleted_at).toBeNull();
    // move the post away, then the delete works and the slot of the account is free
    postWorking(db, db.posts.find((p) => p.id === 4)!).post.author_id = null;
    deleteAuthor(db, "1", etag(1));
    expect(db.authors[0].deleted_at).toBeTruthy();
    expect(createAuthor(db, { display_name: "Reuse", user_id: 4 }).data.user_id).toBe(4);
    // restoring now clashes on the account
    const clash = fails(() => restoreAuthorFromTrash(db, "1", etag(1)), 409);
    expect(errs(clash)[0]).toMatchObject({ path: "/user_id", code: "duplicate" });
    expect(getAuthor(db, "4").data.deleted_at).toBeTruthy();
    fails(() => restoreAuthorFromTrash(db, "2", etag(2)), 409);
  });

  it("posts: author_id is checked only when it changes (an author switched off later stays)", () => {
    const post5 = db.posts.find((p) => p.id === 5)!;
    expect(post5.live.post.author_id).toBe(3);
    const e = (id: number) => etagOf(String(db.posts.find((p) => p.id === id)!.lock_version));
    // sending the same inactive author again is fine
    expect(() => patchPost(db, "5", { author_id: 3, is_featured: true }, e(5))).not.toThrow();
    // choosing the inactive author for another post is not
    expect(errs(fails(() => patchPost(db, "3", { author_id: 3 }, e(3)), 422))[0]).toMatchObject({ path: "/author_id", code: "author_inactive" });
    expect(errs(fails(() => patchPost(db, "3", { author_id: 99 }, e(3)), 422))[0]).toMatchObject({ code: "unknown_reference", params: { ref_type: "authors" } });
    const ok = patchPost(db, "3", { author_id: 2 }, e(3));
    expect(ok.data).toMatchObject({ author_id: 2, author_name: "Dara Phommachan" });
    expect(patchPost(db, "3", { author_id: null }, e(3)).data).toMatchObject({ author_id: null, author_name: null });
  });
});
