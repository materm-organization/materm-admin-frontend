import axios from "axios";
import { beforeEach, describe, expect, it } from "vitest";

import { createMockAdapter } from "@/mocks/axios-adapter";
import { mockApiHandlers } from "@/mocks/handlers";
import {
  MockHttpError,
  createFolder,
  deleteAsset,
  deleteFolder,
  getAsset,
  getMockDb,
  listAssets,
  listRevisions,
  patchAsset,
  patchFolder,
  purgeCache,
  resetMockDb,
  restoreAsset,
  restoreRevision,
} from "@/mocks/mock-db";
import { SEED_MEDIA } from "@/mocks/media-seed";

// The mock API stands in for endpoints that are written in parallel. These tests pin the CONTRACT it enforces
// (doc/05 sections 11.6 - 11.8), so a screen that passes against it does not lean on leniency.
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
const q = (s: string) => new URLSearchParams(s);
const etag = (id: number) => getAsset(getMockDb(), String(id)).etag;

beforeEach(() => resetMockDb());

describe("seed: the 24 static/ assets of the portal bundle", () => {
  it("has the manifest's ids, keys, sizes and dimensions, every row 'static' and 'ready'", () => {
    const db = getMockDb();
    expect(db.assets).toHaveLength(24);
    expect(SEED_MEDIA.map((m) => m.media_id)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    const hero = db.assets[0];
    expect(hero).toMatchObject({ id: 1, original_filename: "hero-bg.png", mime_type: "image/png", bytes: 3126522, width: 2048, height: 1080, source: "static", status: "ready", created_by: null });
    expect(db.assets.filter((a) => a.kind === "brand").map((a) => a.original_filename)).toEqual(["materm-logo-white.svg", "materm-emblem.svg"]);
    expect(new Set(db.assets.map((a) => a.updated_at)).size).toBe(24);
  });
});

describe("GET /media/assets", () => {
  it("rejects any parameter outside the list (422 unknown_field) and `ids` combined with a filter", () => {
    const err = fails(() => listAssets(getMockDb(), q("foo=1")), 422, "VALIDATION_FAILED");
    expect(err.body.errors).toEqual([{ in: "query", path: "/foo", code: "unknown_field" }]);
    fails(() => listAssets(getMockDb(), q("ids=1,2&kind=image")), 422);
    expect(listAssets(getMockDb(), q("ids=1,2,999&limit=5")).data.map((a) => a.id)).toEqual([1, 2]);
  });

  it("filters: keyword over filename and every language's alt, folder (+sub-folders), kind, mime, unused, missing_alt, trashed", () => {
    const db = getMockDb();
    expect(listAssets(db, q("keyword=GLACIER&limit=100")).data.map((a) => a.id)).toEqual([2, 12]);
    expect(listAssets(db, q("folder_id=5&include_subfolders=true")).data.map((a) => a.id)).toEqual([23, 24]);
    expect(listAssets(db, q("folder_id=5")).data).toHaveLength(0);
    expect(listAssets(db, q("folder_id=root")).data.map((a) => a.id)).toEqual([9, 15]);
    expect(listAssets(db, q("kind=brand")).meta.total).toBe(2);
    expect(listAssets(db, q("mime=image/svg%2Bxml")).meta.total).toBe(2);
    expect(listAssets(db, q("mime=image/*")).meta.total).toBe(24);
    expect(listAssets(db, q("unused=true")).meta.total).toBe(24 - Object.keys(db.usages).length);
    expect(listAssets(db, q("missing_alt=true")).data.map((a) => a.id)).toEqual([1, 10]);
    db.assets[4].deleted_at = "2026-10-27T03:00:00.000Z";
    expect(listAssets(db, q("trashed=true")).data.map((a) => a.id)).toEqual([5]);
    expect(listAssets(db, q("")).meta.total).toBe(23);
  });

  it("sorts with a stable id tiebreaker and refuses a sort field outside the list", () => {
    const db = getMockDb();
    expect(listAssets(db, q("sort=-bytes&limit=2")).data.map((a) => a.id)).toEqual([1, 15]);
    expect(listAssets(db, q("sort=original_filename&limit=1")).data[0].original_filename).toBe("about-1-kayak.jpg");
    fails(() => listAssets(db, q("sort=checksum_sha256")), 422);
  });

  it("paginates with meta {total, page, limit, total_page}", () => {
    expect(listAssets(getMockDb(), q("page=3&limit=10")).meta).toEqual({ total: 24, page: 3, limit: 10, total_page: 3 });
  });
});

describe("PATCH /media/assets/{id}", () => {
  it("If-Match is mandatory (428) and must match (409 CONFLICT_LOCK_VERSION)", () => {
    fails(() => patchAsset(getMockDb(), "2", { is_decorative: true }, null), 428, "PRECONDITION_REQUIRED");
    fails(() => patchAsset(getMockDb(), "2", { is_decorative: true }, '"old"'), 409, "CONFLICT_LOCK_VERSION");
  });

  it("only editable fields; unknown ones are 422 unknown_field; an empty body is 422", () => {
    const err = fails(() => patchAsset(getMockDb(), "2", { kind: "video" }, etag(2)), 422);
    expect(err.body.errors).toEqual([{ in: "body", path: "/kind", code: "unknown_field" }]);
    fails(() => patchAsset(getMockDb(), "2", {}, etag(2)), 422);
  });

  it("validates lengths (alt 250, caption 500, credit 200), focal range and 3 decimals, folder and language", () => {
    const run = (body: unknown) => (fails(() => patchAsset(getMockDb(), "2", body, etag(2)), 422).body.errors as Array<{ path: string; code: string }>);
    expect(run({ translations: { en: { alt: "x".repeat(251) } } })).toEqual([expect.objectContaining({ path: "/translations/en/alt", code: "too_long" })]);
    expect(run({ translations: { en: { credit: "x".repeat(201) } } })[0].path).toBe("/translations/en/credit");
    expect(run({ translations: { fr: { alt: "x" } } })[0]).toMatchObject({ path: "/translations/fr", code: "unknown_reference" });
    expect(run({ focal: { x: 1.2, y: 0.5 } })[0]).toMatchObject({ path: "/focal/x", code: "out_of_range" });
    expect(run({ focal: { x: 0.12345, y: 0.5 } })[0]).toMatchObject({ path: "/focal/x", code: "out_of_range" });
    expect(run({ folder_id: 999 })[0]).toMatchObject({ path: "/folder_id", code: "unknown_reference" });
  });

  it("writes the state BEFORE the edit as a revision, moves the ETag, merges per field; no change = same ETag", () => {
    const db = getMockDb();
    const before = db.revisions["media/assets/2"].length;
    const first = patchAsset(db, "2", { translations: { en: { alt: "A new alt" } } }, etag(2));
    expect(first.asset.translations.en.alt).toBe("A new alt");
    expect(first.asset.translations.la.alt).toContain("climbers"); // untouched language kept
    expect(first.asset.updated_by).toEqual({ id: 6, name: "Noy Keomany" });
    expect(db.revisions["media/assets/2"]).toHaveLength(before + 1);
    expect(db.revisions["media/assets/2"].at(-1)).toMatchObject({ kind: "history", created_by: { id: 6 } });
    const same = patchAsset(db, "2", { translations: { en: { alt: "A new alt" } } }, first.etag);
    expect(same.etag).toBe(first.etag);
    expect(db.revisions["media/assets/2"]).toHaveLength(before + 1);
  });

  it("warns alt_missing_default_locale when a used, non-decorative file loses its default-language alt", () => {
    const { asset } = patchAsset(getMockDb(), "2", { translations: { la: { alt: "" } } }, etag(2));
    expect(asset.warnings).toEqual([expect.objectContaining({ code: "alt_missing_default_locale" })]);
  });

  it("a trashed asset can not be edited (409 INVALID_STATE trashed)", () => {
    const db = getMockDb();
    deleteAsset(db, "5", etag(5));
    const err = fails(() => patchAsset(db, "5", { is_decorative: true }, etag(5)), 409, "INVALID_STATE");
    expect(err.body.details).toEqual({ reason: "trashed" });
  });
});

describe("DELETE / restore", () => {
  it("a used asset is refused: 409 MEDIA_IN_USE with usages[] and total_usages", () => {
    const err = fails(() => deleteAsset(getMockDb(), "15", etag(15)), 409, "MEDIA_IN_USE");
    expect(err.body.details).toMatchObject({ total_usages: 3, usages: [{ entity_type: "cms.page", id: 3 }, expect.anything(), expect.anything()] });
  });

  it("soft delete sets purge_at 30 days out; deleting again is a no-op; restore needs the trash", () => {
    const db = getMockDb();
    deleteAsset(db, "5", etag(5));
    const asset = db.assets.find((a) => a.id === 5)!;
    expect(Date.parse(asset.purge_at!) - Date.parse(asset.deleted_at!)).toBe(30 * 86_400_000);
    expect(() => deleteAsset(db, "5", etag(5))).not.toThrow();
    const restored = restoreAsset(db, "5", etag(5));
    expect(restored.asset.deleted_at).toBeNull();
    const err = fails(() => restoreAsset(db, "5", etag(5)), 409, "INVALID_STATE");
    expect(err.body.details).toEqual({ reason: "not_trashed" });
  });
});

describe("folders", () => {
  it("names are unique per level ignoring case (409 CONFLICT_DUPLICATE /name); no / or \\ ; 4 levels at most", () => {
    const db = getMockDb();
    expect(fails(() => createFolder(db, { name: "home" }), 409, "CONFLICT_DUPLICATE").body.errors).toEqual([{ in: "body", path: "/name", code: "duplicate" }]);
    expect(createFolder(db, { name: "Home", parent_id: 5 }).depth).toBe(2);
    expect((fails(() => createFolder(db, { name: "a/b" }), 422).body.errors as Array<{ code: string }>)[0].code).toBe("pattern_mismatch");
    const l3 = createFolder(db, { name: "L3", parent_id: 6 });
    const l4 = createFolder(db, { name: "L4", parent_id: l3.id });
    expect(l4.depth).toBe(4);
    expect((fails(() => createFolder(db, { name: "L5", parent_id: l4.id }), 422).body.errors as Array<{ code: string }>)[0].code).toBe("max_depth_exceeded");
  });

  it("a folder can not move into itself or below itself; only an empty folder is deleted", () => {
    const db = getMockDb();
    expect((fails(() => patchFolder(db, "5", { parent_id: 6 }, null), 422).body.errors as Array<{ code: string }>)[0].code).toBe("cycle_detected");
    const err = fails(() => deleteFolder(db, "1", null), 409, "INVALID_STATE");
    expect(err.body.details).toMatchObject({ reason: "folder_not_empty", asset_count: 8, child_count: 0 });
    const empty = createFolder(db, { name: "Empty" });
    deleteFolder(db, String(empty.id), null);
    expect(db.folders.some((f) => f.id === empty.id)).toBe(false);
  });
});

describe("revisions", () => {
  it("list: kind must be history|restore; include_preview is accepted; a missing entity is 404", () => {
    const db = getMockDb();
    fails(() => listRevisions(db, "media/assets", "2", q("kind=draft")), 422);
    expect(listRevisions(db, "media/assets", "2", q("include_preview=true")).meta.total).toBe(4);
    expect(listRevisions(db, "media/assets", "2", q("kind=restore")).data.map((r) => r.version)).toEqual([3]);
    fails(() => listRevisions(db, "menus", "nope", q("")), 404);
  });

  it("restore: If-Match mandatory, writes a 'restore' revision of the state before it, applies the snapshot", () => {
    const db = getMockDb();
    const v1 = db.revisions["media/assets/2"][0];
    fails(() => restoreRevision(db, "media/assets", "2", String(v1.id), undefined, null), 428);
    const result = restoreRevision(db, "media/assets", "2", String(v1.id), { change_note: "back" }, etag(2));
    expect(result.data.restored_from).toEqual({ revision_id: v1.id, version: 1 });
    expect((result.data as { translations: Record<string, { alt?: string }> }).translations.la?.alt ?? "").toBe("");
    expect(db.revisions["media/assets/2"].at(-1)).toMatchObject({ kind: "restore", change_note: "back" });
    // restoring what is already current changes nothing
    const again = restoreRevision(db, "media/assets", "2", String(v1.id), undefined, result.etag);
    expect(again.etag).toBe(result.etag);
  });

  it("restore refuses a newer schema, a trashed entity and a snapshot that refers to deleted data (422 in:'entity')", () => {
    const db = getMockDb();
    const future = db.revisions["media/assets/2"][3];
    expect(fails(() => restoreRevision(db, "media/assets", "2", String(future.id), undefined, etag(2)), 409).body.details).toEqual({ reason: "snapshot_incompatible" });
    db.folders = db.folders.filter((f) => f.id !== 1);
    const v2 = db.revisions["media/assets/2"][1];
    expect(fails(() => restoreRevision(db, "media/assets", "2", String(v2.id), undefined, etag(2)), 422).body.errors).toEqual([{ in: "entity", path: "/asset/folder_id", code: "unknown_reference" }]);
  });
});

describe("POST /system/cache/purge", () => {
  it("allow-list only; tags forbidden with scope all; the server adds the paired tags; rate limits 30 / 3", () => {
    const db = getMockDb();
    expect((fails(() => purgeCache(db, { scope: "tags", tags: ["category:3", "*", "pages"] }), 422).body.errors as Array<{ path: string }>).map((e) => e.path)).toEqual(["/tags/0", "/tags/1"]);
    fails(() => purgeCache(db, { scope: "all", tags: ["pages"] }), 422);
    fails(() => purgeCache(db, { scope: "tags" }), 422);
    expect(purgeCache(db, { scope: "tags", tags: ["post:2", "page:1", "settings"] }).tags).toEqual(["page:1", "pages", "post:2", "posts:list", "settings"]);
    expect(purgeCache(db, { scope: "all" }).tags).toEqual(["*"]);
    purgeCache(db, { scope: "all" });
    purgeCache(db, { scope: "all" });
    const err = fails(() => purgeCache(db, { scope: "all" }), 429, "RATE_LIMITED");
    expect(err.headers["Retry-After"]).toBe("1800");
  });
});

describe("the browser adapter answers like the API (status, ETag header, errors reject)", () => {
  const client = axios.create({ adapter: createMockAdapter(mockApiHandlers), baseURL: "/anything" });

  it("a GET carries data, meta and the ETag header", async () => {
    const res = await client.get("/media/assets/2");
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe(`"${getMockDb().assets[1].updated_at}"`);
    expect(res.data.data.id).toBe(2);
    const list = await client.get("/media/assets", { params: { limit: 3, kind: "image" } });
    expect(list.data.data).toHaveLength(3);
    expect(list.data.meta.total).toBe(22);
  });

  it("a write is sent with its body and headers; an error status rejects with the envelope", async () => {
    await expect(client.patch("/media/assets/2", { is_decorative: true })).rejects.toMatchObject({ response: { status: 428, data: { code: "PRECONDITION_REQUIRED" } } });
    const ok = await client.patch("/media/assets/2", { is_decorative: true }, { headers: { "If-Match": etag(2) } });
    expect(ok.data.data.is_decorative).toBe(true);
    await expect(client.get("/nothing/here")).rejects.toMatchObject({ response: { status: 404 } });
  });
});
