import { describe, expect, it } from "vitest";

import {
  buildMediaPayload,
  buildPostPatch,
  dateProblem,
  draftFromPost,
  draftsEqual,
  emptyLocaleDraft,
  galleryStructureChanged,
  postPointerFieldId,
  postPointerLocale,
  postPointerTab,
  validateDraft,
  type PostDraft,
} from "@/components/protected/posts/post-draft";
import { slugify } from "@/lib/posts";
import type { PostDetail } from "@/types/posts";

const post = (over: Partial<PostDetail> = {}): PostDetail =>
  ({
    id: 3,
    category: { id: 5, key: "hiking", name: "Hiking" },
    tag_ids: [1],
    tags: [{ id: 1, key: "trail", name: "Trail" }],
    hero_media_id: 5,
    teaser_media_id: null,
    is_featured: false,
    published_at: null,
    translations: {
      la: { slug: "notes", title: "Notes", excerpt: "Short", body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] } },
    },
    media: [
      { id: 11, media_id: 6, media: { id: 6, status: "ready" }, sort_order: 0, translations: { la: { alt: "A", caption: null } } },
      { id: 12, media_id: 7, media: { id: 7, status: "ready" }, sort_order: 1, translations: {} },
    ],
    ...over,
  }) as unknown as PostDetail;

const base = (): PostDraft => draftFromPost(post(), ["la", "en"]);

describe("slugify", () => {
  it("makes an ASCII slug: lower case, one hyphen between words, no hyphen at the ends, 100 characters at most", () => {
    expect(slugify("  Music Night — under the Stars! ")).toBe("music-night-under-the-stars");
    expect(slugify("Café déjà vu")).toBe("cafe-deja-vu");
    expect(slugify("ຄ່າຍພັກແຮມ")).toBe("");
    expect(slugify("a".repeat(150))).toHaveLength(100);
  });
});

describe("draftFromPost", () => {
  it("has a row for every active language (an empty one for a language the post lacks) and the gallery in order", () => {
    const d = base();
    expect(d.translations.la).toMatchObject({ exists: true, slug: "notes", title: "Notes", slugAuto: false });
    expect(d.translations.en).toMatchObject({ exists: false, slugAuto: true, title: "" });
    expect(d.gallery.map((r) => [r.key, r.id, r.media_id])).toEqual([["11", 11, 6], ["12", 12, 7]]);
    expect(d.gallery[0].translations.la).toEqual({ alt: "A", caption: "" });
    expect(d.category_id).toBe(5);
  });
});

describe("validateDraft", () => {
  it("needs a title in the default language, a valid slug, limits per field, at most 10 tags / 60 pictures", () => {
    const d = base();
    d.translations.la.title = "";
    d.translations.la.slug = "Bad Slug";
    d.translations.la.excerpt = "x".repeat(301);
    d.translations.la.label = "x".repeat(81);
    d.tag_ids = Array.from({ length: 11 }, (_, i) => i + 1);
    d.gallery[0].translations.la.alt = "x".repeat(251);
    const problems = validateDraft(d, "la");
    expect(problems).toMatchObject({
      "title.la": "required",
      "slug.la": "format",
      "excerpt.la": "too_long",
      "label.la": "too_long",
      tag_ids: "too_many",
      "gallery.11.alt.la": "too_long",
    });
    expect(validateDraft(base(), "la")).toEqual({});
  });

  it("another language: texts without a title are `title_required`; nothing at all is fine; ", () => {
    const d = base();
    d.translations.en.excerpt = "Hello";
    expect(validateDraft(d, "la")).toEqual({ "title.en": "title_required" });
    d.translations.en.title = "Notes";
    d.translations.en.slug = "notes-en";
    expect(validateDraft(d, "la")).toEqual({});
  });
});

describe("buildPostPatch", () => {
  it("sends only what changed, clears with null, and adds a new language with its title and slug", () => {
    const baseline = base();
    const d = structuredClone(baseline);
    expect(buildPostPatch(baseline, d, "la", "full", { galleryViaPut: false })).toBeNull();
    d.category_id = 2;
    d.tag_ids = [1, 3];
    d.translations.la.excerpt = "";
    d.translations.la.title = "Notes v2";
    d.translations.en = { ...emptyLocaleDraft(), title: "Notes", slug: "notes-en", excerpt: "Short" };
    d.is_featured = true;
    expect(buildPostPatch(baseline, d, "la", "full", { galleryViaPut: false })).toEqual({
      category_id: 2,
      tag_ids: [1, 3],
      is_featured: true,
      translations: { la: { title: "Notes v2", excerpt: null }, en: { title: "Notes", slug: "notes-en", excerpt: "Short" } },
    });
  });

  it("removes a non-default language whose title and texts were all cleared, never the default one", () => {
    const baseline = draftFromPost(post({ translations: { la: { slug: "notes", title: "Notes" }, en: { slug: "notes-en", title: "Notes", excerpt: "x" } } }), ["la", "en"]);
    const d = structuredClone(baseline);
    d.translations.en = { ...d.translations.en, title: "", excerpt: "", slug: "" };
    expect(buildPostPatch(baseline, d, "la", "full", { galleryViaPut: false })).toEqual({ translations: { en: null } });
  });

  it("the body is sent as the document, an emptied one as null", () => {
    const baseline = base();
    const d = structuredClone(baseline);
    d.translations.la.body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "New" }] }] };
    expect(buildPostPatch(baseline, d, "la", "full", { galleryViaPut: false })!.translations!.la!.body).toEqual(d.translations.la.body);
    d.translations.la.body = null;
    expect(buildPostPatch(baseline, d, "la", "full", { galleryViaPut: false })!.translations!.la!.body).toBeNull();
  });

  it("alt / caption of existing rows ride with the PATCH as media_translations - unless the gallery goes in one PUT", () => {
    const baseline = base();
    const d = structuredClone(baseline);
    d.gallery[1].translations = { la: { alt: "B", caption: "Cap" } };
    expect(buildPostPatch(baseline, d, "la", "full", { galleryViaPut: false })).toEqual({ media_translations: { 12: { la: { alt: "B", caption: "Cap" } } } });
    expect(buildPostPatch(baseline, d, "la", "full", { galleryViaPut: true })).toBeNull();
  });

  it("translate mode leaves out the default language, the shared fields, is_enabled, the share image and the default alt / caption", () => {
    const baseline = base();
    const d = structuredClone(baseline);
    d.category_id = 2;
    d.translations.la.title = "Nope";
    d.gallery[0].translations.la = { alt: "Nope", caption: "" };
    d.gallery[0].translations.en = { alt: "Yes", caption: "" };
    d.translations.en = { ...emptyLocaleDraft(), title: "Notes", slug: "notes-en", og_image_id: 4, is_enabled: false };
    expect(buildPostPatch(baseline, d, "la", "translate", { galleryViaPut: false })).toEqual({
      translations: { en: { title: "Notes", slug: "notes-en" } },
      media_translations: { 11: { en: { alt: "Yes" } } },
    });
  });
});

describe("gallery", () => {
  it("a structure change is a different order, set or picture; texts alone are not", () => {
    const baseline = base();
    const same = structuredClone(baseline);
    same.gallery[0].translations.la.alt = "Changed";
    expect(galleryStructureChanged(baseline, same)).toBe(false);
    const moved = structuredClone(baseline);
    moved.gallery.reverse();
    expect(galleryStructureChanged(baseline, moved)).toBe(true);
    const added = structuredClone(baseline);
    added.gallery.push({ key: "new-1", id: null, media_id: 9, media: { id: 9, status: "ready" }, translations: {} });
    expect(galleryStructureChanged(baseline, added)).toBe(true);
    expect(galleryStructureChanged(baseline, { ...baseline, gallery: baseline.gallery.slice(1) })).toBe(true);
  });

  it("the PUT body keeps the ids of existing rows, omits the id of new ones and sends the texts of every language", () => {
    const d = base();
    d.gallery[0].translations = { la: { alt: "A", caption: "" }, en: { alt: "", caption: "Cap" }, th: { alt: "", caption: "" } };
    d.gallery.push({ key: "new-1", id: null, media_id: 9, media: { id: 9, status: "ready" }, translations: {} });
    expect(buildMediaPayload(d)).toEqual([
      { id: 11, media_id: 6, translations: { la: { alt: "A", caption: null }, en: { alt: null, caption: "Cap" } } },
      { id: 12, media_id: 7, translations: {} },
      { media_id: 9, translations: {} },
    ]);
  });
});

describe("pointers", () => {
  it("name the tab, the language and the DOM id of a field", () => {
    expect(postPointerTab("/category_id")).toBe("details");
    expect(postPointerTab("/tag_ids/2")).toBe("details");
    expect(postPointerTab("/translations/la/seo_title")).toBe("seo");
    expect(postPointerTab("/translations/en/slug")).toBe("content");
    expect(postPointerTab("/hero_media_id")).toBe("content");
    expect(postPointerTab("/media/12/media_id")).toBe("content");
    expect(postPointerTab("/media_translations/12/en/alt")).toBe("content");
    expect(postPointerTab("/bogus")).toBeNull();
    expect(postPointerLocale("/translations/en/slug")).toBe("en");
    expect(postPointerLocale("/category_id")).toBeUndefined();
    expect(postPointerFieldId("/translations/en/slug")).toBe("post-field-slug-en");
    expect(postPointerFieldId("/translations/la/body/content/1/attrs/media_id")).toBe("post-field-body-la");
    expect(postPointerFieldId("/hero_media_id")).toBe("post-field-hero_media_id");
    expect(postPointerFieldId("/media/12/media_id", ["11", "12"])).toBe("post-gallery-item-12");
    expect(postPointerFieldId("/media/99/media_id", ["11", "12"])).toBe("post-field-gallery");
    expect(postPointerFieldId("/tag_ids/0")).toBe("post-field-tag_ids");
  });
});

describe("dateProblem", () => {
  it("refuses the future, and a missing date on a published post", () => {
    expect(dateProblem(new Date(Date.now() + 86_400_000).toISOString(), false)).toBe("future");
    expect(dateProblem("2026-09-01T00:00:00Z", true)).toBeNull();
    expect(dateProblem(null, true)).toBe("required");
    expect(dateProblem(null, false)).toBeNull();
  });
});

describe("draftsEqual", () => {
  it("compares by content", () => {
    expect(draftsEqual(base(), base())).toBe(true);
    const d = base();
    d.is_featured = true;
    expect(draftsEqual(base(), d)).toBe(false);
  });
});
