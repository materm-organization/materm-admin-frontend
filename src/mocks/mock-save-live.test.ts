import { beforeEach, describe, expect, it } from "vitest";

import { MockHttpError, getMockDb, getRevision, listRevisions, resetMockDb, restoreRevision } from "@/mocks/mock-db";
import { createMenuItem, deleteMenuItem, getMenu, patchMenuItem, reorderMenuItems } from "@/mocks/mock-menus";
import { getSettingsGroup, putSettingsGroup } from "@/mocks/mock-settings";
import { createTaxonomy, deleteTaxonomy, getTaxonomyRow, listTaxonomy, patchTaxonomy, restoreTaxonomyRow } from "@/mocks/mock-taxonomy";
import { bundleSync, deleteUiString, listUiStrings, putUiString, uiStringKeyEtag } from "@/mocks/mock-ui-strings";

// The save-live part of the mock API (menus, settings, UI strings, categories / tags): the contract of doc/05 sections
// 11.2 - 11.5 and 11.7 that a screen written against it may rely on.
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
const errorsOf = (e: MockHttpError) => e.body.errors as Array<{ path: string; code: string; in: string }>;
const q = (s: string) => new URLSearchParams(s);

beforeEach(() => resetMockDb());

describe("menus (05 11.2)", () => {
  const link = { type: "url", url: "https://example.org/x" };
  const etag = (key = "main") => getMenu(getMockDb(), key).etag!;

  it("is seeded like the admin backend: main 5 page links, footer 4, social 4 with icons", () => {
    const db = getMockDb();
    expect(getMenu(db, "main").menu.items.map((i) => i.link.page_id)).toEqual([1, 2, 3, 4, 5]);
    expect(getMenu(db, "footer").menu.items).toHaveLength(4);
    expect(getMenu(db, "social").menu.items.map((i) => i.icon)).toEqual(["instagram", "youtube", "facebook", "twitter"]);
    expect(getMenu(db, "social").menu.options.icons).toEqual(["instagram", "youtube", "facebook", "twitter"]);
    expect(getMenu(db, "main").menu.limits).toEqual({ max_depth: 1, max_items: 30, recommended_max_items: 7 });
    fails(() => getMenu(db, "nope"), 404);
  });

  it("create: If-Match is mandatory (428), stale is 409, unknown fields and bad values are 422 with pointers", () => {
    const db = getMockDb();
    fails(() => createMenuItem(db, "main", { link, translations: { la: { label: "X" } } }, null), 428);
    fails(() => createMenuItem(db, "main", { link, translations: { la: { label: "X" } } }, '"old"'), 409, "CONFLICT_LOCK_VERSION");
    const e = fails(() => createMenuItem(db, "main", { link: { type: "url", url: "http://insecure.org", anchor: "x" }, translations: { en: { label: "" } }, parent_id: 3, nope: 1 }, etag()), 422);
    // structural problems come first (unknown field), then nothing else is reported
    expect(errorsOf(e)).toEqual([{ in: "body", path: "/nope", code: "unknown_field" }]);
    const f = fails(() => createMenuItem(db, "main", { link: { type: "url", url: "http://insecure.org" }, translations: { en: { label: "" } }, parent_id: 3 }, etag()), 422);
    expect(errorsOf(f).map((x) => `${x.path}:${x.code}`)).toEqual(
      expect.arrayContaining(["/link/url:pattern_mismatch", "/translations/en/label:too_short", "/translations/la/label:required", "/parent_id:max_depth_exceeded"])
    );
    for (const bad of ["javascript:alert(1)", "//evil.example", "ftp://x"]) {
      const err = fails(() => createMenuItem(db, "main", { link: { type: "url", url: bad }, translations: { la: { label: "X" } } }, etag()), 422);
      expect(errorsOf(err)[0]).toMatchObject({ path: "/link/url", code: "pattern_mismatch" });
    }
  });

  it("create: a draft page is allowed with the link_page_not_published warning; a trashed or unknown page is not", () => {
    const db = getMockDb();
    const ok = createMenuItem(db, "main", { link: { type: "page", page_id: 6 }, translations: { la: { label: "Spring" } } }, etag());
    expect(ok.data.warnings.map((w) => w.code)).toContain("link_page_not_published");
    expect(ok.data.item.link_state).toBe("page_unpublished");
    expect(ok.etag).toBe(getMenu(db, "main").etag);
    for (const page_id of [7, 99]) {
      const err = fails(() => createMenuItem(db, "main", { link: { type: "page", page_id }, translations: { la: { label: "X" } } }, etag()), 422);
      expect(errorsOf(err)[0]).toMatchObject({ path: "/link/page_id", code: "unknown_reference" });
    }
  });

  it("social: icon from the registry is required and https only; page links are refused; other menus take no icon", () => {
    const db = getMockDb();
    const t = { la: { label: "Mastodon" } };
    expect(errorsOf(fails(() => createMenuItem(db, "social", { link, translations: t }, etag("social")), 422)).map((e) => e.code)).toContain("required");
    expect(errorsOf(fails(() => createMenuItem(db, "social", { link, translations: t, icon: "mastodon" }, etag("social")), 422))[0].code).toBe("not_in_enum");
    expect(errorsOf(fails(() => createMenuItem(db, "social", { link: { type: "url", url: "/x" }, translations: t, icon: "youtube" }, etag("social")), 422))[0]).toMatchObject({ path: "/link/url", code: "pattern_mismatch" });
    expect(errorsOf(fails(() => createMenuItem(db, "main", { link, translations: t, icon: "youtube" }, etag()), 422))[0]).toMatchObject({ path: "/icon", code: "not_applicable" });
  });

  it("create positions the item and renumbers; more than 7 in main is a warning, more than 30 is a 422", () => {
    const db = getMockDb();
    const r = createMenuItem(db, "main", { link, translations: { la: { label: "First" } }, position: 0 }, etag());
    expect(getMenu(db, "main").menu.items[0].id).toBe(r.data.item.id);
    expect(getMenu(db, "main").menu.items.map((i) => i.sort_order)).toEqual([0, 1, 2, 3, 4, 5]);
    fails(() => createMenuItem(db, "main", { link, translations: { la: { label: "X" } }, position: 9 }, etag()), 422);
    createMenuItem(db, "main", { link, translations: { la: { label: "Seventh" } } }, etag());
    const eighth = createMenuItem(db, "main", { link, translations: { la: { label: "Eighth" } } }, etag());
    expect(eighth.data.warnings.map((w) => w.code)).toContain("too_many_items");
    while (getMenu(db, "main").menu.items.length < 30) createMenuItem(db, "main", { link, translations: { la: { label: "More" } } }, etag());
    expect(errorsOf(fails(() => createMenuItem(db, "main", { link, translations: { la: { label: "X" } } }, etag()), 422))[0].code).toBe("limit_exceeded");
  });

  it("patch: partial, merges translations, deleting the default language is refused, no change = same ETag and no revision", () => {
    const db = getMockDb();
    const before = etag();
    const revisions = listRevisions(db, "menus", "main", q("")).meta.total;
    const same = patchMenuItem(db, "main", "1", { is_visible: true }, before);
    expect(same.etag).toBe(before);
    expect(listRevisions(db, "menus", "main", q("")).meta.total).toBe(revisions);
    fails(() => patchMenuItem(db, "main", "1", {}, before), 422);
    fails(() => patchMenuItem(db, "main", "1", { translations: { la: null } }, before), 422);
    fails(() => patchMenuItem(db, "main", "99", { is_visible: false }, before), 404);
    fails(() => patchMenuItem(db, "main", "6", { is_visible: false }, before), 404); // an item of another menu
    const r = patchMenuItem(db, "main", "1", { translations: { en: null }, is_visible: false }, before);
    expect(r.data.item.translations.en).toBeUndefined();
    expect(r.data.item.missing_locales).toEqual(["en"]);
    expect(r.etag).not.toBe(before);
    expect(listRevisions(db, "menus", "main", q("")).meta.total).toBe(revisions + 1);
  });

  it("translate-only writer: labels yes, anything else that changes is 403, create / delete / order are 403", () => {
    const db = getMockDb();
    db.translateOnly = ["menus"];
    const e = etag();
    expect(patchMenuItem(db, "main", "1", { translations: { en: { label: "Start" } } }, e).data.item.translations.en.label).toBe("Start");
    fails(() => patchMenuItem(db, "main", "1", { is_visible: false }, etag()), 403, "FORBIDDEN");
    fails(() => createMenuItem(db, "main", { link, translations: { la: { label: "X" } } }, etag()), 403);
    fails(() => deleteMenuItem(db, "main", "2", etag()), 403);
    fails(() => reorderMenuItems(db, "main", { items: getMenu(db, "main").menu.items.map((i) => ({ id: i.id })).reverse() }, etag()), 403);
  });

  it("order: the set of ids must equal the current one exactly (duplicate / unknown / missing), atomic", () => {
    const db = getMockDb();
    const ids = getMenu(db, "main").menu.items.map((i) => i.id);
    const e = etag();
    fails(() => reorderMenuItems(db, "main", { items: ids.map((id) => ({ id })) }, null), 428);
    expect(errorsOf(fails(() => reorderMenuItems(db, "main", { items: [{ id: 1 }, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] }, e), 422)).map((x) => x.code)).toContain("duplicate");
    expect(errorsOf(fails(() => reorderMenuItems(db, "main", { items: [...ids.map((id) => ({ id })), { id: 6 }] }, e), 422)).map((x) => x.code)).toContain("unknown_reference");
    const missing = errorsOf(fails(() => reorderMenuItems(db, "main", { items: ids.slice(1).map((id) => ({ id })) }, e), 422))[0];
    expect(missing).toMatchObject({ path: "", code: "required" });
    expect(errorsOf(fails(() => reorderMenuItems(db, "main", { items: ids.map((id) => ({ id, parent_id: 1 })) }, e), 422))[0].code).toBe("max_depth_exceeded");
    expect(getMenu(db, "main").menu.items.map((i) => i.id)).toEqual(ids); // nothing applied
    const r = reorderMenuItems(db, "main", { items: [...ids].reverse().map((id) => ({ id })) }, e);
    expect(r.data.items.map((i) => i.id)).toEqual([...ids].reverse());
    expect(getMenu(db, "main").menu.items.map((i) => i.id)).toEqual([...ids].reverse());
    // same order again: nothing changes, same ETag
    expect(reorderMenuItems(db, "main", { items: [...ids].reverse().map((id) => ({ id })) }, r.etag).etag).toBe(r.etag);
  });

  it("delete is hard and needs If-Match; restoring the previous version brings the item back with a NEW id", () => {
    const db = getMockDb();
    const e = etag();
    fails(() => deleteMenuItem(db, "main", "2", null), 428);
    const del = deleteMenuItem(db, "main", "2", e);
    expect(del.data.menu.item_count).toBe(4);
    const hist = listRevisions(db, "menus", "main", q("sort=-version")).data[0];
    const rev = getRevision(db, "menus", "main", String(hist.id));
    const restored = restoreRevision(db, "menus", "main", String(rev.id), undefined, del.etag);
    const items = (restored.data as unknown as { items: Array<{ id: number; public_id: string }> }).items;
    expect(items).toHaveLength(5);
    expect(items.some((i) => i.id === 2)).toBe(false);
    expect(restored.data.restored_from).toEqual({ revision_id: rev.id, version: rev.version });
  });

  it("restore: If-Match mandatory, a page that is gone is a 422 in:entity (nothing applied), a newer schema is snapshot_incompatible", () => {
    const db = getMockDb();
    const list = listRevisions(db, "menus", "main", q("sort=version")).data;
    fails(() => restoreRevision(db, "menus", "main", String(list[0].id), undefined, null), 428);
    db.pages.find((p) => p.id === 3)!.deleted_at = "2026-10-27T03:00:00.000000Z";
    const e = fails(() => restoreRevision(db, "menus", "main", String(list[1].id), undefined, etag()), 422);
    expect(errorsOf(e)[0]).toMatchObject({ in: "entity", code: "unknown_reference" });
    const future = { ...getRevision(db, "menus", "main", String(list[0].id)), schema_version: 99 };
    db.revisions["menus/main"].push({ ...future, id: 9999, version: 9 });
    fails(() => restoreRevision(db, "menus", "main", "9999", undefined, etag()), 409, "INVALID_STATE");
  });
});

describe("settings (05 11.3)", () => {
  const values = () => structuredClone(getSettingsGroup(getMockDb(), "brand").data.values) as Record<string, unknown>;

  it("is seeded like the admin backend: 7 brand keys (logo / emblem = media 23 / 24), 21 settings in all groups of P1+analytics seeds", () => {
    const db = getMockDb();
    const brand = getSettingsGroup(db, "brand").data;
    expect(brand.fields.map((f) => f.key)).toEqual(["name", "logo_alt", "emblem_alt", "statement", "logo_media_id", "emblem_media_id", "favicon_media_id"]);
    expect(brand.values.logo_media_id).toBe(23);
    expect(brand.values.statement).toEqual({ la: expect.any(String), en: expect.any(String) });
    expect(brand.media["23"].mime_type).toBe("image/svg+xml");
    expect(brand.permission_key).toBe("cms.settings");
    expect(getSettingsGroup(db, "seo").data.permission_key).toBe("cms.seo");
    expect(getSettingsGroup(db, "seo").etag).toBe('"0"'.replace("0", String(getSettingsGroup(db, "seo").data.version)));
    fails(() => getSettingsGroup(db, "analytics"), 404);
    fails(() => getSettingsGroup(db, "social"), 404);
  });

  it("put: If-Match mandatory (428) and the revision number (409); unknown key / missing key / bad values are 422 with pointers", () => {
    const db = getMockDb();
    const g = getSettingsGroup(db, "brand");
    fails(() => putSettingsGroup(db, "brand", { values: values() }, null), 428);
    fails(() => putSettingsGroup(db, "brand", { values: values() }, '"99"'), 409, "CONFLICT_LOCK_VERSION");
    const extra = fails(() => putSettingsGroup(db, "brand", { values: { ...values(), nope: 1 } }, g.etag), 422);
    expect(errorsOf(extra)[0]).toMatchObject({ path: "/values/nope", code: "unknown_field" });
    const missing = values();
    delete missing.name;
    expect(errorsOf(fails(() => putSettingsGroup(db, "brand", { values: missing }, g.etag), 422))[0]).toMatchObject({ path: "/values/name", code: "required" });
    const bad = fails(() => putSettingsGroup(db, "brand", { values: { ...values(), name: "x".repeat(81), statement: { la: "ok", en: "y".repeat(301) }, logo_media_id: 9999 } }, g.etag), 422);
    expect(errorsOf(bad).map((e) => `${e.path}:${e.code}`)).toEqual(
      expect.arrayContaining(["/values/name:too_long", "/values/statement/en:too_long", "/values/logo_media_id:unknown_reference"])
    );
    const noDefault = fails(() => putSettingsGroup(db, "brand", { values: { ...values(), statement: { en: "only english" } } }, g.etag), 422);
    expect(errorsOf(noDefault)[0]).toMatchObject({ path: "/values/statement/la", code: "required" });
    // image kind / mime of the field
    expect(errorsOf(fails(() => putSettingsGroup(db, "seo", { values: { ...structuredClone(getSettingsGroup(db, "seo").data.values), default_og_media_id: 23 } }, getSettingsGroup(db, "seo").etag), 422))[0]).toMatchObject({ code: "invalid_format" });
  });

  it("contact / site / seo / footer rules: E.164, e-mail, https only, one %s, only {year}", () => {
    const db = getMockDb();
    const put = (group: string, patch: Record<string, unknown>) => {
      const g = getSettingsGroup(db, group);
      return putSettingsGroup(db, group, { values: { ...structuredClone(g.data.values), ...patch } }, g.etag);
    };
    const path = (group: string, patch: Record<string, unknown>) => errorsOf(fails(() => put(group, patch), 422))[0];
    expect(path("contact", { phone: "020123" })).toMatchObject({ path: "/values/phone", code: "pattern_mismatch" });
    expect(path("contact", { email: "not-an-email" })).toMatchObject({ path: "/values/email", code: "invalid_format" });
    expect(path("contact", { map_url: "http://maps.example" })).toMatchObject({ path: "/values/map_url", code: "pattern_mismatch" });
    expect(path("site", { base_url: "https://x.example/?q=1" })).toMatchObject({ path: "/values/base_url", code: "pattern_mismatch" });
    expect(path("seo", { title_template: "no placeholder" })).toMatchObject({ path: "/values/title_template", code: "pattern_mismatch" });
    expect(path("seo", { title_template: "%s | %s" })).toMatchObject({ code: "pattern_mismatch" });
    expect(path("footer", { copyright: { la: "(c) {name}", en: "(c) {name}" } })).toMatchObject({ path: "/values/copyright/la", code: "pattern_mismatch" });
    const ok = put("footer", { copyright: { la: "(c) {year} Materm", en: "(c) {year} Materm" } });
    expect(ok.data.version).toBe(1);
    expect(ok.etag).toBe('"1"');
  });

  it("put writes the before-image as a revision, bumps the ETag by one, trims the base url, warns on a changed base url / long description", () => {
    const db = getMockDb();
    const site = getSettingsGroup(db, "site");
    const r = putSettingsGroup(db, "site", { values: { base_url: "https://materm.test/  " } }, site.etag);
    expect(r.data.values.base_url).toBe("https://materm.test");
    expect(r.data.warnings!.map((w) => w.code)).toEqual(["base_url_changed"]);
    expect(r.etag).toBe('"1"');
    expect(db.revisions["settings/site"][0].snapshot).toMatchObject({ group_key: "site", settings: [{ key: "base_url", value: "https://materm.example" }] });
    // nothing changed -> 200, same ETag, no revision
    const again = putSettingsGroup(db, "site", { values: { base_url: "https://materm.test" } }, r.etag);
    expect(again.etag).toBe('"1"');
    expect(db.revisions["settings/site"]).toHaveLength(1);
    const seo = getSettingsGroup(db, "seo");
    const long = "x".repeat(170);
    const w = putSettingsGroup(db, "seo", { values: { ...structuredClone(seo.data.values), default_description: { la: long, en: "short" } } }, seo.etag);
    expect(w.data.warnings![0]).toMatchObject({ code: "serp_description_long", path: "/values/default_description/la", params: { length: 170, recommended: 160 } });
  });

  it("a language left out of a localized value deletes that translation (PUT replaces the group)", () => {
    const db = getMockDb();
    const g = getSettingsGroup(db, "brand");
    const r = putSettingsGroup(db, "brand", { values: { ...structuredClone(g.data.values), logo_alt: { la: "Logo" } } }, g.etag);
    expect(r.data.values.logo_alt).toEqual({ la: "Logo" });
  });

  it("translate-only: may leave out the other keys; sending a changed non-localized value is 403", () => {
    const db = getMockDb();
    db.translateOnly = ["settings"];
    const g = getSettingsGroup(db, "brand");
    const ok = putSettingsGroup(db, "brand", { values: { statement: { la: "ໃໝ່", en: "New" }, logo_alt: { la: "a", en: "a" }, emblem_alt: { la: "b", en: "b" } } }, g.etag);
    expect(ok.data.values.statement).toEqual({ la: "ໃໝ່", en: "New" });
    fails(() => putSettingsGroup(db, "brand", { values: { ...structuredClone(ok.data.values), name: "OTHER" } }, ok.etag), 403, "FORBIDDEN");
  });

  it("restore re-applies a version, takes a new revision number and validates the media it refers to", () => {
    const db = getMockDb();
    const list = listRevisions(db, "settings", "brand", q("sort=version")).data;
    const g = getSettingsGroup(db, "brand");
    fails(() => restoreRevision(db, "settings", "brand", String(list[0].id), undefined, null), 428);
    const r = restoreRevision(db, "settings", "brand", String(list[0].id), undefined, g.etag);
    expect((r.data as unknown as { values: Record<string, unknown> }).values.logo_media_id).toBeNull();
    expect(r.etag).toBe(`"${g.data.version + 1}"`);
    db.assets.find((a) => a.id === 23)!.deleted_at = "2026-10-27T00:00:00Z";
    const back = listRevisions(db, "settings", "brand", q("sort=-version")).data[0]; // the restore row = state before, which has logo 23
    expect(errorsOf(fails(() => restoreRevision(db, "settings", "brand", String(back.id), undefined, r.etag), 422))[0]).toMatchObject({ in: "entity", code: "unknown_reference" });
  });
});

describe("ui strings (05 11.4)", () => {
  const find = (key: string) => listUiStrings(getMockDb(), q(`keyword=${key}`)).data.find((i) => i.key === key)!;

  it("is seeded from the real bundle: 39 keys, no seeded row is an override except the invented ones (an orphan row counts as one: no source)", () => {
    const db = getMockDb();
    const all = listUiStrings(db, q("limit=100"));
    expect(all.meta.total).toBe(40); // 39 + one invented orphan
    expect(all.meta.summary).toMatchObject({ keys: 40, overridden: 4, orphans: 1 });
    expect(all.meta.manifest).toMatchObject({ version: 1, key_count: 39, source_commit: "33a97a4" });
    expect(find("site.nav.currentPage").placeholders).toEqual(["page"]);
    expect(find("site.skipToContent").locales.la).toMatchObject({ is_override: false, source: "Skip to main content", value: "Skip to main content" });
    expect(find("blog.categories.all").locales.la).toMatchObject({ is_override: true, value: "ທັງໝົດ", source: "All" });
  });

  it("list: unknown parameters are 422, same_as needs one locale, filters answer, a missing manifest makes the filters 409", () => {
    const db = getMockDb();
    fails(() => listUiStrings(db, q("nope=1")), 422);
    fails(() => listUiStrings(db, q("same_as=en")), 422);
    fails(() => listUiStrings(db, q("locale=xx")), 422);
    fails(() => listUiStrings(db, q("overridden=maybe")), 422);
    expect(listUiStrings(db, q("overridden=true")).data.map((i) => i.key).sort()).toEqual(["blog.categories.all", "blog.index.listLabel", "blog.index.oldTitle", "site.nav.closeMenu"]);
    expect(listUiStrings(db, q("orphan=true")).data.map((i) => i.key)).toEqual(["blog.index.oldTitle"]);
    expect(listUiStrings(db, q("namespace=forms&limit=100")).data).toHaveLength(9);
    // "still English": la value equals the en value
    const same = listUiStrings(db, q("locale=la&same_as=en&limit=100"));
    expect(same.meta.total).toBe(37); // 39 keys - 3 whose la or en was changed + the orphan
    db.uiRows.find((r) => r.key === "forms.errors.email" && r.locale === "la")!.value = "ກະລຸນາໃສ່ອີເມວ";
    expect(listUiStrings(db, q("locale=la&same_as=en&limit=100")).data.some((i) => i.key === "forms.errors.email")).toBe(false);
    db.manifests = [];
    expect(fails(() => listUiStrings(db, q("missing=la")), 409, "INVALID_STATE").body.details).toMatchObject({ reason: "bundle_not_synced" });
    expect(listUiStrings(db, q("limit=100")).data[0].locales.la.is_override).toBeNull();
  });

  it("put: ICU rules with field codes, unknown key 404, If-Match optional but checked when sent, no row + same as source = no_change", () => {
    const db = getMockDb();
    const put = (key: string, locale: string, body: unknown, ifMatch: string | null = null) => putUiString(db, key, locale, body, ifMatch);
    expect(errorsOf(fails(() => put("site.nav.currentPage", "en", { value: "Menu {page" }), 422))[0]).toMatchObject({ path: "/value", code: "icu_syntax" });
    expect(errorsOf(fails(() => put("site.nav.currentPage", "en", { value: "Page {n, plural, one {x}}" }), 422))[0]).toMatchObject({ code: "plural_other_missing" });
    const mismatch = errorsOf(fails(() => put("site.nav.currentPage", "en", { value: "Menu {pagina}" }), 422))[0];
    expect(mismatch).toMatchObject({ code: "placeholder_mismatch", params: { missing: ["page"], unexpected: ["pagina"] } });
    expect(errorsOf(fails(() => put("site.nav.currentPage", "en", { value: "" }), 422))[0].code).toBe("too_short");
    expect(errorsOf(fails(() => put("site.nav.currentPage", "en", { value: "x".repeat(2001).replace(/x/g, "a") }), 422))[0].code).toBe("too_long");
    fails(() => put("site.nav.currentPage", "en", { value: "ok {page}", extra: 1 }), 422);
    fails(() => put("no.such.key", "en", { value: "x" }), 404);
    fails(() => put("site.nav.currentPage", "xx", { value: "x {page}" }), 404);
    const src = find("site.nav.currentPage").locales.la.source!;
    const none = put("site.nav.closeMenu", "en", { value: "Close the menu" }); // closeMenu en already has a row with "Close menu": it is an override now
    expect(none.data.is_override).toBe(true);
    expect(none.data.no_change).toBe(false);
    expect(src).toBeTruthy();
    // the row of a known key in a language that has no row: same as source -> no row
    db.uiRows = db.uiRows.filter((r) => !(r.key === "site.nav.openMenu" && r.locale === "la"));
    const nc = put("site.nav.openMenu", "la", { value: find("site.nav.openMenu").locales.la.source! });
    expect(nc.data).toMatchObject({ no_change: true, value: null });
    expect(db.uiRows.some((r) => r.key === "site.nav.openMenu" && r.locale === "la")).toBe(false);
    // optional If-Match: when sent it must match
    const cell = find("site.nav.closeMenu").locales.en;
    fails(() => put("site.nav.closeMenu", "en", { value: "Shut" }, '"stale"'), 409, "CONFLICT_LOCK_VERSION");
    const ok = put("site.nav.closeMenu", "en", { value: "Close it", note: "n" }, cell.etag);
    expect(ok.data).toMatchObject({ is_override: true, value: "Close it", note: "n", is_new: false });
    expect(ok.etag).not.toBe(cell.etag);
  });

  it("put writes the before-image of the WHOLE key; delete restores the original (data null when there is no row); translate-only cannot delete", () => {
    const db = getMockDb();
    const before = db.revisions["ui-strings/blog.categories.all"]?.length ?? 0;
    putUiString(db, "blog.categories.all", "en", { value: "Everything" }, null);
    expect(db.revisions["ui-strings/blog.categories.all"]).toHaveLength(before + 1);
    expect(db.revisions["ui-strings/blog.categories.all"].at(-1)!.snapshot).toMatchObject({ key: "blog.categories.all", values: { la: "ທັງໝົດ", en: "All" } });
    expect(deleteUiString(db, "blog.categories.all", "en", null)).toMatchObject({ source: "All", effective: "All" });
    expect(deleteUiString(db, "blog.categories.all", "en", null)).toBeNull();
    expect(find("blog.categories.all").locales.en.value).toBeNull();
    db.translateOnly = ["ui-strings"];
    fails(() => deleteUiString(db, "blog.categories.all", "la", null), 403);
  });

  it("key-level restore: the ETag is the quoted number of the latest revision of the key (provisional contract)", () => {
    const db = getMockDb();
    const key = "site.nav.closeMenu";
    expect(uiStringKeyEtag(db, key)).toBe('"2"');
    const first = db.revisions[`ui-strings/${key}`][0];
    fails(() => restoreRevision(db, "ui-strings", key, String(first.id), undefined, null), 428);
    fails(() => restoreRevision(db, "ui-strings", key, String(first.id), undefined, '"1"'), 409, "CONFLICT_LOCK_VERSION");
    const r = restoreRevision(db, "ui-strings", key, String(first.id), undefined, '"2"');
    expect(r.etag).toBe('"3"');
    expect(find(key).locales.la.value).toBe("Close menu");
    expect(db.revisions[`ui-strings/${key}`].at(-1)).toMatchObject({ kind: "restore" });
    fails(() => listRevisions(db, "ui-strings", "no.such.key", q("")), 404);
  });

  it("bundle sync: dry run writes nothing; real sync inserts, updates non-overrides, keeps overrides, reports orphans and placeholder conflicts", () => {
    const db = getMockDb();
    const manifest = () => ({
      generated_at: "2026-10-28T02:00:00Z",
      source_commit: "a81c7d0",
      keys: db.manifests.at(-1)!.keys.map((k) => structuredClone(k)),
    });
    const m = manifest();
    m.keys.find((k) => k.key === "site.nav.openMenu")!.values.en = "Open the menu";           // non-override: follows the source
    m.keys.find((k) => k.key === "blog.index.listLabel")!.values.en = "Posts {n}";            // override whose placeholders now differ
    m.keys.push({ key: "site.cta.bookNow", namespace: "site", values: { la: "Book", en: "Book now" } });
    const dry = bundleSync(db, q("dry_run=true"), m);
    expect(dry).toMatchObject({ dry_run: true, counts: { keys: 40, inserted: 2, source_updated: 1, kept_override: 3 }, new_keys: ["site.cta.bookNow"], orphans: ["blog.index.oldTitle"], orphan_count: 1 });
    expect(dry.placeholder_conflicts).toEqual([{ key: "blog.index.listLabel", locale: "en", expected: ["n"], actual: [] }]);
    expect(db.manifests).toHaveLength(1);
    expect(db.uiRows.some((r) => r.key === "site.cta.bookNow")).toBe(false);
    const real = bundleSync(db, q(""), m);
    expect(real.manifest).toMatchObject({ version: 2, unchanged: false });
    expect(db.manifests).toHaveLength(2);
    expect(find("site.nav.openMenu").locales.en).toMatchObject({ value: "Open the menu", is_override: false });
    expect(find("blog.index.listLabel").locales.en.value).toBe("All blog posts"); // the override was kept
    expect(db.uiRows.some((r) => r.key === "blog.index.oldTitle")).toBe(true);   // orphans are kept
    // syncing the same manifest again changes nothing and keeps the version
    const twice = bundleSync(db, q(""), m);
    expect(twice.manifest).toMatchObject({ version: 2, unchanged: true });
    expect(twice.counts.inserted).toBe(0);
  });

  it("bundle sync validates the manifest (dup keys, namespace, ICU, unknown locale, unknown field) and is limited to 10 per hour", () => {
    const db = getMockDb();
    const base = { generated_at: "2026-10-28T02:00:00Z", source_commit: "abc" };
    const bad = fails(
      () =>
        bundleSync(db, q(""), {
          ...base,
          keys: [
            { key: "a.b", namespace: "a", values: { en: "x {" } },
            { key: "a.b", namespace: "z", values: { xx: "ok" } },
          ],
        }),
      422
    );
    expect(errorsOf(bad).map((e) => `${e.path}:${e.code}`)).toEqual(
      expect.arrayContaining(["/keys/0/values/en:icu_syntax", "/keys/1/key:duplicate", "/keys/1/namespace:pattern_mismatch", "/keys/1/values/xx:unknown_reference"])
    );
    fails(() => bundleSync(db, q("x=1"), { ...base, keys: [] }), 422);
    fails(() => bundleSync(db, q(""), { ...base, extra: 1, keys: [{ key: "a.b", namespace: "a", values: { en: "x" } }] }), 422);
    const ok = { ...base, keys: db.manifests[0].keys };
    for (let i = 0; i < 10; i++) bundleSync(db, q("dry_run=true"), ok);
    fails(() => bundleSync(db, q("dry_run=true"), ok), 429, "RATE_LIMITED");
  });
});

describe("categories and tags (05 11.5)", () => {
  const cat = (id: number) => getTaxonomyRow(getMockDb(), "categories", String(id));

  it("is seeded: five categories music..hiking with slug = key, no tags in the seed (three invented, one trashed)", () => {
    const db = getMockDb();
    const list = listTaxonomy(db, "categories", q(""));
    expect(list.data.map((c) => c.key)).toEqual(["music", "camping", "outdoor", "adventure", "hiking"]);
    expect(list.data[0].translations.en).toMatchObject({ name: "Music", slug: "music" });
    expect(list.data[0]).toMatchObject({ post_count: 1, published_post_count: 1 });
    expect(listTaxonomy(db, "tags", q("")).data.map((t) => t.key)).toEqual(["family", "night-sky", "trail"]);
    expect(listTaxonomy(db, "tags", q("trashed=true")).data.map((t) => t.key)).toEqual(["old-gear"]);
    fails(() => listTaxonomy(db, "tags", q("is_active=true")), 422);
    fails(() => listTaxonomy(db, "categories", q("unused=true")), 422);
    fails(() => listTaxonomy(db, "categories", q("sort=bogus")), 422);
  });

  it("create: key rules and duplicates (key and slug per language) are 422 / 409 CONFLICT_DUPLICATE with pointers", () => {
    const db = getMockDb();
    const t = { la: { name: "ປີນພູ" }, en: { name: "Climbing" } };
    expect(errorsOf(fails(() => createTaxonomy(db, "categories", { key: "Bad Key", translations: t }), 422))[0]).toMatchObject({ path: "/key", code: "pattern_mismatch" });
    expect(errorsOf(fails(() => createTaxonomy(db, "categories", { key: "ok", translations: { en: { name: "x" } } }), 422))[0]).toMatchObject({ path: "/translations/la/name", code: "required" });
    fails(() => createTaxonomy(db, "categories", { key: "ok", translations: t, bogus: 1 }), 422);
    expect(errorsOf(fails(() => createTaxonomy(db, "categories", { key: "music", translations: t }), 409, "CONFLICT_DUPLICATE"))[0]).toMatchObject({ path: "/key", code: "duplicate" });
    const slugClash = fails(() => createTaxonomy(db, "categories", { key: "fresh", translations: { la: { name: "A", slug: "camping" }, en: { name: "A" } } }), 409);
    expect(errorsOf(slugClash)[0]).toMatchObject({ path: "/translations/la/slug", code: "duplicate" });
    const made = createTaxonomy(db, "categories", { key: "climbing", translations: t });
    expect(made.data).toMatchObject({ sort_order: 6, is_active: true, translations: { la: { slug: "climbing" } } });
    // a row carries its ETag (UTC) and writes its timestamps in the server's offset, as the real server does
    expect(made.etag).toBe(made.data.etag);
    expect(made.data.updated_at).toMatch(/\+07:00$/);
  });

  it("patch: If-Match, key is immutable, translate-only cannot change the order / active flag / default slug, deleting the default language is refused", () => {
    const db = getMockDb();
    const c = cat(2);
    fails(() => patchTaxonomy(db, "categories", "2", { sort_order: 9 }, null), 428);
    fails(() => patchTaxonomy(db, "categories", "2", { sort_order: 9 }, '"stale"'), 409, "CONFLICT_LOCK_VERSION");
    expect(errorsOf(fails(() => patchTaxonomy(db, "categories", "2", { key: "x" }, c.etag), 422))[0].code).toBe("immutable");
    fails(() => patchTaxonomy(db, "categories", "2", {}, c.etag), 422);
    expect(errorsOf(fails(() => patchTaxonomy(db, "categories", "2", { translations: { la: null } }, c.etag), 422))[0].code).toBe("required");
    const r = patchTaxonomy(db, "categories", "2", { sort_order: 9, translations: { en: { name: "Camp" } } }, c.etag);
    expect(r.data).toMatchObject({ sort_order: 9, translations: { en: { name: "Camp", slug: "camping" } } });
    db.translateOnly = ["categories"];
    expect(patchTaxonomy(db, "categories", "2", { translations: { en: { name: "Camping" } } }, r.etag).data.translations.en.name).toBe("Camping");
    fails(() => patchTaxonomy(db, "categories", "2", { is_active: false }, cat(2).etag), 403);
    fails(() => patchTaxonomy(db, "categories", "2", { translations: { la: { name: "Camping", slug: "other" } } }, cat(2).etag), 403);
    expect(patchTaxonomy(db, "categories", "2", { translations: { en: { name: "Camping", slug: "camp-en" } } }, cat(2).etag).data.translations.en.slug).toBe("camp-en");
  });

  it("deactivating a category with published posts is allowed with category_in_use", () => {
    const db = getMockDb();
    const r = patchTaxonomy(db, "categories", "1", { is_active: false }, cat(1).etag);
    expect(r.data.warnings![0]).toMatchObject({ code: "category_in_use", params: { published_post_count: 1 } });
  });

  it("delete: ENTITY_REFERENCED while published / scheduled posts use it (draft posts do not block); soft delete frees the key; trashed rows are not patchable; restore detects duplicates", () => {
    const db = getMockDb();
    const e = fails(() => deleteTaxonomy(db, "categories", "1", cat(1).etag), 409, "ENTITY_REFERENCED");
    expect(e.body.details).toMatchObject({ total_references: 1, suggestion: "set_inactive", references: [{ entity_type: "cms.post", id: 1, field: "/category_id" }] });
    fails(() => deleteTaxonomy(db, "categories", "5", null), 428);
    deleteTaxonomy(db, "categories", "5", cat(5).etag); // hiking: used by a DRAFT post only
    expect(listTaxonomy(db, "categories", q("trashed=true")).data.map((c) => c.key)).toEqual(["hiking"]);
    const trashed = cat(5);
    expect(trashed.data.purge_at).toBeTruthy();
    fails(() => patchTaxonomy(db, "categories", "5", { is_active: false }, trashed.etag), 409, "INVALID_STATE");
    // the key is free again: a new "hiking" can be created, then the old one can not be restored
    createTaxonomy(db, "categories", { key: "hiking", translations: { la: { name: "Hiking" }, en: { name: "Hiking" } } });
    const dup = fails(() => restoreTaxonomyRow(db, "categories", "5", trashed.etag), 409, "CONFLICT_DUPLICATE");
    expect(errorsOf(dup).map((x) => x.path)).toEqual(expect.arrayContaining(["/key"]));
    fails(() => restoreTaxonomyRow(db, "categories", "2", cat(2).etag), 409, "INVALID_STATE");
    // tags: a tag used by the published post is protected too
    fails(() => deleteTaxonomy(db, "tags", "2", getTaxonomyRow(db, "tags", "2").etag), 409, "ENTITY_REFERENCED");
    deleteTaxonomy(db, "tags", "3", getTaxonomyRow(db, "tags", "3").etag);
    expect(restoreTaxonomyRow(db, "tags", "3", getTaxonomyRow(db, "tags", "3").etag).data.deleted_at).toBeNull();
  });

  it("revisions: a patch writes the before-image; restore applies it, takes a new revision and refuses duplicates", () => {
    const db = getMockDb();
    const before = listRevisions(db, "categories", "1", q("")).meta.total;
    const r = patchTaxonomy(db, "categories", "1", { translations: { en: { name: "Live music" } } }, cat(1).etag);
    const rows = listRevisions(db, "categories", "1", q("sort=-version"));
    expect(rows.meta.total).toBe(before + 1);
    expect(getRevision(db, "categories", "1", String(rows.data[0].id)).snapshot).toMatchObject({ category: { key: "music" }, translations: [{ locale_code: "la", name: "Music" }, { locale_code: "en", name: "Music" }] });
    const back = restoreRevision(db, "categories", "1", String(rows.data[0].id), undefined, r.etag);
    expect((back.data as unknown as { translations: { en: { name: string } } }).translations.en.name).toBe("Music");
    fails(() => restoreRevision(db, "categories", "1", String(rows.data[0].id), undefined, r.etag), 409, "CONFLICT_LOCK_VERSION");
  });
});
