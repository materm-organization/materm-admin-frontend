import { beforeEach, describe, expect, it } from "vitest";

import {
  createCollection,
  createEntry,
  deleteCollection,
  deleteEntry,
  getCollection,
  getEntry,
  listCollections,
  listEntries,
  patchCollection,
  patchEntry,
  publishEntry,
  restoreCollection,
  restoreEntry,
  restoreEntryRevision,
  unpublishEntry,
} from "@/mocks/mock-collections";
import { MockHttpError, getMockDb, resetMockDb } from "@/mocks/mock-db";

// The collections part of the mock API (doc/05 section 17): the contract the SCR-40 / SCR-41 screens are written against.
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
const errorsOf = (e: MockHttpError) => e.body.errors as Array<{ path: string; code: string }>;
const detailsOf = (e: MockHttpError) => e.body.details as Record<string, unknown>;
const q = (s = "") => new URLSearchParams(s);
const db = () => getMockDb();
const cEtag = (key: string) => getCollection(db(), key).etag;
const eEtag = (key: string, id: number) => getEntry(db(), key, String(id)).etag;
const simple = { type: "object", additionalProperties: false, properties: { n: { type: "integer" } } };

beforeEach(() => resetMockDb());

describe("definitions", () => {
  it("lists with counts, no schemas; the trash needs manage_schema", () => {
    const { data, meta } = listCollections(db(), q());
    expect(meta.total).toBe(2);
    expect(data[0]).toMatchObject({ key: "team", entry_count: 3, published_entry_count: 2 });
    expect(data[0]).not.toHaveProperty("json_schema");
    expect(listCollections(db(), q("trashed=true")).data.map((c) => c.key)).toEqual(["archive"]);
    db().collectionRole = "editor";
    fails(() => listCollections(db(), q("trashed=true")), 403);
  });
  it("creates with the key rules, refuses unsupported keywords and duplicates", () => {
    const e = fails(() => createCollection(db(), { key: "Bad_", name: "x", json_schema: simple }), 422, "VALIDATION_FAILED");
    expect(errorsOf(e)[0]).toMatchObject({ path: "/key", code: "pattern_mismatch" });
    const bad = fails(() => createCollection(db(), { key: "things", name: "Things", json_schema: { ...simple, properties: { n: { $ref: "#/x" } } } }), 422);
    expect(errorsOf(bad).map((x) => x.code)).toContain("unsupported_keyword");
    const ok = createCollection(db(), { key: "things", name: " Things ", json_schema: simple });
    expect(ok.data).toMatchObject({ key: "things", name: "Things", schema_version: 1, entry_count: 0 });
    fails(() => createCollection(db(), { key: "things", name: "Again", json_schema: simple }), 409, "CONFLICT_DUPLICATE");
  });
  it("PATCH needs If-Match, key is immutable, an unchanged body keeps the ETag, title_field must exist", () => {
    fails(() => patchCollection(db(), "events", { name: "E" }, null), 428);
    fails(() => patchCollection(db(), "events", { name: "E" }, '"x"'), 409, "CONFLICT_LOCK_VERSION");
    expect(errorsOf(fails(() => patchCollection(db(), "events", { key: "other" }, cEtag("events")), 422))[0].code).toBe("immutable");
    const same = patchCollection(db(), "events", { name: "Events" }, cEtag("events"));
    expect(same.etag).toBe(cEtag("events"));
    expect(errorsOf(fails(() => patchCollection(db(), "events", { title_field: "nope" }, cEtag("events")), 422))[0]).toMatchObject({ path: "/title_field", code: "unknown_reference" });
    const r = patchCollection(db(), "events", { name: "Happenings" }, cEtag("events"));
    expect(r.data.name).toBe("Happenings");
    expect(r.etag).not.toBe(same.etag);
  });
  it("a schema change that breaks entries is 409 schema_breaks_entries with the count; a compatible one bumps schema_version", () => {
    const tighter = structuredClone(getCollection(db(), "team").data.json_schema) as { properties: { year: Record<string, unknown> } };
    tighter.properties.year.minimum = 2020;
    const e = fails(() => patchCollection(db(), "team", { json_schema: tighter }, cEtag("team")), 409, "INVALID_STATE");
    expect(detailsOf(e)).toMatchObject({ reason: "schema_breaks_entries", checked: 3 });
    expect(detailsOf(e).invalid_count).toBeGreaterThan(0);
    expect((detailsOf(e).invalid_entries as Array<{ id: number }>)[0]).toHaveProperty("id");
    const looser = structuredClone(tighter);
    looser.properties.year.minimum = 1900;
    expect(patchCollection(db(), "team", { json_schema: looser }, cEtag("team")).data.schema_version).toBe(2);
    expect(getEntry(db(), "team", "1").data.schema_stale).toBe(true);
  });
  it("turning has_slug off while entries have slugs is refused", () => {
    expect(detailsOf(fails(() => patchCollection(db(), "team", { has_slug: false }, cEtag("team")), 409, "INVALID_STATE")).reason).toBe("schema_breaks_entries");
  });
  it("delete is refused while entries exist, works on an empty one, restore and the duplicate check", () => {
    const e = fails(() => deleteCollection(db(), "team", cEtag("team")), 409, "ENTITY_REFERENCED");
    expect(detailsOf(e)).toMatchObject({ reason: "collection_has_entries", entry_count: 3 });
    deleteCollection(db(), "events", cEtag("events"));
    expect(listCollections(db(), q("trashed=true")).data.map((c) => c.key)).toContain("events");
    createCollection(db(), { key: "events", name: "New events", json_schema: simple });
    fails(() => restoreCollection(db(), "events", getMockDb().collections.find((c) => c.deleted_at && c.key === "events")!.updated_at && `"${new Date().toISOString()}"`), 409);
    fails(() => restoreCollection(db(), "team", cEtag("team")), 409, "INVALID_STATE");
  });
  it("only an admin writes definitions", () => {
    db().collectionRole = "editor";
    fails(() => createCollection(db(), { key: "things", name: "Things", json_schema: simple }), 403);
    fails(() => patchCollection(db(), "team", { name: "x" }, cEtag("team")), 403);
  });
});

describe("entries", () => {
  it("lists working-copy titles, filters, sorts and refuses an unknown query key", () => {
    const { data, meta } = listEntries(db(), "team", q());
    expect(meta.total).toBe(3);
    expect(data.map((e) => e.title)).toEqual(["Somsak", "Noy", "Kham"]);
    expect(data[2]).toMatchObject({ status: "published", has_unpublished_changes: true });
    expect(listEntries(db(), "team", q("status=draft")).data.map((e) => e.id)).toEqual([2]);
    expect(listEntries(db(), "team", q("has_unpublished_changes=true")).data.map((e) => e.id)).toEqual([3]);
    expect(listEntries(db(), "team", q("trashed=true")).data.map((e) => e.id)).toEqual([4]);
    expect(listEntries(db(), "team", q("keyword=noy")).data.map((e) => e.id)).toEqual([2]);
    expect(listEntries(db(), "team", q("sort=-title")).data[0].title).toBe("Somsak");
    fails(() => listEntries(db(), "team", q("filter[x]=1")), 422);
  });
  it("IDOR: an id of another collection is 404, a trashed collection hides its entries", () => {
    fails(() => getEntry(db(), "events", "1"), 404);
    fails(() => patchEntry(db(), "events", "1", { sort_order: 1 }, '"1"'), 404);
    fails(() => listEntries(db(), "archive", q()), 404);
  });
  it("create: default title, schema data rules, slug rules and duplicates", () => {
    const body = (extra: object = {}) => ({ data: { year: 2024 }, translations: { la: { title: "New", slug: "new", data: { role: "Guide" } } }, ...extra });
    const r = createEntry(db(), "team", body());
    expect(r.etag).toBe('"1"');
    expect(r.data).toMatchObject({ status: "draft", lock_version: 1, schema_stale: false });
    fails(() => createEntry(db(), "team", body()), 409, "CONFLICT_DUPLICATE");
    expect(errorsOf(fails(() => createEntry(db(), "team", { data: {}, translations: { en: { title: "x" } } }), 422))[0].path).toBe("/translations/la/title");
    expect(errorsOf(fails(() => createEntry(db(), "team", body({ data: { year: 1500 } })), 422)).map((x) => x.path)).toContain("/data/year");
    expect(errorsOf(fails(() => createEntry(db(), "team", body({ data: { year: 2024, photo: { media_id: 999999 } } })), 422))[0]).toMatchObject({ code: "unknown_reference" });
    expect(errorsOf(fails(() => createEntry(db(), "team", { translations: { la: { title: "T", slug: "Bad Slug" } } }), 422))[0].code).toBe("pattern_mismatch");
  });
  it("PATCH of a published entry goes to the draft; required fields only block at publish", () => {
    const before = getEntry(db(), "team", "1");
    const r = patchEntry(db(), "team", "1", { data: { year: 2020 }, translations: { la: { data: { role: "" } } } }, before.etag);
    expect(r.data).toMatchObject({ lock_version: 2, has_unpublished_changes: true });
    expect(r.etag).toBe('"2"');
    fails(() => patchEntry(db(), "team", "1", { sort_order: 5 }, before.etag), 409, "CONFLICT_LOCK_VERSION");
    fails(() => patchEntry(db(), "team", "1", { sort_order: 5 }, null), 428);
    fails(() => patchEntry(db(), "team", "1", {}, r.etag), 422);
  });
  it("a taken address is refused at Save even for a published entry's draft; a collision that appears later is caught at publish", () => {
    fails(() => patchEntry(db(), "team", "3", { translations: { la: { slug: "somsak" } } }, eEtag("team", 3)), 409, "CONFLICT_DUPLICATE");
    // entry 3 already holds a pending draft whose English address is Somsak's live one (seeded): publish names it
    const e = fails(() => publishEntry(db(), "team", "3", q("dry_run=true"), undefined, eEtag("team", 3)), 422, "PUBLISH_BLOCKED");
    expect((e.body.errors as Array<{ path: string; code: string }>).map((x) => `${x.path} ${x.code}`)).toContain("/translations/en/slug duplicate");
  });
  it("publish: dry run lists the blockers (duplicate slug, missing role), then publishes and clears the draft", () => {
    const e = fails(() => publishEntry(db(), "team", "3", q("dry_run=true"), undefined, eEtag("team", 3)), 422, "PUBLISH_BLOCKED");
    expect((e.body.errors as Array<{ path: string; code: string }>).map((x) => `${x.path} ${x.code}`)).toContain("/translations/en/slug duplicate");
    // Noy is complete in the default language: the dry run passes with the English warning and changes nothing
    const noy = publishEntry(db(), "team", "2", q("dry_run=true"), undefined, eEtag("team", 2));
    expect(noy.data).toMatchObject({ publishable: true });
    expect(getEntry(db(), "team", "2").data.status).toBe("draft");
    patchEntry(db(), "team", "2", { translations: { la: { data: {} } } }, eEtag("team", 2));
    expect(errorsOf(fails(() => publishEntry(db(), "team", "2", q("dry_run=true"), undefined, eEtag("team", 2)), 422, "PUBLISH_BLOCKED")).map((x) => x.code)).toContain("required");
    patchEntry(db(), "team", "3", { translations: { en: { slug: "kham" } } }, eEtag("team", 3));
    const ok = publishEntry(db(), "team", "3", q(), undefined, eEtag("team", 3));
    expect(ok.data).toMatchObject({ status: "published", has_unpublished_changes: false });
    expect(ok.etag).toBeDefined();
  });
  it("unpublish, trash, restore and the slug clash on restore", () => {
    unpublishEntry(db(), "team", "1", q(), eEtag("team", 1));
    expect(getEntry(db(), "team", "1").data.status).toBe("archived");
    deleteEntry(db(), "team", "2", q(), eEtag("team", 2));
    expect(getEntry(db(), "team", "2").data.deleted_at).not.toBeNull();
    createEntry(db(), "team", { translations: { la: { title: "Noy again", slug: "noy" } } });
    fails(() => restoreEntry(db(), "team", "2", eEtag("team", 2)), 409, "CONFLICT_DUPLICATE");
    expect(restoreEntry(db(), "team", "4", eEtag("team", 4)).data.status).toBe("draft");
  });
  it("revision restore is judged against the current schema", () => {
    // a restore of an old snapshot that has no required role still restores in draft mode
    const revs = db().revisions["collection-entries/1"];
    const history = revs.find((r) => r.kind === "history")!;
    const r = restoreEntryRevision(db(), "team", "1", String(history.id), undefined, eEtag("team", 1));
    expect(r.data).toHaveProperty("restored_from");
  });
  it("roles: a viewer reads only; a translator edits language rows but not data or sort order", () => {
    db().collectionRole = "viewer";
    fails(() => createEntry(db(), "team", { translations: { la: { title: "x" } } }), 403);
    fails(() => patchEntry(db(), "team", "1", { translations: { la: { title: "x" } } }, eEtag("team", 1)), 403);
    db().collectionRole = "admin";
    db().translateOnly = ["collection-entries"];
    fails(() => patchEntry(db(), "team", "1", { sort_order: 99 }, eEtag("team", 1)), 403);
    fails(() => patchEntry(db(), "team", "1", { translations: { en: null } }, eEtag("team", 1)), 403);
    expect(patchEntry(db(), "team", "1", { translations: { en: { title: "Somsak EN" } } }, eEtag("team", 1)).data.title).toBe("Somsak");
    fails(() => publishEntry(db(), "team", "1", q(), undefined, eEtag("team", 1)), 403);
  });
});

describe("restore from the trash is judged against the current schema (backend 0c541f6)", () => {
  it("an entry that no longer passes is a 422 in:entity with the path; an unchanged schema restores", () => {
    // the schema became stricter while entry 4 (year 2012) was in the trash: the server reads the live row against the CURRENT schema
    const team = db().collections.find((c) => c.key === "team")!;
    team.json_schema = { ...team.json_schema, properties: { ...(team.json_schema.properties as object), year: { type: "integer", minimum: 2020 } } };
    const e = fails(() => restoreEntry(db(), "team", "4", eEtag("team", 4)), 422, "VALIDATION_FAILED");
    expect(errorsOf(e)[0]).toMatchObject({ path: "/data/year", code: "out_of_range" });
  });
});
