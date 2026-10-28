import { describe, expect, it } from "vitest";

import { getMockDb, resetMockDb } from "@/mocks/mock-db";
import { detailOf } from "@/mocks/mock-pages";

import { buildPatch, draftFromPage, emptyLocaleDraft, pagePointerFieldId, pagePointerTab, pathChangesPublished, validateFields } from "./page-fields";

const page = (id: number) => {
  resetMockDb();
  const db = getMockDb();
  return detailOf(db, db.pages.find((p) => p.id === id)!);
};
const LOCALES = ["la", "en"];

describe("page fields draft", () => {
  it("is built from the page, with an empty row for a language the page does not have", () => {
    const p = page(6);
    p.translations = { la: p.translations.la };
    const d = draftFromPage(p, LOCALES);
    expect(d.translations.la).toMatchObject({ exists: true, title: "Spring campaign" });
    expect(d.translations.en).toEqual(emptyLocaleDraft());
    expect(d.sort_order).toBe(String(p.sort_order));
  });

  it("an unchanged draft builds no patch; a change builds only that field", () => {
    const base = draftFromPage(page(8), LOCALES);
    expect(buildPatch(base, structuredClone(base), "la")).toBeNull();
    const next = structuredClone(base);
    next.noindex = true;
    next.translations.en.seo_title = "  A new SEO title ";
    expect(buildPatch(base, next, "la")).toEqual({ noindex: true, translations: { en: { seo_title: "A new SEO title" } } });
  });

  it("adds a language with its filled fields, removes one whose texts were all cleared, never the default", () => {
    const p = page(8);
    p.translations = { la: p.translations.la };
    const base = draftFromPage(p, LOCALES);
    const added = structuredClone(base);
    added.translations.en = { ...added.translations.en, title: "Summer", seo_title: "Summer trek", is_enabled: false };
    expect(buildPatch(base, added, "la")).toEqual({ translations: { en: { title: "Summer", seo_title: "Summer trek", is_enabled: false } } });

    const full = draftFromPage(page(8), LOCALES);
    const cleared = structuredClone(full);
    cleared.translations.en = { ...emptyLocaleDraft(), exists: true };
    expect(buildPatch(full, cleared, "la")).toEqual({ translations: { en: null } });
    const clearedDefault = structuredClone(full);
    clearedDefault.translations.la.title = "";
    expect(validateFields(clearedDefault, full, "la")["title.la"]).toBe("required");
  });

  it("empty SEO text is sent as null", () => {
    const base = draftFromPage(page(9), LOCALES);
    const next = structuredClone(base);
    next.translations.en.seo_description = "  ";
    expect(buildPatch(base, next, "la")).toEqual({ translations: { en: { seo_description: null } } });
  });

  it("validates the name, the address (only when changed), the order, lengths and the canonical address", () => {
    const base = draftFromPage(page(1), LOCALES);
    expect(validateFields(base, base, "la")).toEqual({});
    const bad = structuredClone(base);
    bad.name = " ";
    bad.path = "/admin/x";
    bad.sort_order = "-1";
    bad.translations.en.seo_title = "x".repeat(121);
    bad.translations.en.seo_description = "x".repeat(321);
    bad.translations.en.canonical_path = "no-slash";
    expect(validateFields(bad, base, "la")).toEqual({
      name: "required",
      path: "reserved",
      sort_order: "negative",
      "seo_title.en": "too_long",
      "seo_description.en": "too_long",
      "canonical_path.en": "format",
    });
  });

  it("SEO text in a language without a title needs the title", () => {
    const p = page(8);
    p.translations = { la: p.translations.la };
    const base = draftFromPage(p, LOCALES);
    const next = structuredClone(base);
    next.translations.en.seo_title = "Only SEO";
    expect(validateFields(next, base, "la")["title.en"]).toBe("title_required");
  });

  it("warns about a changed address only for a page that was published before", () => {
    expect(pathChangesPublished({ first_published_at: "2026-10-26T00:00:00Z" }, "/a", "/b")).toBe(true);
    expect(pathChangesPublished({ first_published_at: "2026-10-26T00:00:00Z" }, "/a", "/a")).toBe(false);
    expect(pathChangesPublished({ first_published_at: null }, "/a", "/b")).toBe(false);
  });

  it("maps a pointer to its tab and its input", () => {
    expect(pagePointerTab("/translations/en/seo_title")).toBe("seo");
    expect(pagePointerTab("/translations/la/title")).toBe("details");
    expect(pagePointerTab("/path")).toBe("details");
    expect(pagePointerTab("/noindex")).toBe("seo");
    expect(pagePointerTab("/sections")).toBeNull();
    expect(pagePointerFieldId("/translations/en/seo_title")).toBe("page-field-seo_title-en");
    expect(pagePointerFieldId("/path")).toBe("page-field-path");
  });
});
