// In-memory model of the pages endpoints, the publish engine and the revisions of a publishable entity (doc/05
// sections 12.2 - 12.8; shapes: doc/api/openapi-admin.yaml PageListItem, PageDetail, PageWriteResult, PublishResult,
// PublishBlockedError, PageReferences, PageTemplate, PageRevisionSummary ...). Built for T1.4.7 while the backend
// (T1.4.1 / T1.4.2) is written in parallel, in the same spirit as the media / save-live models: STRICT. Unknown query
// parameters and body fields are 422 `unknown_field`, a write without `If-Match` is 428, a stale one 409
// `CONFLICT_LOCK_VERSION`, a command in a state it does not fit is 409 `INVALID_STATE` with `details.reason`.
//
// What it models (05 12.2.2): a page that is not published is written in place; a published page keeps its live rows
// untouched and every write goes to ONE `kind = "draft"` row in `db.revisions["pages/<id>"]`. ETag = `"<lock_version>"`.
// Publish computes its blockers from the page state (empty default-language text, a trashed page or media that does not
// exist, an unpublished album, no visible hero, a missing required section) and its warnings (a link to an unpublished
// page, an incomplete other language, a hidden section that would block).
//
// Changed after 05 12.7 was written (decided 2026-10-28, follows the task, not the older text): UNPUBLISH never fails
// because of the draft - the draft becomes a `history` row (`change_note: "unpublish"`), the live rows stay as they
// were, and the answer carries the warning `draft_kept_as_history`; DISCARD-DRAFT turns the draft into a `history` row
// (`change_note: "discarded"`), it is not deleted.
//
// INVENTED (marked in the seed): pages 6 - 10, the history of page 9, the albums, and the section ids.
import { computeCompleteness } from "@/components/schema-form/completeness";
import { walkSchemaValue } from "@/components/schema-form/schema-walker";
import { SECTION_TYPE_FIXTURES } from "@/components/schema-form/fixtures";
import pageBlog from "@/components/schema-form/fixtures/examples/page.blog.json";
import pageContact from "@/components/schema-form/fixtures/examples/page.contact.json";
import pageGallery from "@/components/schema-form/fixtures/examples/page.gallery.json";
import pageHome from "@/components/schema-form/fixtures/examples/page.home.json";
import pageOurPath from "@/components/schema-form/fixtures/examples/page.our-path.json";
import {
  DEFAULT_LOCALE_CODE,
  MOCK_ACTIVE_LOCALE_CODES,
  MOCK_LOCALE_CODES,
  MOCK_USER,
  boolParam,
  duplicate,
  etagOf,
  forbidden,
  fail,
  invalidState,
  keyOf,
  micros,
  notFound,
  paginate,
  preconditionRequired,
  lockConflict,
  pushRevision,
  rejectUnknown,
  tick,
  validationFailed,
  type MockDb,
  type MockPageRoot,
  type MockPageSnapshot,
  type MockSnapshotSection,
  type MockSnapshotTranslation,
  type Params,
  type StoredRevision,
} from "@/mocks/mock-core";
import type { ApiFieldError } from "@/types/api";
import type { UserRef } from "@/types/media";
import type {
  PageDetail,
  PageListItem,
  PageReference,
  PageTemplate,
  PageTranslationStatus,
  SectionSummary,
} from "@/types/pages";
import { autoRedirectWarnings, type PathMove } from "@/mocks/mock-auto-redirects";
import { sharedHasDraft, sharedIsLive, sharedRefBlock, sharedRow, sharedState, sharedWorking } from "@/mocks/mock-shared-core";
import type { AggregateStamp, PublishIssue } from "@/types/publishing";
import type { RevisionSummary } from "@/types/revisions";
import type { SaveLiveWarning } from "@/types/media";

const PAGE_PATH = /^\/([a-z0-9-]+(\/[a-z0-9-]+)*)?$/;
const RESERVED_PATH = /^\/(api|_next|admin|preview)(\/|$)/;
const KEY_PATTERN = /^[a-z][a-z0-9_-]{0,59}$/;
const TRASH_DAYS = 30;
const MAX_ISSUES = 100;
const TRANSLATION_FIELDS = ["title", "seo_title", "seo_title_absolute", "seo_description", "og_image_id", "canonical_path", "is_enabled"] as const;
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

const SEED_AT = micros(Date.UTC(2026, 9, 26, 9, 0, 0), 150);
const sectionPublicId = (id: number) => `0192d3a4-7c1e-7b52-9d0a-3f5e2a1b5${String(id).padStart(3, "0")}`;
const pagePublicId = (id: number) => `0192d3a4-7c1e-7b52-9d0a-3f5e2a1b4a${String(id).padStart(2, "0")}`;

// ---------------------------------------------------------------------------------------------------------------
// Templates (05 12.4): a registry. `initial_sections` is the [proposal] of the spec.
// ---------------------------------------------------------------------------------------------------------------
const HERO_KEYS = ["hero_brand", "hero_article"] as const;
const TEMPLATE_DEFS: Array<{
  key: string;
  name: string;
  description: string;
  allowed: string[];
  required: PageTemplate["required"];
  initial: Array<{ section_type_key: string; variant: string | null }>;
}> = [
  {
    key: "home",
    name: "Home",
    description: "Hero, teaser, blog strip and gallery cards. Used by the home page.",
    allowed: ["hero_brand", "teaser_collage", "intro_heading", "intro_text", "blog_strip", "gallery_cards", "about_blocks"],
    required: [{ kind: "group", group: "hero", section_type_keys: [...HERO_KEYS], min: 1, max: 1, position: "first" }],
    initial: [{ section_type_key: "hero_brand", variant: null }],
  },
  {
    key: "standard",
    name: "Standard",
    description: "A hero and any sections you add. The default for new pages.",
    allowed: Object.keys(SECTION_TYPE_FIXTURES).filter((k) => k !== "post_list" && k !== "contact_section"),
    required: [{ kind: "group", group: "hero", section_type_keys: [...HERO_KEYS], min: 1, max: 1, position: "first" }],
    initial: [{ section_type_key: "hero_brand", variant: null }],
  },
  {
    key: "blog_index",
    name: "Blog index",
    description: "Hero and the list of posts.",
    allowed: ["hero_article", "intro_text", "post_list", "blog_strip"],
    required: [
      { kind: "group", group: "hero", section_type_keys: [...HERO_KEYS], min: 1, max: 1, position: "first" },
      { kind: "type", group: null, section_type_keys: ["post_list"], min: 1, max: 1, position: "after_hero" },
    ],
    initial: [{ section_type_key: "hero_article", variant: null }, { section_type_key: "post_list", variant: null }],
  },
  {
    key: "contact",
    name: "Contact",
    description: "Hero, contact details with the form, optional FAQ.",
    allowed: ["hero_brand", "contact_section", "faq", "intro_text"],
    required: [
      { kind: "group", group: "hero", section_type_keys: [...HERO_KEYS], min: 1, max: 1, position: "first" },
      { kind: "type", group: null, section_type_keys: ["contact_section"], min: 1, max: 1, position: "after_hero" },
    ],
    initial: [{ section_type_key: "hero_brand", variant: null }, { section_type_key: "contact_section", variant: null }],
  },
];

export function listTemplates(db: MockDb): PageTemplate[] {
  return TEMPLATE_DEFS.map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    is_default: t.key === "standard",
    allowed_sections: t.allowed.map((key) => ({
      section_type_key: key,
      name: SECTION_TYPE_FIXTURES[key]?.name ?? key,
      is_active: true,
      code_registered: true,
      required: t.required.some((r) => r.kind === "type" && r.section_type_keys.includes(key)),
      max_per_page: (HERO_KEYS as readonly string[]).includes(key) || key === "post_list" || key === "contact_section" ? 1 : null,
      position: (HERO_KEYS as readonly string[]).includes(key) ? ("first" as const) : t.required.some((r) => r.section_type_keys.includes(key)) ? ("after_hero" as const) : ("any" as const),
      group: (HERO_KEYS as readonly string[]).includes(key) ? "hero" : null,
    })),
    required: t.required,
    initial_sections: t.initial,
    page_count: db.pages.filter((p) => !p.deleted_at && working(db, p).page.template === t.key).length,
  }));
}

// `GET /page-templates`: no parameters at all (anything else is a 422).
export function getTemplates(db: MockDb, params: Params) {
  rejectUnknown(params, []);
  return listTemplates(db);
}

// ---------------------------------------------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------------------------------------------
type Example = { page: Record<string, unknown>; translations: unknown; sections: Array<Record<string, unknown>> };

function sectionsOf(db: Pick<MockDb, "nextSectionId">, list: Array<Partial<MockSnapshotSection> & { section_type: string; props: Record<string, unknown> }>): MockSnapshotSection[] {
  return list.map((s, i) => {
    const id = db.nextSectionId++;
    return {
      id,
      public_id: sectionPublicId(id),
      section_type: s.section_type,
      section_version: 1,
      variant: s.variant ?? null,
      sort_order: i,
      is_visible: s.is_visible ?? true,
      anchor_id: s.anchor_id ?? null,
      props: s.props,
      shared_section_id: null,
    };
  });
}

function translation(locale: string, title: string, rest: Partial<MockSnapshotTranslation> = {}): MockSnapshotTranslation {
  return { locale_code: locale, title, seo_title: null, seo_title_absolute: false, seo_description: null, og_image_id: null, canonical_path: null, is_enabled: true, ...rest };
}

const text = (la: string, en: string | null = la) => (en === null ? { la } : { la, en });

function heroProps(title: { la?: string; en?: string }, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { title, background: { media_id: 1, decorative: true }, show_logo: true, animate_in: true, ...extra };
}

export function seedPages(db: Pick<MockDb, "nextSectionId">): MockPageRoot[] {
  const fromExample = (file: unknown): MockPageRoot => {
    const ex = file as Example;
    const p = ex.page as { id: number; key: string; name: string; template: string; path: string; is_home: boolean; is_system: boolean; noindex: boolean; in_sitemap: boolean };
    return {
      id: p.id,
      public_id: pagePublicId(p.id),
      is_system: p.is_system,
      status: "published",
      lock_version: 1,
      published_at: SEED_AT,
      first_published_at: SEED_AT,
      unpublished_at: null,
      created_by: null,
      updated_by: null,
      created_at: SEED_AT,
      updated_at: SEED_AT,
      deleted_at: null,
      live: {
        page: { key: p.key, name: p.name, template: p.template, path: p.path, parent_id: null, is_home: p.is_home, noindex: p.noindex, in_sitemap: p.in_sitemap, sort_order: p.id * 10 },
        translations: structuredClone(ex.translations) as MockSnapshotTranslation[],
        sections: sectionsOf(db, structuredClone(ex.sections) as Array<Partial<MockSnapshotSection> & { section_type: string; props: Record<string, unknown> }>),
      },
    };
  };
  const base = (id: number, key: string, name: string, template: string, path: string, status: MockPageRoot["status"], extra: Partial<MockPageRoot> = {}): MockPageRoot => ({
    id,
    public_id: pagePublicId(id),
    is_system: false,
    status,
    lock_version: 1,
    published_at: status === "published" ? micros(Date.UTC(2026, 9, 22, 9, 0, 0), 200 + id) : null,
    first_published_at: status === "published" || status === "archived" ? micros(Date.UTC(2026, 9, 22, 9, 0, 0), 200 + id) : null,
    unpublished_at: null,
    created_by: MOCK_USER,
    updated_by: MOCK_USER,
    created_at: micros(Date.UTC(2026, 9, 21, 9, 0, 0), 200 + id),
    updated_at: micros(Date.UTC(2026, 9, 22, 9, 0, 0), 200 + id),
    deleted_at: null,
    live: {
      page: { key, name, template, path, parent_id: null, is_home: false, noindex: false, in_sitemap: true, sort_order: id * 10 },
      translations: [],
      sections: [],
    },
    ...extra,
  });

  const pages = [pageHome, pageOurPath, pageBlog, pageGallery, pageContact].map(fromExample);
  // The home page keeps what the example says; the rest of the ids 1 - 5 are the 5 system pages of the seed (BR-18).

  // INVENTED. 6: a draft page that cannot be published (empty default-language title and SEO title, a link to the
  // trashed page 7, an unpublished album, a hidden section that would block too) - every kind of blocker once.
  const spring = base(6, "spring", "Spring campaign (draft)", "standard", "/spring", "draft");
  spring.live.translations = [
    translation("la", "Spring campaign", { seo_title: null }),
    translation("en", "Spring campaign", { seo_title: "Spring campaign", seo_description: "Trails and tents, March to May." }),
  ];
  spring.live.sections = sectionsOf(db, [
    { section_type: "hero_brand", variant: "normal", props: heroProps({ en: "Spring is here" }, { cta: { label: text("Read about it", "Read about it"), link: { type: "page", page_id: 7 } } }) },
    { section_type: "photo_story", props: { accessible_heading: text("Spring photo story"), album_id: 2, rows: [] } },
    { section_type: "intro_text", is_visible: false, props: { text: {} } },
  ]);
  // 7: the trashed page of the menu seed.
  const promo = base(7, "old-promo", "Old promo", "standard", "/old-promo", "archived", {
    deleted_at: micros(Date.UTC(2026, 9, 20, 9, 0, 0), 207),
    unpublished_at: micros(Date.UTC(2026, 9, 20, 9, 0, 0), 207),
  });
  promo.live.translations = [translation("la", "Old promo", { seo_title: "Old promo" }), translation("en", "Old promo", { seo_title: "Old promo" })];
  promo.live.sections = sectionsOf(db, [{ section_type: "hero_brand", props: heroProps(text("Old promo")) }]);
  // 8: a draft that publishes (with warnings: it links to the draft page 6, English SEO title missing).
  const summer = base(8, "summer", "Summer trek", "standard", "/summer", "draft");
  summer.live.translations = [
    translation("la", "Summer trek", { seo_title: "Summer trek", seo_description: "Three days on the Phou Khao Khouay ridge." }),
    translation("en", "Summer trek"),
  ];
  summer.live.sections = sectionsOf(db, [
    { section_type: "hero_brand", variant: "normal", props: heroProps(text("Summer trek"), { cta: { label: text("Plan it"), link: { type: "page", page_id: 6 } } }) },
    { section_type: "intro_text", props: { text: { la: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Three days, one ridge." }] }] }, en: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Three days, one ridge." }] }] } } } },
  ]);
  // 9: a published page with a pending draft (new title and one more section) - discard, publish changes, unpublish.
  const events = base(9, "events", "Events", "standard", "/events", "published");
  events.live.translations = [
    translation("la", "Events", { seo_title: "Events", seo_description: "Music nights and treks." }),
    translation("en", "Events", { seo_title: "Events", seo_description: "Music nights and treks." }),
  ];
  events.live.sections = sectionsOf(db, [
    { section_type: "hero_brand", variant: "normal", props: heroProps(text("Events")) },
    { section_type: "intro_heading", props: { eyebrow: text("Events"), title: text("What is on") } },
  ]);
  // 10: a published page that links to page 9 (so 9 is "referenced": delete / unpublish ask for a confirmation).
  const team = base(10, "team", "Team", "standard", "/team", "published");
  team.live.translations = [
    translation("la", "Team", { seo_title: "Team", seo_description: "The people behind Materm." }),
    translation("en", "Team", { seo_title: "Team", seo_description: "The people behind Materm." }),
  ];
  team.live.sections = sectionsOf(db, [
    { section_type: "hero_brand", variant: "normal", props: heroProps(text("Team"), { cta: { label: text("See the events"), link: { type: "page", page_id: 9 } } }) },
  ]);
  return [...pages, spring, promo, summer, events, team];
}

// The albums moved to `mock-albums.ts` (T1.5.6): albums 1 (published) and 2 (draft) are still the two the pages here name.

// The history the screens open. Page 9 has every kind of row (published, history, a hidden preview row, a draft).
export function seedPageRevisions(db: MockDb) {
  const who = (id: number, name: string): UserRef => ({ id, name });
  const base = Date.UTC(2026, 9, 21, 8, 0, 0);
  for (const page of db.pages.filter((p) => p.status === "published")) {
    pushRevision(db, "pages", page.id, "cms.pages", "published", structuredClone(page.live), null, page.published_at ?? SEED_AT, page.created_by ?? who(4, "Somchai Vongsa"));
  }
  const events = db.pages.find((p) => p.id === 9)!;
  // v1 published (already there), v2 history (a checkpoint before an edit), v3 published (the re-publish of the
  // current live rows), v4 a preview row, v5 the draft.
  const v1 = db.revisions[keyOf("pages", 9)][0];
  const old = structuredClone(events.live);
  old.translations[0].title = "Events (old)";
  old.sections = old.sections.slice(0, 1);
  v1.snapshot = old as unknown as Record<string, unknown>;
  pushRevision(db, "pages", 9, "cms.pages", "history", structuredClone(old), "autosave", micros(base + 3_600_000), who(6, "Noy Keomany"));
  pushRevision(db, "pages", 9, "cms.pages", "published", structuredClone(events.live), "added the intro", micros(base + 7_200_000), who(4, "Somchai Vongsa"));
  pushRevision(db, "pages", 9, "cms.pages", "history", structuredClone(events.live), "preview", micros(base + 9_000_000), who(6, "Noy Keomany"));
  const draft = structuredClone(events.live);
  draft.translations[0].title = "Events and treks";
  draft.translations[1].title = "Events and treks";
  draft.sections.push(...sectionsOf(db, [{ section_type: "intro_text", props: { text: { la: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "New dates every month." }] }] }, en: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "New dates every month." }] }] } } } }]).map((s, i) => ({ ...s, sort_order: draft.sections.length + i })));
  pushRevision(db, "pages", 9, "cms.pages", "draft", draft as unknown as Record<string, unknown>, null, micros(base + 10_800_000), who(6, "Noy Keomany"));
  events.lock_version = 4;
  events.updated_at = micros(base + 10_800_000, 11);
  events.updated_by = who(6, "Noy Keomany");
  // Page 1 has a little history too (a checkpoint and a restore), so the tab is not just one row.
  const home = db.pages.find((p) => p.id === 1)!;
  const earlier = structuredClone(home.live);
  earlier.translations[0].seo_title = "Materm - the wild within";
  pushRevision(db, "pages", 1, "cms.pages", "history", earlier as unknown as Record<string, unknown>, null, micros(base + 1_000_000), who(4, "Somchai Vongsa"));
  pushRevision(db, "pages", 1, "cms.pages", "restore", structuredClone(home.live), "restore of v1", micros(base + 2_000_000), who(4, "Somchai Vongsa"));
  // A snapshot written by a newer schema: restoring it is refused (`snapshot_incompatible`).
  pushRevision(db, "pages", 1, "cms.pages", "history", { future: true }, null, micros(base + 2_500_000), null, 99, 1);
}

// ---------------------------------------------------------------------------------------------------------------
// Working copy and views
// ---------------------------------------------------------------------------------------------------------------
const revList = (db: MockDb, root: MockPageRoot) => (db.revisions[keyOf("pages", root.id)] ??= []);
export const draftRowOf = (db: MockDb, root: MockPageRoot): StoredRevision | undefined => revList(db, root).find((r) => r.kind === "draft");
export function working(db: MockDb, root: MockPageRoot): MockPageSnapshot {
  return (draftRowOf(db, root)?.snapshot as unknown as MockPageSnapshot | undefined) ?? root.live;
}
const hasDraft = (db: MockDb, root: MockPageRoot) => root.status === "published" && Boolean(draftRowOf(db, root));
export const isTrashed = (root: MockPageRoot) => root.deleted_at !== null;
const etagOfPage = (root: MockPageRoot) => etagOf(String(root.lock_version));

// Name / path / title of a page as the menus show it (the live rows).
export const pageName = (root: MockPageRoot) => root.live.page.name;
export const pagePath = (root: MockPageRoot) => root.live.page.path;
export const pageTitle = (root: MockPageRoot, locale = DEFAULT_LOCALE_CODE) =>
  root.live.translations.find((t) => t.locale_code === locale)?.title ?? root.live.page.name;

function titleOf(snapshot: MockPageSnapshot, locale: string): { title: string | null; locale: string | null } {
  const chain = [locale, DEFAULT_LOCALE_CODE, ...snapshot.translations.map((t) => t.locale_code)];
  for (const code of chain) {
    const t = snapshot.translations.find((x) => x.locale_code === code && x.title.trim() !== "");
    if (t) return { title: t.title, locale: code };
  }
  return { title: null, locale: null };
}

const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === "";

function translationStatus(snapshot: MockPageSnapshot): Record<string, PageTranslationStatus> {
  const out: Record<string, PageTranslationStatus> = {};
  for (const code of MOCK_ACTIVE_LOCALE_CODES) {
    const t = snapshot.translations.find((x) => x.locale_code === code);
    out[code] = { enabled: t?.is_enabled ?? false, title: !blank(t?.title), seo_title: !blank(t?.seo_title), seo_description: !blank(t?.seo_description) };
  }
  return out;
}

function sectionsMissing(snapshot: MockPageSnapshot): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(MOCK_ACTIVE_LOCALE_CODES.map((c) => [c, 0]));
  for (const s of snapshot.sections) {
    const type = SECTION_TYPE_FIXTURES[s.section_type];
    // A reference to a shared section has no props of its own: the shared section checks itself when it is published (SS-12).
    if (!type || !s.is_visible || s.shared_section_id !== null) continue;
    const result = computeCompleteness(type.json_schema, s.props, [...MOCK_ACTIVE_LOCALE_CODES]);
    for (const code of MOCK_ACTIVE_LOCALE_CODES) out[code] += result[code]?.missing.length ?? 0;
  }
  return out;
}

function draftRef(db: MockDb, root: MockPageRoot): PageListItem["draft"] {
  const row = hasDraft(db, root) ? draftRowOf(db, root) : undefined;
  return row ? { revision_id: row.id, version: row.version, created_at: row.created_at, created_by: row.created_by } : null;
}

export function listItemOf(db: MockDb, root: MockPageRoot, locale = DEFAULT_LOCALE_CODE): PageListItem {
  const snap = working(db, root);
  const title = titleOf(snap, locale);
  const trashed = isTrashed(root);
  return {
    id: root.id,
    public_id: root.public_id,
    key: snap.page.key,
    name: snap.page.name,
    template: snap.page.template,
    path: snap.page.path,
    parent_id: null,
    is_home: snap.page.is_home,
    is_system: root.is_system,
    noindex: snap.page.noindex,
    in_sitemap: snap.page.in_sitemap,
    sort_order: snap.page.sort_order,
    title: title.title,
    title_locale: title.locale,
    translation_status: translationStatus(snap),
    section_count: snap.sections.length,
    draft: draftRef(db, root),
    status: root.status,
    lock_version: root.lock_version,
    has_unpublished_changes: hasDraft(db, root),
    published_at: root.published_at,
    first_published_at: root.first_published_at,
    scheduled_at: null,
    unpublished_at: root.unpublished_at,
    created_by: root.created_by,
    updated_by: root.updated_by,
    created_at: root.created_at,
    updated_at: root.updated_at,
    deleted_at: root.deleted_at,
    purge_at: trashed ? micros(Date.parse(root.deleted_at!) + TRASH_DAYS * 86_400_000, 0) : null,
  };
}

export function detailOf(db: MockDb, root: MockPageRoot, locale = DEFAULT_LOCALE_CODE): PageDetail {
  const snap = working(db, root);
  return {
    ...listItemOf(db, root, locale),
    translations: Object.fromEntries(
      snap.translations.map((t) => [
        t.locale_code,
        { title: t.title, seo_title: t.seo_title, seo_title_absolute: t.seo_title_absolute, seo_description: t.seo_description, og_image_id: t.og_image_id, canonical_path: t.canonical_path, is_enabled: t.is_enabled },
      ])
    ),
    missing_locales: MOCK_ACTIVE_LOCALE_CODES.filter((c) => blank(snap.translations.find((t) => t.locale_code === c)?.title)),
    sections_missing: sectionsMissing(snap),
  };
}

function stampOf(db: MockDb, root: MockPageRoot): AggregateStamp {
  return { entity_type: "cms.pages", id: root.id, lock_version: root.lock_version, status: root.status, has_unpublished_changes: hasDraft(db, root), updated_at: root.updated_at };
}

function writeResult(db: MockDb, root: MockPageRoot, warnings: SaveLiveWarning[] = []) {
  return { ...detailOf(db, root), aggregate: stampOf(db, root), warnings };
}

function sectionSummary(db: MockDb, root: MockPageRoot, s: MockSnapshotSection, withProps = false): SectionSummary {
  const type = SECTION_TYPE_FIXTURES[s.section_type];
  const snap = working(db, root);
  const required = isRequiredSection(snap, s);
  // 05 18.9.3: a reference has `props = {}`, `variant = null`, no translation status; the effective variant and the block `shared_section` are the shared section's.
  const shared = s.shared_section_id !== null ? sharedRow(db, s.shared_section_id) : undefined;
  const block = s.shared_section_id !== null ? sharedRefBlock(db, s.shared_section_id) : null;
  const completeness = type && s.shared_section_id === null ? computeCompleteness(type.json_schema, s.props, [...MOCK_ACTIVE_LOCALE_CODES]) : {};
  return {
    id: s.id,
    public_id: s.public_id,
    page_id: root.id,
    section_type: { id: 100 + (Object.keys(SECTION_TYPE_FIXTURES).indexOf(s.section_type) + 1), key: s.section_type, version: s.section_version, name: type?.name ?? s.section_type, is_active: Boolean(type), code_registered: Boolean(type) },
    variant: s.variant,
    effective_variant: shared ? (block?.variant ?? null) : s.variant,
    sort_order: s.sort_order,
    is_visible: s.is_visible,
    anchor_id: s.anchor_id,
    props_bytes: JSON.stringify(s.props).length,
    shared_section_id: s.shared_section_id,
    shared_section: s.shared_section_id !== null ? block : null,
    required,
    unsupported: !type,
    translation_status: shared ? {} : Object.fromEntries(MOCK_ACTIVE_LOCALE_CODES.map((c) => [c, { missing: completeness[c]?.missing.length ?? 0 }])),
    ...(withProps ? { props: structuredClone(s.props) } : {}),
  };
}

// The last section of a template-required group / type can not be deleted (05 12.5.8).
function isRequiredSection(snap: MockPageSnapshot, s: MockSnapshotSection): boolean {
  const template = TEMPLATE_DEFS.find((t) => t.key === snap.page.template);
  if (!template) return false;
  return template.required.some((r) => r.section_type_keys.includes(s.section_type) && snap.sections.filter((x) => r.section_type_keys.includes(x.section_type)).length <= r.min);
}

// ---------------------------------------------------------------------------------------------------------------
// Preconditions shared by the commands
// ---------------------------------------------------------------------------------------------------------------
export function findRoot(db: MockDb, id: string): MockPageRoot {
  const root = db.pages.find((p) => String(p.id) === id);
  if (!root) throw notFound();
  return root;
}
function requireMatch(ifMatch: string | null, root: MockPageRoot) {
  if (!ifMatch) throw preconditionRequired();
  if (ifMatch !== etagOfPage(root)) throw lockConflict();
}

// Every write / command: moves the clock, bumps `lock_version` (05 12.2.3).
function touch(db: MockDb, root: MockPageRoot): string {
  const stamp = tick(db);
  root.lock_version += 1;
  root.updated_at = stamp;
  root.updated_by = MOCK_USER;
  return stamp;
}

// A `history` checkpoint of the state before an edit, at most one per 10 minutes (PG-3).
function checkpoint(db: MockDb, root: MockPageRoot, stamp: string) {
  const list = revList(db, root);
  const latest = list.filter((r) => r.kind === "history" && !r.is_preview).reduce<number>((max, r) => Math.max(max, Date.parse(r.created_at)), 0);
  if (Date.parse(stamp) - latest < 10 * 60_000) return;
  pushRevision(db, "pages", root.id, "cms.pages", "history", structuredClone(working(db, root)) as unknown as Record<string, unknown>, "autosave", stamp, MOCK_USER);
}

// Where an edit goes (PG-1): the real rows while the page is not published, otherwise the draft row (created from a
// copy of the live rows on the first edit).
function beginWrite(db: MockDb, root: MockPageRoot): { snapshot: MockPageSnapshot; stamp: string } {
  const stamp = tick(db);
  checkpoint(db, root, stamp);
  if (root.status === "published" && !draftRowOf(db, root)) {
    pushRevision(db, "pages", root.id, "cms.pages", "draft", structuredClone(root.live) as unknown as Record<string, unknown>, null, stamp, MOCK_USER);
  }
  return { snapshot: working(db, root), stamp };
}

function commitWrite(root: MockPageRoot, stamp: string) {
  root.lock_version += 1;
  root.updated_at = stamp;
  root.updated_by = MOCK_USER;
}

function trashedCheck(root: MockPageRoot) {
  if (isTrashed(root)) throw invalidState("trashed");
}

const issue = (path: string, code: string, params: PublishIssue["params"] = {}, blocker = true): PublishIssue =>
  blocker ? { in: "entity", path, code, params } : { path, code, params };

// ---------------------------------------------------------------------------------------------------------------
// Idempotency-Key (05 1.13, opt-in on create / set-home / publish / unpublish)
// ---------------------------------------------------------------------------------------------------------------
export function withIdempotency<T>(
  db: MockDb,
  key: string | null,
  fingerprint: string,
  run: () => { status: number; data: T; etag?: string }
): { status: number; data: T; etag?: string; replayed: boolean } {
  if (key) {
    const stored = db.idempotency[key];
    if (stored) {
      if (stored.fingerprint !== fingerprint) throw fail(422, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used with different data.");
      return { status: stored.status, data: stored.data as T, etag: stored.etag, replayed: true };
    }
  }
  const result = run();
  if (key) db.idempotency[key] = { fingerprint, status: result.status, data: structuredClone(result.data), etag: result.etag };
  return { ...result, replayed: false };
}

// ---------------------------------------------------------------------------------------------------------------
// GET /pages
// ---------------------------------------------------------------------------------------------------------------
const STATUSES = ["draft", "in_review", "scheduled", "published", "archived"];
const SORTS = ["sort_order", "title", "path", "status", "template", "updated_at", "deleted_at"];

export function listPages(db: MockDb, params: Params) {
  rejectUnknown(params, ["page", "limit", "keyword", "locale", "status", "template", "is_home", "has_unpublished_changes", "trashed", "sort"]);
  const errors: ApiFieldError[] = [];
  const trashed = boolParam(params, "trashed") ?? false;
  const isHome = boolParam(params, "is_home");
  const pending = boolParam(params, "has_unpublished_changes");
  const keyword = params.get("keyword")?.trim().toLowerCase();
  if (keyword && [...keyword].length > 100) errors.push({ in: "query", path: "/keyword", code: "too_long", params: { max: 100 } });
  const locale = params.get("locale") ?? DEFAULT_LOCALE_CODE;
  if (!(MOCK_LOCALE_CODES as readonly string[]).includes(locale)) errors.push({ in: "query", path: "/locale", code: "unknown_reference" });
  const statuses = params.get("status")?.split(",").filter(Boolean);
  if (statuses && (statuses.length > 5 || statuses.some((s) => !STATUSES.includes(s)))) errors.push({ in: "query", path: "/status", code: "not_in_enum", params: { expected: STATUSES } });
  const templates = params.get("template")?.split(",").filter(Boolean);
  if (templates && (templates.length > 10 || templates.some((t) => !/^[a-z][a-z0-9_]{0,39}$/.test(t)))) errors.push({ in: "query", path: "/template", code: "pattern_mismatch" });
  const sort = params.get("sort") ?? (trashed ? "-deleted_at" : "sort_order");
  const m = /^(-?)([a-z_]+)$/.exec(sort);
  if (!m || !SORTS.includes(m[2])) errors.push({ in: "query", path: "/sort", code: "not_in_enum", params: { expected: SORTS } });
  if (errors.length) throw validationFailed(errors);

  let rows = db.pages.filter((p) => isTrashed(p) === trashed).map((p) => listItemOf(db, p, locale));
  if (keyword) {
    rows = rows.filter((r) => {
      const root = db.pages.find((p) => p.id === r.id)!;
      const titles = working(db, root).translations.map((t) => t.title.toLowerCase());
      return r.name.toLowerCase().includes(keyword) || r.path.toLowerCase().includes(keyword) || titles.some((t) => t.includes(keyword));
    });
  }
  if (statuses?.length) rows = rows.filter((r) => statuses.includes(r.status));
  if (templates?.length) rows = rows.filter((r) => templates.includes(r.template));
  if (isHome !== undefined) rows = rows.filter((r) => r.is_home === isHome);
  if (pending !== undefined) rows = rows.filter((r) => r.has_unpublished_changes === pending);
  const dir = m![1] ? -1 : 1;
  const field = m![2];
  const valueOf = (r: PageListItem): string | number => {
    if (field === "title") return (r.title ?? "").toLowerCase();
    return ((r as unknown as Record<string, unknown>)[field] as string | number | null) ?? "";
  };
  rows.sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return cmp * dir || a.id - b.id;
  });
  return paginate(rows, params);
}

export function getPage(db: MockDb, id: string) {
  const root = findRoot(db, id);
  return { data: detailOf(db, root), etag: etagOfPage(root) };
}

// ---------------------------------------------------------------------------------------------------------------
// Path / key / translation rules (05 12.3.2)
// ---------------------------------------------------------------------------------------------------------------
function pathErrors(path: unknown, pointer = "/path"): ApiFieldError[] {
  if (typeof path !== "string") return [{ in: "body", path: pointer, code: path === undefined ? "required" : "invalid_type" }];
  if (path.length > 200) return [{ in: "body", path: pointer, code: "too_long", params: { max: 200 } }];
  if (path === "/") return [{ in: "body", path: pointer, code: "pattern_mismatch", params: { rule: "root_reserved" } }];
  if (RESERVED_PATH.test(path)) return [{ in: "body", path: pointer, code: "pattern_mismatch", params: { rule: "reserved" } }];
  if (!PAGE_PATH.test(path)) return [{ in: "body", path: pointer, code: "pattern_mismatch", params: { rule: "format" } }];
  if (path.startsWith("/blog/")) return [{ in: "body", path: pointer, code: "pattern_mismatch", params: { rule: "blog_child" } }];
  return [];
}

function pathTaken(db: MockDb, path: string, exceptId?: number): boolean {
  return db.pages.some((p) => p.id !== exceptId && !isTrashed(p) && working(db, p).page.path === path);
}
function keyTaken(db: MockDb, key: string, exceptId?: number): boolean {
  return db.pages.some((p) => p.id !== exceptId && !isTrashed(p) && p.live.page.key === key);
}

function checkTranslationPatch(code: string, t: unknown, errors: ApiFieldError[], mode: "create" | "patch") {
  const base = `/translations/${code}`;
  if (!(MOCK_LOCALE_CODES as readonly string[]).includes(code)) {
    errors.push({ in: "body", path: base, code: "unknown_reference" });
    return;
  }
  if (t === null) {
    if (mode === "create") errors.push({ in: "body", path: base, code: "invalid_type" });
    else if (code === DEFAULT_LOCALE_CODE) errors.push({ in: "body", path: base, code: "required" });
    return;
  }
  if (!isObject(t)) {
    errors.push({ in: "body", path: base, code: "invalid_type" });
    return;
  }
  for (const f of Object.keys(t)) if (!(TRANSLATION_FIELDS as readonly string[]).includes(f)) errors.push({ in: "body", path: `${base}/${f}`, code: "unknown_field" });
  if (mode === "create" || "title" in t) {
    const title = t.title;
    if (typeof title !== "string") errors.push({ in: "body", path: `${base}/title`, code: title === undefined ? "required" : "invalid_type" });
    else if (title.trim() === "") errors.push({ in: "body", path: `${base}/title`, code: "too_short", params: { min: 1 } });
    else if ([...title.trim()].length > 120) errors.push({ in: "body", path: `${base}/title`, code: "too_long", params: { max: 120 } });
  }
  for (const [f, max] of [["seo_title", 120], ["seo_description", 320]] as const) {
    const v = t[f];
    if (v !== undefined && v !== null && (typeof v !== "string" || [...v].length > max)) errors.push({ in: "body", path: `${base}/${f}`, code: typeof v === "string" ? "too_long" : "invalid_type", params: { max } });
  }
  if (t.canonical_path !== undefined && t.canonical_path !== null && (typeof t.canonical_path !== "string" || !/^\/[^\s]*$/.test(t.canonical_path))) {
    errors.push({ in: "body", path: `${base}/canonical_path`, code: "pattern_mismatch" });
  }
  if (t.is_enabled === false && code === DEFAULT_LOCALE_CODE) errors.push({ in: "body", path: `${base}/is_enabled`, code: "immutable" });
}

function normaliseTranslation(code: string, t: Record<string, unknown>, old?: MockSnapshotTranslation): MockSnapshotTranslation {
  const str = (v: unknown, fallback: string | null) => (v === undefined ? fallback : v === null ? null : String(v).trim() === "" ? null : String(v));
  return {
    locale_code: code,
    title: t.title === undefined ? (old?.title ?? "") : String(t.title).trim(),
    seo_title: str(t.seo_title, old?.seo_title ?? null),
    seo_title_absolute: typeof t.seo_title_absolute === "boolean" ? t.seo_title_absolute : (old?.seo_title_absolute ?? false),
    seo_description: str(t.seo_description, old?.seo_description ?? null),
    og_image_id: t.og_image_id === undefined ? (old?.og_image_id ?? null) : (t.og_image_id as number | null),
    canonical_path: str(t.canonical_path, old?.canonical_path ?? null),
    is_enabled: typeof t.is_enabled === "boolean" ? t.is_enabled : (old?.is_enabled ?? true),
  };
}

const pathSlug = (path: string) => path.slice(1).replace(/\//g, "-");

// ---------------------------------------------------------------------------------------------------------------
// POST /pages
// ---------------------------------------------------------------------------------------------------------------
export function createPage(db: MockDb, body: unknown) {
  const input = isObject(body) ? body : {};
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(input)) {
    if (!["template", "path", "translations", "key", "name", "noindex", "in_sitemap", "sort_order"].includes(k)) errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  }
  const template = TEMPLATE_DEFS.find((t) => t.key === input.template);
  if (typeof input.template !== "string") errors.push({ in: "body", path: "/template", code: input.template === undefined ? "required" : "invalid_type" });
  else if (!template) errors.push({ in: "body", path: "/template", code: "not_in_enum", params: { expected: TEMPLATE_DEFS.map((t) => t.key) } });
  errors.push(...pathErrors(input.path));
  if (!isObject(input.translations)) errors.push({ in: "body", path: "/translations", code: input.translations === undefined ? "required" : "invalid_type" });
  else {
    for (const [code, t] of Object.entries(input.translations)) checkTranslationPatch(code, t, errors, "create");
    if (!isObject(input.translations[DEFAULT_LOCALE_CODE])) errors.push({ in: "body", path: `/translations/${DEFAULT_LOCALE_CODE}/title`, code: "required" });
  }
  if (input.key !== undefined && (typeof input.key !== "string" || !KEY_PATTERN.test(input.key))) errors.push({ in: "body", path: "/key", code: "pattern_mismatch" });
  if (input.name !== undefined && (typeof input.name !== "string" || input.name.trim() === "" || [...input.name].length > 120)) {
    errors.push({ in: "body", path: "/name", code: typeof input.name === "string" && input.name.trim() !== "" ? "too_long" : "too_short", params: { max: 120 } });
  }
  for (const f of ["noindex", "in_sitemap"] as const) if (input[f] !== undefined && typeof input[f] !== "boolean") errors.push({ in: "body", path: `/${f}`, code: "invalid_type" });
  if (input.sort_order !== undefined && (!Number.isInteger(input.sort_order) || (input.sort_order as number) < 0)) errors.push({ in: "body", path: "/sort_order", code: "out_of_range" });
  if (errors.length) throw validationFailed(errors);

  const path = input.path as string;
  const translations = input.translations as Record<string, Record<string, unknown>>;
  const clashes: ApiFieldError[] = [];
  if (pathTaken(db, path)) clashes.push({ in: "body", path: "/path", code: "duplicate", params: { reason: "page" } });
  let key = typeof input.key === "string" ? input.key : pathSlug(path).replace(/[^a-z0-9_-]/g, "-").replace(/^[^a-z]+/, "") || "page";
  if (typeof input.key === "string") {
    if (keyTaken(db, key)) clashes.push({ in: "body", path: "/key", code: "duplicate" });
  } else {
    const root = key;
    for (let n = 2; keyTaken(db, key); n++) key = `${root}-${n}`;
  }
  if (clashes.length) throw duplicate(clashes);

  const stamp = tick(db);
  const id = db.nextPageId++;
  const title = String(translations[DEFAULT_LOCALE_CODE].title).trim();
  const initial = template!.initial.map((s) => {
    const type = SECTION_TYPE_FIXTURES[s.section_type_key];
    return { section_type: s.section_type_key, variant: s.variant ?? (type?.variants?.[0] ?? null), props: structuredClone((type?.default_props ?? {}) as Record<string, unknown>) };
  });
  const root: MockPageRoot = {
    id,
    public_id: pagePublicId(id),
    is_system: false,
    status: "draft",
    lock_version: 1,
    published_at: null,
    first_published_at: null,
    unpublished_at: null,
    created_by: MOCK_USER,
    updated_by: MOCK_USER,
    created_at: stamp,
    updated_at: stamp,
    deleted_at: null,
    live: {
      page: {
        key,
        name: typeof input.name === "string" ? input.name.trim() : title.slice(0, 120),
        template: template!.key,
        path,
        parent_id: null,
        is_home: false,
        noindex: input.noindex === true,
        in_sitemap: input.in_sitemap !== false,
        sort_order: typeof input.sort_order === "number" ? input.sort_order : Math.max(0, ...db.pages.map((p) => p.live.page.sort_order)) + 10,
      },
      translations: Object.entries(translations).map(([code, t]) => normaliseTranslation(code, t)),
      sections: sectionsOf(db, initial),
    },
  };
  db.pages.push(root);
  const result = { ...writeResult(db, root, serpWarnings(root.live)), sections: root.live.sections.map((s) => sectionSummary(db, root, s)) };
  return { data: result, etag: etagOfPage(root) };
}

function serpWarnings(snap: MockPageSnapshot): SaveLiveWarning[] {
  const out: SaveLiveWarning[] = [];
  for (const t of snap.translations) {
    if (t.seo_title && [...t.seo_title].length > 60) out.push({ path: `/translations/${t.locale_code}/seo_title`, code: "serp_title_long", params: { length: [...t.seo_title].length, recommended: 60 } });
    if (t.seo_description && [...t.seo_description].length > 160) out.push({ path: `/translations/${t.locale_code}/seo_description`, code: "serp_description_long", params: { length: [...t.seo_description].length, recommended: 160 } });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// PATCH /pages/{id}
// ---------------------------------------------------------------------------------------------------------------
export function patchPage(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
  const root = findRoot(db, id);
  requireMatch(ifMatch, root);
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const errors: ApiFieldError[] = [];
  const keys = Object.keys(body);
  if (keys.length === 0) throw validationFailed([{ in: "body", path: "", code: "min_properties" }]);
  const snapNow = working(db, root);
  for (const k of keys) {
    if (["key", "is_home", "is_system", "status"].includes(k)) errors.push({ in: "body", path: `/${k}`, code: "immutable" });
    else if (["parent_id", "scheduled_at", "unpublished_at"].includes(k)) errors.push({ in: "body", path: `/${k}`, code: "not_applicable" });
    else if (!["name", "template", "path", "noindex", "in_sitemap", "sort_order", "translations"].includes(k)) errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  }
  if (typeof body.name === "string" && (body.name.trim() === "" || [...body.name].length > 120)) errors.push({ in: "body", path: "/name", code: body.name.trim() === "" ? "too_short" : "too_long", params: { max: 120 } });
  if (body.path !== undefined && body.path !== snapNow.page.path) {
    if (snapNow.page.is_home) errors.push({ in: "body", path: "/path", code: "immutable", params: { reason: "is_home" } });
    else if (snapNow.page.key === "blog") errors.push({ in: "body", path: "/path", code: "immutable", params: { reason: "locked_path" } });
    else errors.push(...pathErrors(body.path));
  }
  if (body.template !== undefined) {
    const t = TEMPLATE_DEFS.find((x) => x.key === body.template);
    if (!t) errors.push({ in: "body", path: "/template", code: "not_in_enum", params: { expected: TEMPLATE_DEFS.map((x) => x.key) } });
    else {
      for (const s of snapNow.sections) {
        if (!t.allowed.includes(s.section_type)) errors.push({ in: "body", path: "/template", code: "template_violation", params: { rule: "section_not_allowed", template: t.key, section_key: s.section_type, section_id: s.id } });
      }
    }
  }
  if (body.translations !== undefined) {
    if (!isObject(body.translations)) errors.push({ in: "body", path: "/translations", code: "invalid_type" });
    else for (const [code, t] of Object.entries(body.translations)) checkTranslationPatch(code, t, errors, "patch");
  }
  if (errors.length) throw validationFailed(errors);
  if (typeof body.path === "string" && body.path !== snapNow.page.path && pathTaken(db, body.path, root.id)) {
    throw duplicate([{ in: "body", path: "/path", code: "duplicate", params: { reason: "page" } }]);
  }

  // Apply on a copy first: no change at all -> 200 with the same ETag, no side effect (05 12.3.3).
  const next = structuredClone(snapNow);
  for (const f of ["name", "template", "path", "noindex", "in_sitemap", "sort_order"] as const) {
    if (body[f] !== undefined) (next.page as Record<string, unknown>)[f] = typeof body[f] === "string" ? (body[f] as string).trim() : body[f];
  }
  if (isObject(body.translations)) {
    for (const [code, t] of Object.entries(body.translations)) {
      if (t === null) next.translations = next.translations.filter((x) => x.locale_code !== code);
      else {
        const old = next.translations.find((x) => x.locale_code === code);
        const merged = normaliseTranslation(code, t as Record<string, unknown>, old);
        next.translations = old ? next.translations.map((x) => (x.locale_code === code ? merged : x)) : [...next.translations, merged];
      }
    }
  }
  if (JSON.stringify(next) === JSON.stringify(snapNow)) return { data: writeResult(db, root), etag: etagOfPage(root) };

  // A translator (PG-14): the title and the SEO texts only; a value that differs elsewhere is a 403.
  if (db.translateOnly.includes("pages")) {
    for (const f of ["name", "template", "path", "noindex", "in_sitemap", "sort_order"] as const) {
      if (next.page[f] !== snapNow.page[f]) throw forbidden(`/${f}`);
    }
    for (const t of next.translations) {
      const old = snapNow.translations.find((x) => x.locale_code === t.locale_code);
      if (!old) throw forbidden(`/translations/${t.locale_code}`);
      for (const f of ["seo_title_absolute", "og_image_id", "canonical_path", "is_enabled"] as const) {
        if (t[f] !== old[f]) throw forbidden(`/translations/${t.locale_code}/${f}`);
      }
    }
    if (snapNow.translations.some((old) => !next.translations.some((t) => t.locale_code === old.locale_code))) throw forbidden("/translations");
  }

  const { snapshot, stamp } = beginWrite(db, root);
  const warnings: SaveLiveWarning[] = serpWarnings(next);
  if (root.first_published_at && snapNow.page.path !== next.page.path) warnings.push({ path: "/path", code: "path_changed_published", params: { old_path: snapNow.page.path } });
  Object.assign(snapshot.page, next.page);
  snapshot.translations = next.translations;
  commitWrite(root, stamp);
  return { data: writeResult(db, root, warnings), etag: etagOfPage(root) };
}

// ---------------------------------------------------------------------------------------------------------------
// Sections (05 12.5): read, create, change, reorder, delete. Every write needs the PAGE's `If-Match`, bumps the page's
// `lock_version` and answers the page's NEW ETag + `aggregate` (never the page). Props are checked at the draft level
// the way the real validator would for the rules below - NOT with Ajv (the production CSP of a mock-enabled build
// refuses its code generation): max length of text, enum, array size, a media / page / album that does not exist.
// ---------------------------------------------------------------------------------------------------------------
const MAX_SECTIONS = 60;
const ANCHOR = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_PROPS_BYTES = 262144;

function placementOf(templateKey: string, key: string): { allowed: boolean; max: number | null; position: "first" | "after_hero" | "any"; hero: boolean } {
  const template = TEMPLATE_DEFS.find((t) => t.key === templateKey);
  const hero = (HERO_KEYS as readonly string[]).includes(key);
  const requiredType = Boolean(template?.required.some((r) => r.kind === "type" && r.section_type_keys.includes(key)));
  return {
    allowed: Boolean(template?.allowed.includes(key)),
    max: hero || key === "post_list" || key === "contact_section" ? 1 : null,
    position: hero ? "first" : requiredType ? "after_hero" : "any",
    hero,
  };
}

// What a page template says about a section type for a SHARED section (05 18.4 `placeable_on_page`, SS-7): allowed at all, and whether the type
// fills a slot the template requires (hero group, `contact_section`, `post_list`), which a shared section can not.
export function sharedPlacement(templateKey: string, key: string): { allowed: boolean; requiredSlot: boolean } {
  const template = TEMPLATE_DEFS.find((t) => t.key === templateKey);
  return { allowed: Boolean(template?.allowed.includes(key)), requiredSlot: Boolean(template?.required.some((r) => r.section_type_keys.includes(key))) };
}

// The structure rules checked at save time (PG-8): the same four codes for POST, PUT order and PATCH template.
function templateViolations(
  templateKey: string,
  order: Array<{ key: string; id?: number }>,
  pointers: { allowed: string; max: string; hero_first: (index: number) => string; after_hero: (index: number) => string }
): ApiFieldError[] {
  const errors: ApiFieldError[] = [];
  const heroIndex = order.findIndex((s) => placementOf(templateKey, s.key).hero);
  const heroCount = order.filter((s) => placementOf(templateKey, s.key).hero).length;
  const counts = new Map<string, number>();
  order.forEach((s, index) => {
    const place = placementOf(templateKey, s.key);
    const params = { template: templateKey, section_key: s.key, ...(s.id !== undefined ? { section_id: s.id } : {}) };
    if (!place.allowed) {
      errors.push({ in: "body", path: pointers.allowed, code: "template_violation", params: { rule: "section_not_allowed", ...params } });
      return;
    }
    counts.set(s.key, (counts.get(s.key) ?? 0) + 1);
    const over = place.hero ? heroCount > 1 : place.max !== null && (counts.get(s.key) ?? 0) > place.max;
    if (over) errors.push({ in: "body", path: pointers.max, code: "template_violation", params: { rule: "max_per_page", max: place.max ?? 1, ...params } });
    if (place.hero && index !== 0) errors.push({ in: "body", path: pointers.hero_first(index), code: "template_violation", params: { rule: "hero_first", ...params } });
    if (place.position === "after_hero" && heroIndex >= 0 && index < heroIndex) errors.push({ in: "body", path: pointers.after_hero(index), code: "template_violation", params: { rule: "after_hero", ...params } });
  });
  return errors;
}

// Draft-level checks of a props object, as `/props/...` field errors.
export function propsErrors(db: MockDb, typeKey: string, props: Record<string, unknown>): ApiFieldError[] {
  const type = SECTION_TYPE_FIXTURES[typeKey];
  const errors: ApiFieldError[] = [];
  if (JSON.stringify(props).length > MAX_PROPS_BYTES) return [{ in: "body", path: "/props", code: "too_long", params: { unit: "bytes", max: MAX_PROPS_BYTES } }];
  walkSchemaValue(type.json_schema, type.json_schema, props, ({ pointer, schema, value }) => {
    if (value === undefined || value === null) return;
    const at = `/props${pointer}`;
    if (schema["x-localized"] === true) {
      if (isObject(value) && !schema["x-richtext"]) {
        for (const [code, text] of Object.entries(value)) {
          const ap = schema.additionalProperties;
          const max = isObject(ap) && typeof ap.maxLength === "number" ? ap.maxLength : schema.maxLength;
          if (typeof text === "string" && typeof max === "number" && [...text].length > max) errors.push({ in: "body", path: `${at}/${code}`, code: "too_long", params: { max, unit: "chars" } });
        }
      }
      return;
    }
    if (typeof value === "string") {
      if (typeof schema.maxLength === "number" && [...value].length > schema.maxLength) errors.push({ in: "body", path: at, code: "too_long", params: { max: schema.maxLength, unit: "chars" } });
      if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push({ in: "body", path: at, code: "not_in_enum", params: { expected: schema.enum as string[] } });
    }
    if (Array.isArray(value)) {
      if (typeof schema.maxItems === "number" && value.length > schema.maxItems) errors.push({ in: "body", path: at, code: "too_long", params: { max: schema.maxItems, unit: "items" } });
      if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push({ in: "body", path: at, code: "too_short", params: { min: schema.minItems, unit: "items" } });
    }
  });
  deepFind(props, "media_id", "/props", (v, pointer) => {
    if (typeof v === "number" && !db.assets.some((a) => a.id === v && !a.deleted_at)) errors.push({ in: "body", path: pointer, code: "unknown_reference", params: { ref_type: "media_assets", ref_id: v } });
  });
  deepFind(props, "page_id", "/props", (v, pointer) => {
    const target = typeof v === "number" ? db.pages.find((p) => p.id === v) : undefined;
    if (typeof v === "number" && (!target || isTrashed(target))) errors.push({ in: "body", path: pointer, code: "unknown_reference", params: { ref_type: "pages", ref_id: v } });
  });
  deepFind(props, "album_id", "/props", (v, pointer) => {
    if (typeof v === "number" && !db.albums.some((a) => a.id === v && !a.deleted_at)) errors.push({ in: "body", path: pointer, code: "unknown_reference", params: { ref_type: "albums", ref_id: v } });
  });
  return errors.slice(0, MAX_ISSUES);
}

// Every path that differs between two props objects (a differing array length counts at the array itself).
function changedPointers(a: unknown, b: unknown, pointer = ""): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [pointer];
    return a.flatMap((v, i) => changedPointers(v, b[i], `${pointer}/${i}`));
  }
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => changedPointers(a[k], b[k], `${pointer}/${k}`));
  }
  return [pointer];
}

// 05 12.5.6 (S-4): a translator may change only what sits under an `x-localized` node.
export function translatableViolation(typeKey: string, before: Record<string, unknown>, after: Record<string, unknown>): string | null {
  const type = SECTION_TYPE_FIXTURES[typeKey];
  const leaves = new Set<string>();
  for (const props of [before, after]) {
    walkSchemaValue(type.json_schema, type.json_schema, props, ({ pointer, schema }) => {
      if (schema["x-localized"] === true) leaves.add(pointer);
    });
  }
  for (const pointer of changedPointers(before, after)) {
    if (![...leaves].some((leaf) => pointer === leaf || pointer.startsWith(`${leaf}/`))) return `/props${pointer}`;
  }
  return null;
}

function sectionOrder(snap: MockPageSnapshot) {
  return snap.sections.slice().sort((a, b) => a.sort_order - b.sort_order).map((x) => ({ id: x.id, public_id: x.public_id, sort_order: x.sort_order }));
}
const renumberSections = (sections: MockSnapshotSection[]) => sections.forEach((s, i) => (s.sort_order = i));

export function listSections(db: MockDb, id: string, params: Params) {
  rejectUnknown(params, ["include"]);
  const include = params.get("include");
  if (include !== null && include !== "props") throw validationFailed([{ in: "query", path: "/include", code: "not_in_enum", params: { expected: ["props"] } }]);
  const root = findRoot(db, id);
  const snap = working(db, root);
  return { data: snap.sections.slice().sort((a, b) => a.sort_order - b.sort_order).map((s) => sectionSummary(db, root, s, include === "props")), etag: etagOfPage(root) };
}

export function getSection(db: MockDb, id: string, sectionId: string) {
  const root = findRoot(db, id);
  const s = working(db, root).sections.find((x) => String(x.id) === sectionId);
  if (!s) throw notFound();
  return { data: sectionSummary(db, root, s, true), etag: etagOfPage(root) };
}

function writeAnswer(db: MockDb, root: MockPageRoot, snapshot: MockPageSnapshot, section: MockSnapshotSection, warnings: SaveLiveWarning[] = []) {
  return {
    section: sectionSummary(db, root, section, true),
    sections: sectionOrder(snapshot),
    aggregate: stampOf(db, root),
    warnings,
  };
}

// 18.9.1: the warning of a section that now shows a shared section which is not live (the page publish is blocked until it is).
const notLiveWarning = (db: MockDb, sharedId: number): SaveLiveWarning[] =>
  sharedIsLive(db, sharedId)
    ? []
    : [{ path: "/shared_section_id", code: "shared_section_not_live", message: "The shared section is not published: publishing the page is blocked until it is.", params: { shared_section_id: sharedId, shared_state: sharedState(db, sharedId) } }];

export function createSection(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
  const root = findRoot(db, id);
  requireMatch(ifMatch, root);
  trashedCheck(root);
  if (db.translateOnly.includes("sections")) throw forbidden("create");
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const now = working(db, root);
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(body)) {
    if (!["section_type_key", "position", "variant", "props", "is_visible", "anchor_id", "shared_section_id"].includes(k)) errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  }
  // 05 18.9.1: a section is either of a type or a reference to a shared section (whose type it takes).
  const referencing = body.shared_section_id !== undefined && body.shared_section_id !== null;
  let shared: ReturnType<typeof sharedRow>;
  let key = body.section_type_key;
  if (referencing) {
    const sid = body.shared_section_id;
    if (typeof sid !== "number" || !Number.isInteger(sid) || sid < 1) errors.push({ in: "body", path: "/shared_section_id", code: "invalid_type" });
    else {
      shared = sharedRow(db, sid);
      if (!shared || shared.deleted_at) errors.push({ in: "body", path: "/shared_section_id", code: "unknown_reference", params: { ref_type: "cms_shared_sections", ref_id: sid } });
      else {
        const sharedType = SECTION_TYPE_FIXTURES[shared.section_type];
        if (!sharedType) errors.push({ in: "body", path: "/shared_section_id", code: "section_type_unknown" });
        else if (sharedType.is_active === false) errors.push({ in: "body", path: "/shared_section_id", code: "section_type_inactive" });
        else if (!(sharedType.allowed_scopes ?? []).includes("page")) errors.push({ in: "body", path: "/shared_section_id", code: "not_in_enum", params: { expected: sharedType.allowed_scopes ?? [] } });
        if (key !== undefined && key !== shared.section_type) errors.push({ in: "body", path: "/section_type_key", code: "not_in_enum", params: { expected: [shared.section_type] } });
        key = shared.section_type;
      }
    }
    if (body.variant !== undefined && body.variant !== null) errors.push({ in: "body", path: "/variant", code: "not_applicable", params: { reason: "shared_reference" } });
    if (body.props !== undefined && !(isObject(body.props) && Object.keys(body.props).length === 0)) errors.push({ in: "body", path: "/props", code: "not_applicable", params: { reason: "shared_reference" } });
  }
  const type = typeof key === "string" ? SECTION_TYPE_FIXTURES[key] : undefined;
  if (!referencing) {
    if (typeof key !== "string") errors.push({ in: "body", path: "/section_type_key", code: key === undefined ? "required" : "invalid_type" });
    else if (!type) errors.push({ in: "body", path: "/section_type_key", code: "unknown_reference" });
  }
  const count = now.sections.length;
  let position = count;
  if (body.position !== undefined) {
    if (!Number.isInteger(body.position) || (body.position as number) < 0) errors.push({ in: "body", path: "/position", code: "out_of_range", params: { min: 0, max: count } });
    else if ((body.position as number) > count) errors.push({ in: "body", path: "/position", code: "out_of_range", params: { max: count } });
    else position = body.position as number;
  }
  if (!referencing && type && body.variant !== undefined && body.variant !== null && !type.variants.includes(body.variant as string)) {
    errors.push({ in: "body", path: "/variant", code: "not_in_enum", params: { expected: type.variants } });
  }
  if (!referencing && type && body.variant !== undefined && body.variant !== null && typeof body.variant !== "string") errors.push({ in: "body", path: "/variant", code: "invalid_type" });
  if (!referencing && body.props !== undefined && !isObject(body.props)) errors.push({ in: "body", path: "/props", code: "invalid_type", params: { expected: "object" } });
  if (body.is_visible !== undefined && typeof body.is_visible !== "boolean") errors.push({ in: "body", path: "/is_visible", code: "invalid_type" });
  if (body.anchor_id !== undefined && body.anchor_id !== null && (typeof body.anchor_id !== "string" || !ANCHOR.test(body.anchor_id))) errors.push({ in: "body", path: "/anchor_id", code: "pattern_mismatch" });
  if (!referencing && type && isObject(body.props)) errors.push(...propsErrors(db, type.key, body.props));
  if (count >= MAX_SECTIONS) errors.push({ in: "body", path: "", code: "limit_exceeded", params: { max: MAX_SECTIONS } });
  if (type && errors.length === 0) {
    const order: Array<{ key: string; id?: number }> = now.sections.slice().sort((a, b) => a.sort_order - b.sort_order).map((s) => ({ key: s.section_type, id: s.id }));
    order.splice(position, 0, { key: type.key });
    if (referencing && sharedPlacement(now.page.template, type.key).requiredSlot) {
      // SS-7: a shared section can not fill a slot the template requires.
      errors.push({ in: "body", path: "/shared_section_id", code: "template_violation", params: { rule: "shared_in_required_slot", template: now.page.template, section_key: type.key } });
    } else {
      errors.push(
        ...templateViolations(now.page.template, order, {
          allowed: referencing ? "/shared_section_id" : "/section_type_key",
          max: referencing ? "/shared_section_id" : "/section_type_key",
          hero_first: () => "/position",
          after_hero: () => "/position",
        })
      );
    }
  }
  if (errors.length) throw validationFailed(errors);
  if (typeof body.anchor_id === "string" && now.sections.some((s) => s.anchor_id === body.anchor_id)) {
    throw duplicate([{ in: "body", path: "/anchor_id", code: "duplicate" }]);
  }

  const { snapshot, stamp } = beginWrite(db, root);
  const newId = db.nextSectionId++;
  const created: MockSnapshotSection = {
    id: newId,
    public_id: sectionPublicId(newId),
    section_type: type!.key,
    section_version: shared ? shared.section_version : type!.version,
    variant: shared ? null : ((body.variant as string | null | undefined) ?? null),
    sort_order: position,
    is_visible: body.is_visible === undefined ? true : (body.is_visible as boolean),
    anchor_id: (body.anchor_id as string | null | undefined) ?? null,
    props: shared ? {} : structuredClone((isObject(body.props) ? body.props : type!.default_props) as Record<string, unknown>),
    shared_section_id: shared ? shared.id : null,
  };
  const ordered = snapshot.sections.slice().sort((a, b) => a.sort_order - b.sort_order);
  ordered.splice(position, 0, created);
  renumberSections(ordered);
  snapshot.sections = ordered;
  commitWrite(root, stamp);
  return { data: writeAnswer(db, root, snapshot, created, shared && created.is_visible ? notLiveWarning(db, shared.id) : []), etag: etagOfPage(root), location: `/api/v1/pages/${root.id}/sections/${newId}` };
}

export function patchSection(db: MockDb, id: string, sectionId: string, body: unknown, ifMatch: string | null) {
  const root = findRoot(db, id);
  requireMatch(ifMatch, root);
  trashedCheck(root);
  const current = working(db, root).sections.find((x) => String(x.id) === sectionId);
  if (!current) throw notFound();
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const errors: ApiFieldError[] = [];
  if (Object.keys(body).length === 0) errors.push({ in: "body", path: "", code: "min_properties" });
  for (const k of Object.keys(body)) {
    if (["section_type_key", "sort_order", "shared_section_id", "section_version"].includes(k)) errors.push({ in: "body", path: `/${k}`, code: "immutable" });
    else if (!["props", "variant", "is_visible", "anchor_id"].includes(k)) errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  }
  const type = SECTION_TYPE_FIXTURES[current.section_type];
  // 05 18.9.2: only `is_visible` and `anchor_id` of a section that references a shared section can change.
  const isRef = current.shared_section_id !== null;
  if (isRef) {
    for (const f of ["props", "variant"] as const) if (body[f] !== undefined) errors.push({ in: "body", path: `/${f}`, code: "not_applicable", params: { reason: "shared_reference" } });
  }
  if (!isRef && body.props !== undefined && !isObject(body.props)) errors.push({ in: "body", path: "/props", code: "invalid_type", params: { expected: "object" } });
  if (body.is_visible !== undefined && typeof body.is_visible !== "boolean") errors.push({ in: "body", path: "/is_visible", code: "invalid_type" });
  if (body.anchor_id !== undefined && body.anchor_id !== null && (typeof body.anchor_id !== "string" || !ANCHOR.test(body.anchor_id))) errors.push({ in: "body", path: "/anchor_id", code: "pattern_mismatch" });
  if (!isRef && type && body.variant !== undefined && body.variant !== null && !type.variants.includes(body.variant as string)) errors.push({ in: "body", path: "/variant", code: "not_in_enum", params: { expected: type.variants } });
  if (!isRef && !type && (body.props !== undefined || body.variant !== undefined)) errors.push({ in: "body", path: body.props !== undefined ? "/props" : "/variant", code: "section_type_unknown" });
  if (!isRef && type && isObject(body.props)) errors.push(...propsErrors(db, type.key, body.props));
  if (errors.length) throw validationFailed(errors);

  // A translator (S-4): only text under `x-localized`; variant / visibility / anchor are structure.
  if (db.translateOnly.includes("sections")) {
    for (const f of ["variant", "is_visible", "anchor_id"] as const) {
      if (body[f] !== undefined && body[f] !== current[f]) throw forbidden(`/${f}`);
    }
    if (isObject(body.props)) {
      const bad = translatableViolation(current.section_type, current.props, body.props);
      if (bad) throw forbidden(bad);
    }
  }
  if (typeof body.anchor_id === "string" && working(db, root).sections.some((s) => s.id !== current.id && s.anchor_id === body.anchor_id)) {
    throw duplicate([{ in: "body", path: "/anchor_id", code: "duplicate" }]);
  }

  // Nothing changes: 200, the same ETag, no side effect (05 12.5.6).
  const same =
    (body.props === undefined || JSON.stringify(body.props) === JSON.stringify(current.props)) &&
    (body.variant === undefined || body.variant === current.variant) &&
    (body.is_visible === undefined || body.is_visible === current.is_visible) &&
    (body.anchor_id === undefined || body.anchor_id === current.anchor_id);
  if (same) return { data: writeAnswer(db, root, working(db, root), current), etag: etagOfPage(root) };
  const showsNow = isRef && body.is_visible === true && !current.is_visible;

  const { snapshot, stamp } = beginWrite(db, root);
  const s = snapshot.sections.find((x) => String(x.id) === sectionId)!;
  if (body.props !== undefined) s.props = structuredClone(body.props) as Record<string, unknown>;
  if (body.is_visible !== undefined) s.is_visible = body.is_visible as boolean;
  if (body.variant !== undefined) s.variant = body.variant as string | null;
  if (body.anchor_id !== undefined) s.anchor_id = body.anchor_id as string | null;
  commitWrite(root, stamp);
  return { data: writeAnswer(db, root, snapshot, s, showsNow ? notLiveWarning(db, current.shared_section_id!) : []), etag: etagOfPage(root) };
}

// 05 18.10 (SS-5): the shared section's WORKING copy (its draft if it has one) becomes the page section's own props; idempotent for a section that
// references nothing. Page ETag in `If-Match`; a page that is published gets the change in its draft.
export function detachSection(db: MockDb, id: string, sectionId: string, body: unknown, ifMatch: string | null) {
  const root = findRoot(db, id);
  requireMatch(ifMatch, root);
  trashedCheck(root);
  if (body !== undefined && body !== null && !isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const extra = Object.keys((body ?? {}) as Record<string, unknown>).map((k) => ({ in: "body" as const, path: `/${k}`, code: "unknown_field" }));
  if (extra.length) throw validationFailed(extra);
  if (db.translateOnly.includes("sections") || db.sharedSectionRole === "viewer") throw forbidden("cms.sections:update POST /pages/{pageId}/sections/{id}/detach");
  const now = working(db, root);
  const current = now.sections.find((x) => String(x.id) === sectionId);
  if (!current) throw notFound();
  if (current.shared_section_id === null) return { data: writeAnswer(db, root, now, current), etag: etagOfPage(root) };
  const shared = sharedRow(db, current.shared_section_id);
  if (!shared) throw validationFailed([{ in: "entity", path: `/sections/${current.public_id}/shared_section_id`, code: "unknown_reference", params: { ref_type: "cms_shared_sections", ref_id: current.shared_section_id } }]);
  const copy = sharedWorking(db, shared);
  const bad = propsErrors(db, shared.section_type, copy.props);
  if (bad.length) throw validationFailed(bad.map((e) => ({ ...e, in: "entity" as const, params: { ...(e.params ?? {}), shared_section_id: shared.id } })));
  const draftRevision = shared.status === "published" ? db.revisions[keyOf("shared-sections", shared.id)]?.find((r) => r.kind === "draft") : undefined;

  const { snapshot, stamp } = beginWrite(db, root);
  const s = snapshot.sections.find((x) => String(x.id) === sectionId)!;
  s.props = structuredClone(copy.props);
  s.variant = copy.variant;
  s.shared_section_id = null;
  commitWrite(root, stamp);
  const warnings: SaveLiveWarning[] =
    sharedHasDraft(db, shared) && draftRevision
      ? [{ path: "/props", code: "shared_draft_copied", message: "The unpublished draft of the shared section was copied; the website changes when this page is published.", params: { shared_section_id: shared.id, revision_id: draftRevision.id } }]
      : [];
  return { data: writeAnswer(db, root, snapshot, s, warnings), etag: etagOfPage(root) };
}

export function reorderSections(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
  const root = findRoot(db, id);
  requireMatch(ifMatch, root);
  trashedCheck(root);
  if (db.translateOnly.includes("sections")) throw forbidden("/sections");
  if (!isObject(body) || !Array.isArray(body.sections) || body.sections.length === 0) {
    throw validationFailed([{ in: "body", path: "/sections", code: isObject(body) && body.sections === undefined ? "required" : "invalid_type" }]);
  }
  const now = working(db, root);
  const errors: ApiFieldError[] = [];
  const ids: number[] = [];
  const seen = new Set<number>();
  body.sections.forEach((entry: unknown, i: number) => {
    const sid = isObject(entry) ? entry.id : undefined;
    if (typeof sid !== "number") errors.push({ in: "body", path: `/sections/${i}/id`, code: "invalid_type" });
    else if (seen.has(sid)) errors.push({ in: "body", path: `/sections/${i}/id`, code: "duplicate" });
    else if (!now.sections.some((s) => s.id === sid)) errors.push({ in: "body", path: `/sections/${i}/id`, code: "unknown_reference" });
    else {
      seen.add(sid);
      ids.push(sid);
    }
  });
  if (errors.length === 0) {
    const missing = now.sections.filter((s) => !seen.has(s.id)).map((s) => s.id);
    if (missing.length) errors.push({ in: "body", path: "", code: "required", params: { missing: missing.map(String) } });
  }
  if (errors.length === 0) {
    const order = ids.map((sid) => ({ key: now.sections.find((s) => s.id === sid)!.section_type, id: sid }));
    errors.push(
      ...templateViolations(now.page.template, order, {
        allowed: "/sections",
        max: "/sections",
        hero_first: (i) => `/sections/${i}/id`,
        after_hero: (i) => `/sections/${i}/id`,
      })
    );
  }
  if (errors.length) throw validationFailed(errors);
  const before = sectionOrder(now).map((o) => o.id);
  if (before.join() === ids.join()) return { data: { sections: sectionOrder(now), aggregate: stampOf(db, root) }, etag: etagOfPage(root) };

  const { snapshot, stamp } = beginWrite(db, root);
  const reordered = ids.map((sid) => snapshot.sections.find((s) => s.id === sid)!);
  renumberSections(reordered);
  snapshot.sections = reordered;
  commitWrite(root, stamp);
  return { data: { sections: sectionOrder(snapshot), aggregate: stampOf(db, root) }, etag: etagOfPage(root) };
}

export function deleteSection(db: MockDb, id: string, sectionId: string, ifMatch: string | null) {
  const root = findRoot(db, id);
  requireMatch(ifMatch, root);
  trashedCheck(root);
  const now = working(db, root);
  const target = now.sections.find((x) => String(x.id) === sectionId);
  if (!target) throw notFound();
  if (db.translateOnly.includes("sections")) throw forbidden("delete");
  if (isRequiredSection(now, target)) {
    const place = placementOf(now.page.template, target.section_type);
    throw invalidState("section_required", { template: now.page.template, section_key: target.section_type, group: place.hero ? "hero" : null });
  }
  const { snapshot, stamp } = beginWrite(db, root);
  const rest = snapshot.sections.filter((s) => String(s.id) !== sectionId).sort((a, b) => a.sort_order - b.sort_order);
  renumberSections(rest);
  snapshot.sections = rest;
  commitWrite(root, stamp);
  return { data: { sections: sectionOrder(snapshot), aggregate: stampOf(db, root) }, etag: etagOfPage(root) };
}

// ---------------------------------------------------------------------------------------------------------------
// References, delete, restore, set-home
// ---------------------------------------------------------------------------------------------------------------
function deepFind(value: unknown, key: string, pointer: string, visit: (v: unknown, pointer: string) => void) {
  if (Array.isArray(value)) value.forEach((v, i) => deepFind(v, key, `${pointer}/${i}`, visit));
  else if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === key) visit(v, `${pointer}/${k}`);
      else deepFind(v, key, `${pointer}/${k}`, visit);
    }
  }
}

export function referencesOf(db: MockDb, root: MockPageRoot): PageReference[] {
  const out: PageReference[] = [];
  for (const menu of db.menus) {
    for (const item of menu.items) {
      if (item.link.type === "page" && item.link.page_id === root.id) {
        out.push({ entity_type: "cms.menu_item", id: item.id, title: item.translations[DEFAULT_LOCALE_CODE]?.label ?? `#${item.id}`, field: "/link/page_id", kind: "menu_item", in_draft: false, menu_key: menu.key });
      }
    }
  }
  for (const other of db.pages) {
    if (other.id === root.id || isTrashed(other)) continue;
    const scan = (snap: MockPageSnapshot, kind: PageReference["kind"], inDraft: boolean) => {
      for (const s of snap.sections) {
        deepFind(s.props, "page_id", `/sections/${s.public_id}/props`, (v, pointer) => {
          if (v === root.id) out.push({ entity_type: "cms.page", id: other.id, title: pageTitle(other), field: pointer, kind, in_draft: inDraft });
        });
      }
    };
    scan(other.live, "section_props", false);
    const draft = draftRowOf(db, other);
    if (draft && other.status === "published") scan(draft.snapshot as unknown as MockPageSnapshot, "draft_props", true);
  }
  return out;
}

export function getReferences(db: MockDb, id: string) {
  const root = findRoot(db, id);
  const all = referencesOf(db, root);
  return { references: all.slice(0, 50), total_references: all.length, truncated: all.length > 50 };
}

function referenced(db: MockDb, root: MockPageRoot, confirm: boolean): SaveLiveWarning[] {
  const refs = referencesOf(db, root);
  if (refs.length === 0) return [];
  if (!confirm) throw fail(409, "ENTITY_REFERENCED", "The record is referenced by other data.", { details: { references: refs.slice(0, 50), total_references: refs.length } });
  return [{ path: "", code: "page_referenced", params: { total_references: refs.length } }];
}

function confirmParam(params: Params): boolean {
  rejectUnknown(params, ["confirm_references"]);
  return boolParam(params, "confirm_references") ?? false;
}

// A published page that leaves `published` (unpublish, delete) with a draft pending: the draft becomes a `history`
// row, the live rows stay as they were (the task's rule 1 - never fails because of the draft).
function keepDraftAsHistory(db: MockDb, root: MockPageRoot, note: string): SaveLiveWarning[] {
  const draft = draftRowOf(db, root);
  if (!draft || root.status !== "published") return [];
  draft.kind = "history";
  draft.change_note = note;
  draft.is_preview = false;
  return [{ path: "", code: "draft_kept_as_history", params: { revision_id: draft.id, version: draft.version } }];
}

export function deletePage(db: MockDb, id: string, params: Params, ifMatch: string | null) {
  const confirm = confirmParam(params);
  const root = findRoot(db, id);
  requireMatch(ifMatch, root);
  if (working(db, root).page.is_home) throw invalidState("is_home");
  if (root.is_system) throw invalidState("system_page");
  if (isTrashed(root)) return { data: null, etag: etagOfPage(root) };
  const warnings = referenced(db, root, confirm);
  const stamp = touch(db, root);
  if (root.status === "published") {
    warnings.push(...keepDraftAsHistory(db, root, "unpublish"));
    root.unpublished_at = stamp;
    root.status = "archived";
  }
  root.deleted_at = stamp;
  return { data: { aggregate: stampOf(db, root), warnings }, etag: etagOfPage(root) };
}

export function restorePage(db: MockDb, id: string, ifMatch: string | null) {
  const root = findRoot(db, id);
  requireMatch(ifMatch, root);
  if (!isTrashed(root)) throw invalidState("not_trashed");
  const snap = working(db, root);
  const errors: ApiFieldError[] = [];
  if (pathTaken(db, snap.page.path, root.id)) errors.push({ in: "body", path: "/path", code: "duplicate", params: { reason: "page" } });
  if (keyTaken(db, snap.page.key, root.id)) errors.push({ in: "body", path: "/key", code: "duplicate" });
  if (errors.length) throw duplicate(errors);
  touch(db, root);
  root.deleted_at = null;
  root.status = "draft";
  return { data: writeResult(db, root), etag: etagOfPage(root) };
}

export function setHome(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
  const root = findRoot(db, id);
  requireMatch(ifMatch, root);
  if (body !== undefined && body !== null && !isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const input = (body ?? {}) as Record<string, unknown>;
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(input)) if (k !== "previous_home_path") errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  if (input.previous_home_path !== undefined) errors.push(...pathErrors(input.previous_home_path, "/previous_home_path"));
  if (errors.length) throw validationFailed(errors);
  if (working(db, root).page.is_home) {
    return { data: { page: writeResult(db, root), previous_home: null, aggregates: [stampOf(db, root)] }, etag: etagOfPage(root) };
  }
  if (isTrashed(root)) throw invalidState("trashed");
  if (root.status !== "published") throw invalidState("not_published");
  const old = db.pages.find((p) => !isTrashed(p) && working(db, p).page.is_home);
  const previousPath = typeof input.previous_home_path === "string" ? input.previous_home_path : old ? `/${old.live.page.key.replace(/_/g, "-")}` : "";
  if (old && db.pages.some((p) => p.id !== old.id && p.id !== root.id && !isTrashed(p) && working(db, p).page.path === previousPath)) {
    throw duplicate([{ in: "body", path: "/previous_home_path", code: "duplicate" }]);
  }
  const patch = (target: MockPageRoot, isHome: boolean, path: string) => {
    const snaps = [target.live, draftRowOf(db, target)?.snapshot as unknown as MockPageSnapshot | undefined].filter(Boolean) as MockPageSnapshot[];
    for (const s of snaps) {
      s.page.is_home = isHome;
      s.page.path = path;
    }
    touch(db, target);
  };
  if (old) patch(old, false, previousPath);
  patch(root, true, "/");
  return {
    data: {
      page: writeResult(db, root),
      previous_home: old ? { id: old.id, key: old.live.page.key, path: previousPath, lock_version: old.lock_version } : null,
      aggregates: [stampOf(db, root), ...(old ? [stampOf(db, old)] : [])],
    },
    etag: etagOfPage(root),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Publish engine (05 12.7)
// ---------------------------------------------------------------------------------------------------------------
export function validateForPublish(db: MockDb, root: MockPageRoot): { blockers: PublishIssue[]; warnings: PublishIssue[] } {
  const snap = working(db, root);
  const blockers: PublishIssue[] = [];
  const warnings: PublishIssue[] = [];
  const def = DEFAULT_LOCALE_CODE;
  const template = TEMPLATE_DEFS.find((t) => t.key === snap.page.template);

  // root + translations
  if (!template) blockers.push(issue("/template", "not_in_enum", { expected: TEMPLATE_DEFS.map((t) => t.key) }));
  // Checked again at publish: the draft of another page can hold the same path (the save only sees the live rows).
  if (db.pages.some((p) => p.id !== root.id && !isTrashed(p) && p.live.page.path === snap.page.path)) {
    blockers.push(issue("/path", "duplicate", { reason: "page" }));
  }
  const dflt = snap.translations.find((t) => t.locale_code === def);
  if (blank(dflt?.title)) blockers.push(issue(`/translations/${def}/title`, "empty_default_locale", { locale: def }));
  if (blank(dflt?.seo_title)) blockers.push(issue(`/translations/${def}/seo_title`, "empty_default_locale", { locale: def }));
  const missingBy = sectionsMissing(snap);
  for (const code of MOCK_ACTIVE_LOCALE_CODES) {
    if (code === def) continue;
    const t = snap.translations.find((x) => x.locale_code === code);
    const missing = (blank(t?.title) ? 1 : 0) + (blank(t?.seo_title) ? 1 : 0) + (missingBy[code] ?? 0);
    if (missing > 0) warnings.push(issue(`/translations/${code}`, "translation_incomplete", { locale: code, missing }, false));
  }
  for (const t of snap.translations) {
    if (t.seo_title && [...t.seo_title].length > 60) warnings.push(issue(`/translations/${t.locale_code}/seo_title`, "serp_title_long", { length: [...t.seo_title].length, recommended: 60 }, false));
    if (t.seo_description && [...t.seo_description].length > 160) warnings.push(issue(`/translations/${t.locale_code}/seo_description`, "serp_description_long", { length: [...t.seo_description].length, recommended: 160 }, false));
  }

  // sections, in order
  const ordered = snap.sections.slice().sort((a, b) => a.sort_order - b.sort_order);
  ordered.forEach((s, index) => {
    const base = `/sections/${s.public_id}`;
    const params = { section_id: s.id, section_key: s.section_type, section_index: index };
    const type = SECTION_TYPE_FIXTURES[s.section_type];
    // SS-2 / 18.11.2: a reference needs its shared section to be live (the view hides it otherwise); its props are `{}` and are never checked here (SS-12).
    if (s.shared_section_id !== null) {
      const state = sharedState(db, s.shared_section_id);
      const refParams = { ...params, ref_type: "cms_shared_sections", ref_id: s.shared_section_id, shared_state: state };
      if (state === "missing") blockers.push(issue(`${base}/shared_section_id`, "unknown_reference", refParams));
      else if (s.is_visible && state === "trashed") blockers.push(issue(`${base}/shared_section_id`, "unknown_reference", refParams));
      else if (s.is_visible && state !== "published") blockers.push(issue(`${base}/shared_section_id`, "reference_not_published", refParams));
      else if (!s.is_visible && state !== "published") warnings.push(issue(base, "section_hidden_unchecked", params, false));
      return;
    }
    const found: PublishIssue[] = [];
    const found_w: PublishIssue[] = [];
    if (!type) found.push(issue(`${base}/section_type`, "section_type_unknown", params));
    // references (checked for hidden sections too, so a later apply would not fail on a foreign key)
    const refs: PublishIssue[] = [];
    deepFind(s.props, "page_id", `${base}/props`, (v, pointer) => {
      if (typeof v !== "number") return;
      const target = db.pages.find((p) => p.id === v);
      if (!target || isTrashed(target)) refs.push(issue(pointer, "unknown_reference", { ...params, ref_type: "pages", ref_id: v }));
      else if (target.status !== "published") found_w.push(issue(pointer, "link_page_not_published", { ...params, ref_id: v }, false));
    });
    deepFind(s.props, "media_id", `${base}/props`, (v, pointer) => {
      if (typeof v !== "number") return;
      const asset = db.assets.find((a) => a.id === v && !a.deleted_at);
      if (!asset) refs.push(issue(pointer, "unknown_reference", { ...params, ref_type: "media_assets", ref_id: v }));
    });
    const hiddenBlockers: PublishIssue[] = [];
    deepFind(s.props, "album_id", `${base}/props`, (v, pointer) => {
      if (typeof v !== "number") return;
      const album = db.albums.find((a) => a.id === v && !a.deleted_at);
      if (!album) refs.push(issue(pointer, "unknown_reference", { ...params, ref_type: "albums", ref_id: v }));
      else if (album.status !== "published") hiddenBlockers.push(issue(pointer, "reference_not_published", { ...params, ref_type: "albums", ref_id: v }));
    });
    if (type) {
      const result = computeCompleteness(type.json_schema, s.props, [def]);
      for (const leaf of result[def]?.missing ?? []) {
        hiddenBlockers.push(issue(`${base}/props${leaf.path}`, "empty_default_locale", { ...params, locale: def }));
      }
    }
    blockers.push(...found, ...refs);
    if (s.is_visible) {
      blockers.push(...hiddenBlockers);
      warnings.push(...found_w);
    } else if (hiddenBlockers.length > 0) {
      // PG-7: a hidden section skips the publish-level rules; one warning tells that it would have blocked.
      warnings.push(issue(base, "section_hidden_unchecked", params, false));
    }
  });

  // template rules
  if (template) {
    // A reference to a shared section never fills a required slot (SS-12).
    const visible = ordered.filter((s) => s.is_visible && s.shared_section_id === null);
    for (const r of template.required) {
      const count = visible.filter((s) => r.section_type_keys.includes(s.section_type)).length;
      if (count < r.min) {
        blockers.push(issue("/sections", "template_violation", { rule: r.kind === "group" ? "hero_required" : "section_required", template: template.key, section_key: r.section_type_keys[0] }));
      }
    }
  }
  return { blockers, warnings };
}

function blockedError(blockers: PublishIssue[], warnings: PublishIssue[]) {
  const shown = blockers.slice(0, MAX_ISSUES);
  return fail(422, "PUBLISH_BLOCKED", `Cannot publish: ${blockers.length} item(s) must be fixed first.`, {
    errors: shown,
    details: { blocker_count: blockers.length, truncated: blockers.length > MAX_ISSUES, warning_count: warnings.length, warnings: warnings.slice(0, MAX_ISSUES) },
  });
}

export function publishPage(db: MockDb, id: string, params: Params, body: unknown, ifMatch: string | null) {
  rejectUnknown(params, ["dry_run"]);
  const dryRun = boolParam(params, "dry_run") ?? false;
  const root = findRoot(db, id);
  requireMatch(ifMatch, root);
  if (body !== undefined && body !== null && !isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const input = (body ?? {}) as Record<string, unknown>;
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(input)) if (k !== "change_note") errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  if (input.change_note !== undefined && (typeof input.change_note !== "string" || [...input.change_note].length > 200)) errors.push({ in: "body", path: "/change_note", code: "too_long", params: { max: 200 } });
  if (errors.length) throw validationFailed(errors);
  trashedCheck(root);
  if (root.status === "published" && !hasDraft(db, root)) throw invalidState("nothing_to_publish");

  const { blockers, warnings } = validateForPublish(db, root);
  if (blockers.length > 0) throw blockedError(blockers, warnings);
  if (dryRun) return { data: { publishable: true as const, warnings }, etag: undefined };

  const stamp = touch(db, root);
  const note = typeof input.change_note === "string" && input.change_note ? input.change_note : null;
  const draft = hasDraft(db, root) ? draftRowOf(db, root) : undefined;
  const oldPath = root.live.page.path;
  const wasPublished = root.status === "published" && Boolean(draft);
  let published: StoredRevision;
  if (draft) {
    // The draft's rows go live (not `key`, `is_home`, `is_system`), the draft row becomes the `published` row.
    const snap = draft.snapshot as unknown as MockPageSnapshot;
    const keep = { key: root.live.page.key, is_home: root.live.page.is_home };
    root.live = structuredClone(snap);
    Object.assign(root.live.page, keep);
    draft.kind = "published";
    draft.change_note = note;
    published = draft;
  } else {
    published = pushRevision(db, "pages", root.id, "cms.pages", "published", structuredClone(root.live) as unknown as Record<string, unknown>, note, stamp, MOCK_USER);
  }
  root.status = "published";
  root.published_at = stamp;
  root.first_published_at ??= stamp;
  root.unpublished_at = null;
  // 14.12: a published page whose live path moved gets a 301 from the old path (all languages) - or says why not.
  const moves: PathMove[] = wasPublished && oldPath !== root.live.page.path ? [{ warningPath: "/path", source: oldPath, target: root.live.page.path, localeCode: null, kind: "page" }] : [];
  const autoWarnings = autoRedirectWarnings(db, moves);
  const result = { ...writeResult(db, root, [...warnings, ...autoWarnings].map((w) => ({ path: w.path, code: w.code, params: w.params }))), published_revision: { id: published.id, version: published.version } };
  return { data: result, etag: etagOfPage(root) };
}

export function unpublishPage(db: MockDb, id: string, params: Params, ifMatch: string | null) {
  const confirm = confirmParam(params);
  const root = findRoot(db, id);
  requireMatch(ifMatch, root);
  trashedCheck(root);
  if (root.status !== "published" && root.status !== "scheduled") throw invalidState("not_published");
  if (working(db, root).page.is_home) throw invalidState("is_home");
  const warnings = referenced(db, root, confirm);
  const stamp = touch(db, root);
  warnings.push(...keepDraftAsHistory(db, root, "unpublish"));
  root.status = "archived";
  root.unpublished_at = stamp;
  return { data: writeResult(db, root, warnings), etag: etagOfPage(root) };
}

export function discardDraft(db: MockDb, id: string, ifMatch: string | null) {
  const root = findRoot(db, id);
  requireMatch(ifMatch, root);
  trashedCheck(root);
  const draft = hasDraft(db, root) ? draftRowOf(db, root) : undefined;
  if (!draft) throw invalidState("no_draft");
  draft.kind = "history";
  draft.change_note = "discarded";
  draft.is_preview = false;
  touch(db, root);
  return { data: writeResult(db, root), etag: etagOfPage(root) };
}

// ---------------------------------------------------------------------------------------------------------------
// Revisions (05 12.8)
// ---------------------------------------------------------------------------------------------------------------
const KINDS = ["draft", "published", "history", "restore"];

function liveRevisionId(db: MockDb, root: MockPageRoot): number | null {
  if (root.status !== "published") return null;
  const rows = revList(db, root).filter((r) => r.kind === "published");
  return rows.length ? rows.reduce((a, b) => (b.version > a.version ? b : a)).id : null;
}

export function listPageRevisions(db: MockDb, id: string, params: Params) {
  rejectUnknown(params, ["page", "limit", "kind", "include_preview", "sort"]);
  const root = findRoot(db, id);
  const errors: ApiFieldError[] = [];
  const kinds = params.get("kind")?.split(",").filter(Boolean);
  if (kinds && (kinds.length > 4 || kinds.some((k) => !KINDS.includes(k)))) errors.push({ in: "query", path: "/kind", code: "not_in_enum", params: { expected: KINDS } });
  const sort = params.get("sort") ?? "-version";
  if (sort !== "-version" && sort !== "version") errors.push({ in: "query", path: "/sort", code: "not_in_enum" });
  const includePreview = boolParam(params, "include_preview") ?? false;
  if (errors.length) throw validationFailed(errors);
  const live = liveRevisionId(db, root);
  let rows = revList(db, root).slice();
  if (kinds?.length) rows = rows.filter((r) => kinds.includes(r.kind));
  // Preview rows (`history` with `change_note = "preview"`) are hidden unless asked for (Q-A15).
  if (!includePreview) rows = rows.filter((r) => !r.is_preview);
  rows.sort((a, b) => (sort === "version" ? a.version - b.version : b.version - a.version));
  const summaries: RevisionSummary[] = rows.map(({ entity: _e, snapshot: _s, ...summary }) => {
    void _e;
    void _s;
    return { ...summary, is_live: summary.id === live };
  });
  return paginate(summaries, params);
}

export function getPageRevision(db: MockDb, id: string, revId: string) {
  const root = findRoot(db, id);
  const rev = revList(db, root).find((r) => String(r.id) === revId);
  if (!rev) throw notFound();
  return { ...rev, entity: { type: "cms.pages", id: root.id, key: root.live.page.key }, is_live: rev.id === liveRevisionId(db, root) };
}

export function restorePageRevision(db: MockDb, id: string, revId: string, body: unknown, ifMatch: string | null) {
  const root = findRoot(db, id);
  const rev = revList(db, root).find((r) => String(r.id) === revId);
  if (!rev) throw notFound();
  requireMatch(ifMatch, root);
  if (body !== undefined && body !== null && !isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const input = (body ?? {}) as Record<string, unknown>;
  const bodyErrors: ApiFieldError[] = Object.keys(input).filter((k) => k !== "change_note").map((k) => ({ in: "body" as const, path: `/${k}`, code: "unknown_field" }));
  if (input.change_note !== undefined && (typeof input.change_note !== "string" || [...input.change_note].length > 200)) bodyErrors.push({ in: "body", path: "/change_note", code: "too_long", params: { max: 200 } });
  if (bodyErrors.length) throw validationFailed(bodyErrors);
  trashedCheck(root);
  if (rev.schema_version > 1) throw invalidState("snapshot_incompatible");
  const restoredFrom = { revision_id: rev.id, version: rev.version };
  const snapshot = rev.snapshot as unknown as MockPageSnapshot;
  const current = working(db, root);
  // The current draft itself, or a snapshot equal to the working copy: nothing to do.
  if (rev.kind === "draft" || JSON.stringify(snapshot) === JSON.stringify(current)) {
    return { data: { ...writeResult(db, root), restored_from: restoredFrom }, etag: etagOfPage(root) };
  }

  // All or nothing: references first.
  const errors: ApiFieldError[] = [];
  for (const s of snapshot.sections) {
    if (!SECTION_TYPE_FIXTURES[s.section_type]) errors.push({ in: "entity", path: `/sections/${s.public_id}/section_type`, code: "section_type_unknown" });
    // 18.9.4: a revision that names a shared section which is gone or in the trash can not come back.
    if (s.shared_section_id !== null && ["missing", "trashed"].includes(sharedState(db, s.shared_section_id))) {
      errors.push({ in: "entity", path: `/sections/${s.public_id}/shared_section_id`, code: "unknown_reference", params: { ref_type: "cms_shared_sections", ref_id: s.shared_section_id } });
    }
    deepFind(s.props, "page_id", `/sections/${s.public_id}/props`, (v, pointer) => {
      const target = typeof v === "number" ? db.pages.find((p) => p.id === v) : undefined;
      if (!target || isTrashed(target)) errors.push({ in: "entity", path: pointer, code: "unknown_reference" });
    });
    deepFind(s.props, "media_id", `/sections/${s.public_id}/props`, (v, pointer) => {
      if (typeof v === "number" && !db.assets.some((a) => a.id === v && !a.deleted_at)) errors.push({ in: "entity", path: pointer, code: "unknown_reference" });
    });
  }
  if (errors.length) throw validationFailed(errors);
  const keepPath = current.page.is_home || current.page.key === "blog";
  const restoredPath = keepPath ? current.page.path : snapshot.page.path;
  if (pathTaken(db, restoredPath, root.id)) throw duplicate([{ in: "entity", path: "/page/path", code: "duplicate" }]);

  const stamp = tick(db);
  const note = (typeof input.change_note === "string" && input.change_note) || `restore of v${rev.version}`;
  pushRevision(db, "pages", root.id, "cms.pages", "restore", structuredClone(current) as unknown as Record<string, unknown>, note, stamp, MOCK_USER);
  const next = structuredClone(snapshot);
  // Not restored: key, is_home, is_system, parent_id, and the path of the home / blog page.
  next.page.key = current.page.key;
  next.page.is_home = current.page.is_home;
  next.page.path = restoredPath;
  if (root.status === "published") {
    const draft = draftRowOf(db, root);
    if (draft) draft.snapshot = next as unknown as Record<string, unknown>;
    else pushRevision(db, "pages", root.id, "cms.pages", "draft", next as unknown as Record<string, unknown>, null, stamp, MOCK_USER);
  } else {
    root.live = next;
  }
  commitWrite(root, stamp);
  return { data: { ...writeResult(db, root), restored_from: restoredFrom }, etag: etagOfPage(root) };
}

// The change the conflict scenario of the browser click-through needs: somebody else saved the page.
export function touchPageAsSomeoneElse(db: MockDb, id: number): number {
  const root = db.pages.find((p) => p.id === id);
  if (!root) throw notFound();
  touch(db, root);
  root.updated_by = { id: 4, name: "Somchai Vongsa" };
  return root.lock_version;
}
