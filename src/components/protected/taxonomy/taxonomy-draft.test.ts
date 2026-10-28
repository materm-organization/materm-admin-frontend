import { describe, expect, it } from "vitest";

import { buildCreatePayload, buildUpdatePayload, draftFromRow, emptyTaxonomyDraft, isChanged, validate } from "@/components/protected/taxonomy/taxonomy-draft";
import { getMockDb, resetMockDb } from "@/mocks/mock-db";

const codes = ["la", "en"];

describe("taxonomy draft", () => {
  it("create payload: only languages with a name; category carries order / active", () => {
    const d = emptyTaxonomyDraft(codes, 6);
    d.key = "climbing";
    d.translations.la.name = "ປີນພູ";
    d.translations.la.description = " Rock ";
    expect(buildCreatePayload("categories", d)).toEqual({ key: "climbing", is_active: true, sort_order: 6, translations: { la: { name: "ປີນພູ", description: "Rock" } } });
    expect(buildCreatePayload("tags", d)).toEqual({ key: "climbing", translations: { la: { name: "ປີນພູ" } } });
  });

  it("update payload: changed languages only; a non-default language with an emptied name is deleted; translate-only skips order / active", () => {
    resetMockDb();
    const row = getMockDb().categories[0];
    const saved = draftFromRow(row, codes);
    expect(isChanged(saved, structuredClone(saved), "categories")).toBe(false);
    const d = structuredClone(saved);
    d.translations.en.name = "";
    d.sortOrder = "9";
    d.isActive = false;
    expect(buildUpdatePayload("categories", saved, d, "la")).toEqual({ sort_order: 9, is_active: false, translations: { en: null } });
    expect(buildUpdatePayload("categories", saved, d, "la", { translateOnly: true })).toEqual({ translations: { en: null } });
    d.translations.la.name = "Music!";
    expect(buildUpdatePayload("categories", saved, d, "la", { translateOnly: true }).translations!.la).toMatchObject({ name: "Music!", slug: "music" });
  });

  it("validation: key patterns (only when creating), default-language name, slug pattern, lengths", () => {
    const d = emptyTaxonomyDraft(codes, 1);
    d.key = "Bad Key";
    d.translations.en.slug = "Not A Slug";
    d.translations.en.name = "x".repeat(61);
    expect(validate("categories", d, "la", "create").map((e) => `${e.path}:${e.code}`)).toEqual([
      "/key:pattern_mismatch",
      "/translations/la/name:required",
      "/translations/en/name:too_long",
      "/translations/en/slug:pattern_mismatch",
    ]);
    expect(validate("categories", d, "la", "edit").some((e) => e.path === "/key")).toBe(false);
    d.key = "-bad";
    expect(validate("tags", d, "la", "create")[0]).toMatchObject({ path: "/key", code: "pattern_mismatch" });
    d.key = "1tag";
    expect(validate("tags", d, "la", "create").some((e) => e.path === "/key")).toBe(false);
    expect(validate("categories", d, "la", "create").some((e) => e.path === "/key")).toBe(true); // a category key starts with a letter
  });
});
