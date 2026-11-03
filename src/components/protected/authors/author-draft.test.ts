import { describe, expect, it } from "vitest";

import { buildCreatePayload, buildUpdatePayload, draftFromAuthor, emptyAuthorDraft, isChanged, rowSnapshot, validate } from "@/components/protected/authors/author-draft";
import type { Author } from "@/types/authors";

const row: Author = {
  id: 1, public_id: "x", display_name: "Somchai", user_id: 4, user: { id: 4, name: "Somchai", username: "somchai" }, avatar_media_id: 7, avatar: null, is_active: true,
  translations: { la: { bio: "Lao bio", job_title: "Editor" }, en: { bio: null, job_title: "Editor in chief" } },
  post_count: 2, published_post_count: 1, created_at: "2026-11-03T10:00:00.000000+07:00", updated_at: "2026-11-03T10:00:00.000000+07:00", deleted_at: null, purge_at: null,
};
const LOCALES = ["la", "en"];

describe("author draft", () => {
  it("is built from a row, one entry per language", () => {
    const d = draftFromAuthor(row, LOCALES);
    expect(d).toMatchObject({ displayName: "Somchai", userId: 4, avatarId: 7, isActive: true });
    expect(d.translations).toEqual({ la: { bio: "Lao bio", jobTitle: "Editor" }, en: { bio: "", jobTitle: "Editor in chief" } });
    expect(isChanged(d, structuredClone(d))).toBe(false);
  });

  it("validates like the server: name 1-120, bio 2000, job title 120 (counted in characters, trimmed)", () => {
    const d = emptyAuthorDraft(LOCALES);
    expect(validate(d)).toEqual([{ in: "body", path: "/display_name", code: "required" }]);
    d.displayName = "   ";
    expect(validate(d)[0].code).toBe("required");
    d.displayName = "ນ".repeat(121);
    expect(validate(d)).toEqual([{ in: "body", path: "/display_name", code: "too_long", params: { max: 120 } }]);
    d.displayName = "ok";
    d.translations.en = { bio: "x".repeat(2001), jobTitle: "y".repeat(121) };
    expect(validate(d).map((e) => `${e.path}:${e.code}`)).toEqual(["/translations/en/bio:too_long", "/translations/en/job_title:too_long"]);
    d.translations.en = { bio: "x".repeat(2000), jobTitle: "  " + "y".repeat(120) + "  " };
    expect(validate(d)).toEqual([]);
  });

  it("create sends only filled languages and the optional links when set", () => {
    const d = emptyAuthorDraft(LOCALES);
    d.displayName = " Mali ";
    expect(buildCreatePayload(d)).toEqual({ display_name: "Mali", is_active: true });
    d.userId = 9;
    d.avatarId = 3;
    d.isActive = false;
    d.translations.la = { bio: " b ", jobTitle: "" };
    expect(buildCreatePayload(d)).toEqual({ display_name: "Mali", user_id: 9, avatar_media_id: 3, is_active: false, translations: { la: { bio: "b", job_title: null } } });
  });

  it("update sends only what changed; unlinking and clearing are null", () => {
    const saved = draftFromAuthor(row, LOCALES);
    const d = structuredClone(saved);
    expect(buildUpdatePayload(saved, d, "la")).toEqual({});
    d.displayName = "Somchai V.";
    d.userId = null;
    d.avatarId = null;
    d.isActive = false;
    d.translations.la.bio = "";
    d.translations.en.bio = "Hello";
    expect(buildUpdatePayload(saved, d, "la")).toEqual({
      display_name: "Somchai V.", user_id: null, avatar_media_id: null, is_active: false,
      translations: { la: { bio: null }, en: { bio: "Hello" } },
    });
  });

  it("translate-only sends the bio / job title of non-default languages and nothing else", () => {
    const saved = draftFromAuthor(row, LOCALES);
    const d = structuredClone(saved);
    d.displayName = "Hacked";
    d.isActive = false;
    d.translations.la.jobTitle = "Changed default";
    d.translations.en.jobTitle = "";
    expect(buildUpdatePayload(saved, d, "la", { translateOnly: true })).toEqual({ translations: { en: { job_title: null } } });
  });

  it("the snapshot of a row has the shape of a revision (05 15.4)", () => {
    expect(rowSnapshot(row)).toEqual({
      author: { display_name: "Somchai", user_id: 4, avatar_media_id: 7, is_active: true },
      translations: [{ locale_code: "la", bio: "Lao bio", job_title: "Editor" }, { locale_code: "en", bio: null, job_title: "Editor in chief" }],
    });
  });
});
