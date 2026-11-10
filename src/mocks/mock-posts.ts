// In-memory model of the posts endpoints (doc/05 section 13.3, doc/api/openapi-admin.yaml: listPosts, createPost,
// checkPostSlug, getPost, updatePost, deletePost, restorePost, replacePostMedia, publishPost, unpublishPost,
// discardPostDraft, list/get/restore PostRevision), strict like the backend: an unknown query parameter or body field is a
// 422, no `If-Match` is 428, a stale one 409 `CONFLICT_LOCK_VERSION`, `INVALID_STATE` carries `details.reason`, a refused
// publish is `PUBLISH_BLOCKED` with JSON pointers (also `/translations/<l>/slug` for a slug taken by another post's real
// row), the own-vs-any rules of PT-2 / PT-3 are 403s, `published_at` in the future is refused, the gallery holds 60 at most.
//
// A post is stored like a page (see `mock-pages.ts`): the REAL rows (`live`, written directly while the post is not
// published) and, for a published post with pending edits, a `draft` revision holding the working copy.
//
// Seeded from the real seed: post 1 is the one post of the portal bundle (created_by null: a seeded row). INVENTED: posts 2 - 8
// (see `seedPosts`), their authors (Noy Keomany is "me", Somchai Vongsa and Dara Phommachan are made up), the tags and
// the history. The signed-in user's role for this model (`db.postRole`) is an editor unless a test / the browser changes it.
import musicNight from "@/components/schema-form/fixtures/examples/post.music-night-under-the-stars.json";
import {
  LABEL_RECOMMENDED,
  MAX_BODY_BYTES,
  MAX_EXCERPT,
  MAX_GALLERY_ALT,
  MAX_GALLERY_CAPTION,
  MAX_GALLERY_DESCRIPTION,
  MAX_GALLERY_HEADING,
  MAX_GALLERY_ITEMS,
  MAX_HERO_ALT,
  MAX_LABEL,
  MAX_LOCATION_LABEL,
  MAX_POST_TITLE,
  MAX_SEO_DESCRIPTION,
  MAX_SEO_TITLE,
  MAX_SLUG,
  MAX_TAGS,
  SERP_DESCRIPTION,
  SERP_TITLE,
  SLUG_PATTERN,
  jsonBytes,
  slugify,
} from "@/lib/posts";
import {
  DEFAULT_LOCALE_CODE,
  MOCK_ACTIVE_LOCALE_CODES,
  MOCK_LOCALE_CODES,
  MOCK_USER,
  boolParam,
  duplicate,
  etagOf,
  fail,
  forbidden,
  invalidState,
  keyOf,
  lockConflict,
  micros,
  notFound,
  paginate,
  preconditionRequired,
  pushRevision,
  rejectUnknown,
  tick,
  validationFailed,
  type MockDb,
  type MockPostMedia,
  type MockPostRole,
  type MockPostRoot,
  type MockPostSnapshot,
  type MockPostTranslation,
  type Params,
  type StoredRevision,
} from "@/mocks/mock-core";
import { draftRowOf as pageDraftRow, isTrashed as pageIsTrashed } from "@/mocks/mock-pages";
import type { ApiFieldError } from "@/types/api";
import type { SaveLiveWarning, UserRef } from "@/types/media";
import type { PostDetail, PostListItem, PostMediaItem, PostTranslation, PostTranslationStatus } from "@/types/posts";
import { autoRedirectWarnings, type PathMove } from "@/mocks/mock-auto-redirects";
import { clearSchedule, makeReviewSchedule, scheduleMember, scheduledAtOf } from "@/mocks/mock-review-schedule";
import type { AggregateStamp, PublishIssue } from "@/types/publishing";
import type { RevisionSummary } from "@/types/revisions";

const TRASH_DAYS = 30;
const MAX_ISSUES = 100;
const SEED_AT = micros(Date.UTC(2026, 9, 26, 9, 0, 0), 170);
const SOMCHAI: UserRef = { id: 4, name: "Somchai Vongsa" };
// INVENTED author (the seed has none, authors are entered by an administrator).
const DARA: UserRef = { id: 7, name: "Dara Phommachan" };
const TEXT_FIELDS = ["slug", "title", "excerpt", "label", "location_label", "body", "gallery_heading", "gallery_description", "hero_alt", "seo_title", "seo_description"] as const;
const TRANSLATION_FIELDS = [...TEXT_FIELDS, "og_image_id", "is_enabled"] as const;
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === "";
const postPublicId = (id: number) => `0192d3a4-7c1e-7b52-9d0a-3f5e2a1b6a${String(id).padStart(2, "0")}`;
const doc = (...paragraphs: string[]): Record<string, unknown> => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});
// A body has "text" when some node holds a non-blank text.
function bodyHasText(body: unknown): boolean {
  if (Array.isArray(body)) return body.some(bodyHasText);
  if (!isObject(body)) return false;
  if (body.type === "text" && typeof body.text === "string" && body.text.trim() !== "") return true;
  return bodyHasText(body.content);
}

// ---------------------------------------------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------------------------------------------
function translation(code: string, title: string, rest: Partial<MockPostTranslation> = {}): MockPostTranslation {
  return {
    locale_code: code,
    slug: slugify(title) || `post-${code}`,
    title,
    excerpt: null,
    label: null,
    location_label: null,
    body: null,
    gallery_heading: null,
    gallery_description: null,
    hero_alt: null,
    seo_title: null,
    seo_description: null,
    og_image_id: null,
    is_enabled: true,
    ...rest,
  };
}

export function seedPosts(db: Pick<MockDb, "nextPostMediaId">): MockPostRoot[] {
  const nextMedia = () => db.nextPostMediaId++;
  const gallery = (rows: Array<{ media_id: number; alt?: string; caption?: string }>): MockPostMedia[] =>
    rows.map((r, i) => ({
      id: nextMedia(),
      media_id: r.media_id,
      sort_order: i,
      translations: { la: { alt: r.alt ?? null, caption: r.caption ?? null }, en: { alt: r.alt ?? null, caption: r.caption ?? null } },
    }));
  const root = (id: number, status: MockPostRoot["status"], by: UserRef, live: MockPostSnapshot, extra: Partial<MockPostRoot> = {}): MockPostRoot => ({
    id,
    public_id: postPublicId(id),
    status,
    lock_version: 1,
    published_at: status === "published" ? micros(Date.UTC(2026, 9, 22, 9, 0, 0), 300 + id) : null,
    first_published_at: status === "published" || status === "archived" ? micros(Date.UTC(2026, 9, 22, 9, 0, 0), 300 + id) : null,
    unpublished_at: null,
    created_by: by,
    updated_by: by,
    created_at: micros(Date.UTC(2026, 9, 21, 9, 0, 0), 300 + id),
    updated_at: micros(Date.UTC(2026, 9, 22, 9, 0, 0), 300 + id),
    deleted_at: null,
    live,
    ...extra,
  });

  // 1: the real seeded post (portal bundle). created_by is null: a seeded row has no author.
  const ex = musicNight as unknown as {
    post: { category_id: number; hero_media_id: number; published_at: string };
    translations: Array<Record<string, unknown> & { locale_code: string }>;
    media: Array<{ media_id: number; translations: Array<{ locale_code: string; alt: string | null; caption: string | null }> }>;
  };
  const music = root(
    1,
    "published",
    null,
    {
      post: { category_id: ex.post.category_id, hero_media_id: ex.post.hero_media_id, teaser_media_id: null, is_featured: false },
      tag_ids: [2],
      // The title is the short name the earlier mocks (taxonomy, post picker, media usages) gave this post, not the bundle's
      // "... - a recap": those tests and screens name it that way.
      translations: ex.translations.map((t) => ({ ...translation(t.locale_code, String(t.title)), ...(t as Partial<MockPostTranslation>), title: "Music night under the stars" })),
      media: ex.media.map((m, i) => ({
        id: nextMedia(),
        media_id: m.media_id,
        sort_order: i,
        translations: Object.fromEntries(m.translations.map((x) => [x.locale_code, { alt: x.alt, caption: x.caption }])),
      })),
    },
    { published_at: ex.post.published_at, first_published_at: ex.post.published_at, created_at: SEED_AT, updated_at: SEED_AT }
  );

  // INVENTED from here. 2: a published post of mine without a gallery.
  const paddle = root(2, "published", MOCK_USER, {
    post: { category_id: 3, hero_media_id: 11, teaser_media_id: null, is_featured: false },
    tag_ids: [],
    translations: [
      translation("la", "Sunrise paddle on the Mekong", { slug: "sunrise-paddle-on-the-mekong", excerpt: "Two hours on flat water before the town wakes up.", seo_title: "Sunrise paddle on the Mekong", body: doc("We left the pier at 5:40.") }),
      translation("en", "Sunrise paddle on the Mekong", { slug: "sunrise-paddle-on-the-mekong", excerpt: "Two hours on flat water before the town wakes up.", seo_title: "Sunrise paddle on the Mekong", body: doc("We left the pier at 5:40.") }),
    ],
    media: [],
  });

  // 3: my draft (hiking category and the tag "trail", as the taxonomy rules of the seed expect: a DRAFT post only).
  const notes = root(3, "draft", MOCK_USER, {
    post: { category_id: 5, hero_media_id: null, teaser_media_id: null, is_featured: false },
    tag_ids: [1],
    translations: [translation("la", "Unfinished trail notes", { slug: "unfinished-trail-notes", body: doc("Notes from the ridge, not finished.") })],
    media: [],
  });

  // 4: published by Somchai with a pending draft whose English slug is the REAL slug of post 5: saving it was fine (the
  // save only sees real rows), publishing it is refused (`duplicate` at /translations/en/slug).
  const gear = root(
    4,
    "published",
    SOMCHAI,
    {
      post: { category_id: 2, hero_media_id: 8, teaser_media_id: null, is_featured: false },
      tag_ids: [],
      translations: [
        translation("la", "Dry season gear list", { slug: "dry-season-gear-list", excerpt: "What to pack for the dry months.", seo_title: "Dry season gear list", body: doc("Pack light, bring a hat.") }),
        translation("en", "Dry season gear list", { slug: "dry-season-gear-list", excerpt: "What to pack for the dry months.", seo_title: "Dry season gear list", body: doc("Pack light, bring a hat.") }),
      ],
      media: gallery([{ media_id: 6, alt: "Hikers climbing a volcanic ridge trail" }, { media_id: 7, alt: "Misty forest trail between tall trees" }, { media_id: 8, alt: "Orange backpack resting in a rainy forest" }]),
    },
    { lock_version: 1 }
  );

  // 5: Dara's draft that publishes with warnings (the English SEO title is missing).
  const checklist = root(5, "draft", DARA, {
    post: { category_id: 4, hero_media_id: 6, teaser_media_id: null, is_featured: false },
    tag_ids: [],
    translations: [
      translation("la", "Gear checklist for beginners", { slug: "gear-checklist", excerpt: "A short list for your first overnight.", seo_title: "Gear checklist for beginners", seo_description: "Everything for a first night out.", body: doc("Start with the boots.") }),
      translation("en", "Gear checklist for beginners", { slug: "gear-checklist", excerpt: "A short list for your first overnight.", body: doc("Start with the boots.") }),
    ],
    media: [],
  });

  // 6: in the trash.
  const rules = root(6, "archived", MOCK_USER, {
    post: { category_id: 2, hero_media_id: 7, teaser_media_id: null, is_featured: false },
    tag_ids: [],
    translations: [translation("la", "Old camp rules", { slug: "old-camp-rules", excerpt: "Superseded.", seo_title: "Old camp rules" }), translation("en", "Old camp rules", { slug: "old-camp-rules" })],
    media: [],
  }, { deleted_at: micros(Date.UTC(2026, 9, 20, 9, 0, 0), 306), unpublished_at: micros(Date.UTC(2026, 9, 20, 9, 0, 0), 306) });

  // 7: mine, every kind of blocker once: no category, a hero without alt text, no excerpt / SEO title, a gallery picture
  // without alt text, a label that is too long for the blog strip (a warning).
  const night = root(7, "draft", MOCK_USER, {
    post: { category_id: null, hero_media_id: 1, teaser_media_id: null, is_featured: false },
    tag_ids: [1],
    translations: [translation("la", "Night hike (draft)", { slug: "night-hike", label: "A very long label for a hike", body: null })],
    media: gallery([{ media_id: 10 }]),
  });

  // 8: Somchai's draft that is ready to publish (for an author who does not own it: read only / translate).
  const camp = root(8, "draft", SOMCHAI, {
    post: { category_id: 2, hero_media_id: 5, teaser_media_id: null, is_featured: false },
    tag_ids: [],
    translations: [
      translation("la", "Camp kitchen basics", { slug: "camp-kitchen-basics", excerpt: "Cooking outdoors without the fuss.", seo_title: "Camp kitchen basics", body: doc("A stove, a pot, a plan.") }),
      translation("en", "Camp kitchen basics", { slug: "camp-kitchen-basics", excerpt: "Cooking outdoors without the fuss.", seo_title: "Camp kitchen basics", body: doc("A stove, a pot, a plan.") }),
    ],
    media: [],
  });
  return [music, paddle, notes, gear, checklist, rules, night, camp];
}

// The history the screens open. Post 4 has a pending draft (new title, the slug of post 5), a history row and a preview row.
export function seedPostRevisions(db: MockDb) {
  const who = (id: number, name: string): UserRef => ({ id, name });
  const base = Date.UTC(2026, 9, 21, 8, 0, 0);
  for (const post of db.posts.filter((p) => p.status === "published")) {
    pushRevision(db, "posts", post.id, "cms.posts", "published", structuredClone(post.live), null, post.published_at ?? SEED_AT, post.created_by ?? who(4, "Somchai Vongsa"));
  }
  const gear = db.posts.find((p) => p.id === 4)!;
  const old = structuredClone(gear.live);
  old.translations.forEach((t) => (t.title = "Gear list (old)"));
  pushRevision(db, "posts", 4, "cms.posts", "history", old, "autosave", micros(base + 3_600_000), who(4, "Somchai Vongsa"));
  const draft = structuredClone(gear.live);
  draft.translations.forEach((t) => (t.title = "Dry season gear list (2026)"));
  draft.translations.find((t) => t.locale_code === "en")!.slug = "gear-checklist";
  draft.translations.find((t) => t.locale_code === "la")!.body = doc("Pack light, bring a hat and a spare pair of socks.");
  pushRevision(db, "posts", 4, "cms.posts", "draft", draft, null, micros(base + 10_800_000), who(6, "Noy Keomany"));
  gear.lock_version = 3;
  gear.updated_at = micros(base + 10_800_000, 11);
  gear.updated_by = who(6, "Noy Keomany");
  // A snapshot written by a newer schema: restoring it is refused (`snapshot_incompatible`).
  pushRevision(db, "posts", 1, "cms.posts", "history", { future: true }, null, micros(base + 2_500_000), null, 99, 1);
}

// ---------------------------------------------------------------------------------------------------------------
// Roles (05 13.3.2, 13.3.3)
// ---------------------------------------------------------------------------------------------------------------
export const roleOf = (db: MockDb): MockPostRole => (db.translateOnly.includes("posts") ? "translator" : db.postRole);
export const setPostRole = (db: MockDb, role: MockPostRole) => {
  db.postRole = role;
};
const isOwner = (root: MockPostRoot) => root.created_by !== null && root.created_by.id === MOCK_USER.id;
// `update`, or `update_own` of my own post.
const canUpdate = (db: MockDb, root: MockPostRoot) => roleOf(db) === "editor" || (roleOf(db) === "author" && isOwner(root));
const deny = (action: string, method: string, path: string) => forbidden(`cms.blog:${action} ${method} ${path}`);
// BR-10 (doc/01): while a post is `in_review` or `scheduled`, a caller who holds `update_own` but not `update` (the `author` role) may not change it, not even
// to translate it (403 on PATCH, PUT media and discard-draft).
const authorLocked = (db: MockDb, root: MockPostRoot) => roleOf(db) === "author" && (root.status === "in_review" || root.status === "scheduled");

// ---------------------------------------------------------------------------------------------------------------
// Working copy and views
// ---------------------------------------------------------------------------------------------------------------
const revList = (db: MockDb, root: MockPostRoot) => (db.revisions[keyOf("posts", root.id)] ??= []);
export const postDraftRow = (db: MockDb, root: MockPostRoot): StoredRevision | undefined => revList(db, root).find((r) => r.kind === "draft");
export function postWorking(db: MockDb, root: MockPostRoot): MockPostSnapshot {
  return (postDraftRow(db, root)?.snapshot as unknown as MockPostSnapshot | undefined) ?? root.live;
}
const hasDraft = (db: MockDb, root: MockPostRoot) => root.status === "published" && Boolean(postDraftRow(db, root));
export const postIsTrashed = (root: MockPostRoot) => root.deleted_at !== null;
const etagOfPost = (root: MockPostRoot) => etagOf(String(root.lock_version));

function titleOf(snapshot: MockPostSnapshot, locale: string): { title: string | null; slug: string | null; locale: string | null } {
  const chain = [locale, DEFAULT_LOCALE_CODE, ...snapshot.translations.map((t) => t.locale_code)];
  for (const code of chain) {
    const t = snapshot.translations.find((x) => x.locale_code === code && x.title.trim() !== "");
    if (t) return { title: t.title, slug: t.slug, locale: code };
  }
  return { title: null, slug: null, locale: null };
}
export const postTitle = (root: MockPostRoot, locale = DEFAULT_LOCALE_CODE) => titleOf(root.live, locale).title ?? `#${root.id}`;

function translationStatus(snapshot: MockPostSnapshot): Record<string, PostTranslationStatus> {
  const out: Record<string, PostTranslationStatus> = {};
  for (const code of MOCK_ACTIVE_LOCALE_CODES) {
    const t = snapshot.translations.find((x) => x.locale_code === code);
    out[code] = {
      enabled: t?.is_enabled ?? false,
      title: !blank(t?.title),
      excerpt: !blank(t?.excerpt),
      seo_title: !blank(t?.seo_title),
      seo_description: !blank(t?.seo_description),
      body: bodyHasText(t?.body),
    };
  }
  return out;
}

function nameOf(kind: "categories" | "tags", db: MockDb, id: number, locale: string): string | null {
  const row = (kind === "categories" ? db.categories : db.tags).find((r) => r.id === id);
  if (!row) return null;
  const t = row.translations as Record<string, { name: string }>;
  return t[locale]?.name ?? t[DEFAULT_LOCALE_CODE]?.name ?? row.key;
}

function categoryRef(db: MockDb, id: number | null, locale: string): PostListItem["category"] {
  if (id === null) return null;
  const row = db.categories.find((c) => c.id === id);
  return row ? { id: row.id, key: row.key, name: nameOf("categories", db, id, locale) } : null;
}


export function postListItem(db: MockDb, root: MockPostRoot, locale = DEFAULT_LOCALE_CODE): PostListItem {
  const snap = postWorking(db, root);
  const title = titleOf(snap, locale);
  const trashed = postIsTrashed(root);
  const draft = hasDraft(db, root) ? postDraftRow(db, root) : undefined;
  return {
    id: root.id,
    public_id: root.public_id,
    title: title.title,
    title_locale: title.locale,
    slug: title.slug,
    category: categoryRef(db, snap.post.category_id, locale),
    author_id: snap.post.author_id ?? null,
    author_name: db.authors.find((a) => a.id === snap.post.author_id)?.display_name ?? null,
    tag_count: snap.tag_ids.length,
    hero_media_id: snap.post.hero_media_id,
    teaser_media_id: snap.post.teaser_media_id,
    is_featured: snap.post.is_featured,
    translation_status: translationStatus(snap),
    draft: draft ? { revision_id: draft.id, version: draft.version, created_at: draft.created_at, created_by: draft.created_by } : null,
    status: root.status,
    lock_version: root.lock_version,
    has_unpublished_changes: hasDraft(db, root),
    published_at: root.published_at,
    first_published_at: root.first_published_at,
    scheduled_at: scheduledAtOf(db, "posts", root.id),
    unpublished_at: root.unpublished_at,
    created_by: root.created_by,
    updated_by: root.updated_by,
    created_at: root.created_at,
    updated_at: root.updated_at,
    deleted_at: root.deleted_at,
    purge_at: trashed ? micros(Date.parse(root.deleted_at!) + TRASH_DAYS * 86_400_000, 0) : null,
  };
}

function mediaItem(db: MockDb, row: MockPostMedia): PostMediaItem {
  const asset = db.assets.find((a) => a.id === row.media_id);
  return {
    id: row.id,
    media_id: row.media_id,
    media: asset
      ? { id: asset.id, status: asset.status, original_filename: asset.original_filename, mime_type: asset.mime_type, width: asset.width, height: asset.height, url: asset.url }
      : { id: row.media_id, status: "ready" },
    sort_order: row.sort_order,
    translations: structuredClone(row.translations),
  };
}

export function postDetail(db: MockDb, root: MockPostRoot, locale = DEFAULT_LOCALE_CODE): PostDetail {
  const snap = postWorking(db, root);
  return {
    ...postListItem(db, root, locale),
    translations: Object.fromEntries(
      snap.translations.map((t) => {
        const { locale_code: _code, ...rest } = t;
        void _code;
        return [t.locale_code, structuredClone(rest) as PostTranslation];
      })
    ),
    tag_ids: [...snap.tag_ids],
    tags: snap.tag_ids.map((id) => ({ id, key: db.tags.find((t) => t.id === id)?.key ?? String(id), name: nameOf("tags", db, id, locale) })),
    media: snap.media.slice().sort((a, b) => a.sort_order - b.sort_order).map((m) => mediaItem(db, m)),
    missing_locales: MOCK_ACTIVE_LOCALE_CODES.filter((c) => blank(snap.translations.find((t) => t.locale_code === c)?.title)),
    schedule: scheduleMember(db, "posts", root.id),
  };
}

function stampOf(db: MockDb, root: MockPostRoot): AggregateStamp {
  return { entity_type: "cms.posts", id: root.id, lock_version: root.lock_version, status: root.status, has_unpublished_changes: hasDraft(db, root), updated_at: root.updated_at };
}
function writeResult(db: MockDb, root: MockPostRoot, warnings: SaveLiveWarning[] = []) {
  return { ...postDetail(db, root), aggregate: stampOf(db, root), warnings };
}

// ---------------------------------------------------------------------------------------------------------------
// References: who uses a post, a category, a tag
// ---------------------------------------------------------------------------------------------------------------
function deepFind(value: unknown, key: string, visit: (v: unknown) => void) {
  if (Array.isArray(value)) value.forEach((v) => deepFind(v, key, visit));
  else if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === key) visit(v);
      else deepFind(v, key, visit);
    }
  }
}

// `blog_strip.items[].post_id` in the live rows and the draft snapshots of the pages (PT-8: a warning, never a block).
export function postReferenceCount(db: MockDb, postId: number): number {
  let count = 0;
  for (const page of db.pages) {
    if (pageIsTrashed(page)) continue;
    const snaps = [page.live, pageDraftRow(db, page)?.snapshot as unknown as typeof page.live | undefined].filter(Boolean) as Array<typeof page.live>;
    for (const snap of snaps) {
      for (const s of snap.sections) {
        deepFind(s.props, "post_id", (v) => {
          if (v === postId) count += 1;
        });
      }
    }
  }
  return count;
}

const publishing = (p: MockPostRoot) => p.status === "published" || p.status === "scheduled";

// Posts that use a category / tag (taxonomy counts and the in-use guard of BR-19).
export function postsUsing(db: MockDb, kind: "categories" | "tags", id: number): Array<{ id: number; title: string; published: boolean }> {
  return db.posts
    .filter((p) => !postIsTrashed(p))
    .filter((p) => {
      const snap = postWorking(db, p);
      return kind === "categories" ? snap.post.category_id === id : snap.tag_ids.includes(id);
    })
    .map((p) => ({ id: p.id, title: postTitle(p), published: publishing(p) }));
}

// ---------------------------------------------------------------------------------------------------------------
// Write plumbing (same as pages)
// ---------------------------------------------------------------------------------------------------------------
export function findPost(db: MockDb, id: string): MockPostRoot {
  const root = db.posts.find((p) => String(p.id) === id);
  if (!root) throw notFound();
  return root;
}
function requireMatch(ifMatch: string | null, root: MockPostRoot) {
  if (!ifMatch) throw preconditionRequired();
  if (ifMatch !== etagOfPost(root)) throw lockConflict();
}
function touch(db: MockDb, root: MockPostRoot): string {
  const stamp = tick(db);
  root.lock_version += 1;
  root.updated_at = stamp;
  root.updated_by = MOCK_USER;
  return stamp;
}
function checkpoint(db: MockDb, root: MockPostRoot, stamp: string) {
  const list = revList(db, root);
  const latest = list.filter((r) => r.kind === "history" && !r.is_preview).reduce<number>((max, r) => Math.max(max, Date.parse(r.created_at)), 0);
  if (Date.parse(stamp) - latest < 10 * 60_000) return;
  pushRevision(db, "posts", root.id, "cms.posts", "history", structuredClone(postWorking(db, root)) as unknown as Record<string, unknown>, "autosave", stamp, MOCK_USER);
}
function beginWrite(db: MockDb, root: MockPostRoot): { snapshot: MockPostSnapshot; stamp: string } {
  const stamp = tick(db);
  checkpoint(db, root, stamp);
  if (root.status === "published" && !postDraftRow(db, root)) {
    pushRevision(db, "posts", root.id, "cms.posts", "draft", structuredClone(root.live) as unknown as Record<string, unknown>, null, stamp, MOCK_USER);
  }
  return { snapshot: postWorking(db, root), stamp };
}
function commitWrite(root: MockPostRoot, stamp: string) {
  root.lock_version += 1;
  root.updated_at = stamp;
  root.updated_by = MOCK_USER;
}
const trashedCheck = (root: MockPostRoot) => {
  if (postIsTrashed(root)) throw invalidState("trashed");
};
const issue = (path: string, code: string, params: PublishIssue["params"] = {}, blocker = true): PublishIssue =>
  blocker ? { in: "entity", path, code, params } : { path, code, params };

// Slugs of the REAL rows of the other posts (a pending draft is invisible, 05 13.3.4).
function slugOwner(db: MockDb, locale: string, slug: string, exceptId?: number): MockPostRoot | undefined {
  return db.posts.find((p) => p.id !== exceptId && !postIsTrashed(p) && p.live.translations.some((t) => t.locale_code === locale && t.slug === slug));
}
function freeSlug(db: MockDb, locale: string, base: string, exceptId?: number): string {
  let slug = base;
  for (let n = 2; slugOwner(db, locale, slug, exceptId); n++) slug = `${base.slice(0, MAX_SLUG - String(n).length - 1)}-${n}`;
  return slug;
}

// ---------------------------------------------------------------------------------------------------------------
// Body (rich text, profile `full`, PT-5)
// ---------------------------------------------------------------------------------------------------------------
const NODE_TYPES = ["paragraph", "lead", "heading", "bulletList", "orderedList", "listItem", "blockquote", "hardBreak", "image", "embed", "text"];
const MARK_TYPES = ["bold", "italic", "link"];

function bodyErrors(db: MockDb, body: unknown, base: string): ApiFieldError[] {
  const errors: ApiFieldError[] = [];
  if (body === null) return errors;
  if (!isObject(body) || body.type !== "doc") return [{ in: "body", path: base, code: "invalid_type" }];
  if (jsonBytes(body) > MAX_BODY_BYTES) errors.push({ in: "body", path: base, code: "too_long", params: { unit: "bytes", max: MAX_BODY_BYTES } });
  let leads = 0;
  const walk = (node: unknown, pointer: string, top: number | null) => {
    if (!isObject(node)) {
      errors.push({ in: "body", path: pointer, code: "invalid_type" });
      return;
    }
    if (typeof node.type !== "string" || !NODE_TYPES.includes(node.type)) {
      errors.push({ in: "body", path: pointer, code: "not_in_enum", params: { expected: NODE_TYPES } });
      return;
    }
    const attrs = isObject(node.attrs) ? node.attrs : {};
    if (node.type === "heading" && ![2, 3].includes(attrs.level as number)) errors.push({ in: "body", path: `${pointer}/attrs/level`, code: "not_in_enum", params: { expected: ["2", "3"] } });
    if (node.type === "lead") {
      leads += 1;
      if (top !== 0 || leads > 1) errors.push({ in: "body", path: pointer, code: "forbidden", params: { reason: "lead_position" } });
    }
    if (node.type === "image" && !(typeof attrs.media_id === "number" && db.assets.some((a) => a.id === attrs.media_id && !a.deleted_at))) {
      errors.push({ in: "body", path: `${pointer}/attrs/media_id`, code: "unknown_reference", params: { ref_type: "media_assets" } });
    }
    if (node.type === "embed") {
      const hosts: Record<string, RegExp> = { youtube: /^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//, vimeo: /^https:\/\/(player\.)?vimeo\.com\//, google_maps: /^https:\/\/(www\.)?google\.com\/maps/ };
      if (typeof attrs.provider !== "string" || !(attrs.provider in hosts)) errors.push({ in: "body", path: `${pointer}/attrs/provider`, code: "not_in_enum", params: { expected: Object.keys(hosts) } });
      else if (typeof attrs.url !== "string" || !hosts[attrs.provider].test(attrs.url)) errors.push({ in: "body", path: `${pointer}/attrs/url`, code: "pattern_mismatch", params: { reason: "host" } });
    }
    if (Array.isArray(node.marks)) {
      node.marks.forEach((m, j) => {
        const mark = isObject(m) ? m : {};
        if (typeof mark.type !== "string" || !MARK_TYPES.includes(mark.type)) errors.push({ in: "body", path: `${pointer}/marks/${j}`, code: "not_in_enum", params: { expected: MARK_TYPES } });
        else if (mark.type === "link") {
          const href = isObject(mark.attrs) ? mark.attrs.href : undefined;
          if (typeof href !== "string" || !/^(https:\/\/|mailto:|tel:|\/)/.test(href) || href.length > 500 || /^javascript:/i.test(href)) {
            errors.push({ in: "body", path: `${pointer}/marks/${j}/attrs/href`, code: "pattern_mismatch" });
          }
        }
      });
    }
    if (Array.isArray(node.content)) node.content.forEach((child, i) => walk(child, `${pointer}/content/${i}`, null));
  };
  if (Array.isArray(body.content)) body.content.forEach((n, i) => walk(n, `${base}/content/${i}`, i));
  return errors;
}

// ---------------------------------------------------------------------------------------------------------------
// GET /posts, GET /posts/{id}
// ---------------------------------------------------------------------------------------------------------------
const STATUSES = ["draft", "in_review", "scheduled", "published", "archived"];
const SORTS = ["updated_at", "created_at", "published_at", "title", "status", "deleted_at"];

export function listPosts(db: MockDb, params: Params) {
  rejectUnknown(params, ["page", "limit", "keyword", "locale", "status", "category_id", "tag_id", "created_by", "published_from", "published_to", "has_unpublished_changes", "trashed", "sort"]);
  const errors: ApiFieldError[] = [];
  const trashed = boolParam(params, "trashed") ?? false;
  const pending = boolParam(params, "has_unpublished_changes");
  const keyword = params.get("keyword")?.trim().toLowerCase();
  if (keyword && [...keyword].length > 100) errors.push({ in: "query", path: "/keyword", code: "too_long", params: { max: 100 } });
  const locale = params.get("locale") ?? DEFAULT_LOCALE_CODE;
  if (!(MOCK_LOCALE_CODES as readonly string[]).includes(locale)) errors.push({ in: "query", path: "/locale", code: "unknown_reference" });
  const statuses = params.get("status")?.split(",").filter(Boolean);
  if (statuses && (statuses.length > 5 || statuses.some((s) => !STATUSES.includes(s)))) errors.push({ in: "query", path: "/status", code: "not_in_enum", params: { expected: STATUSES } });
  const intParam = (name: string): number | undefined => {
    const raw = params.get(name);
    if (raw === null) return undefined;
    if (!/^[1-9]\d{0,17}$/.test(raw)) {
      errors.push({ in: "query", path: `/${name}`, code: "invalid_format" });
      return undefined;
    }
    return Number(raw);
  };
  const categoryId = intParam("category_id");
  const createdBy = intParam("created_by");
  const tagParam = params.get("tag_id");
  let tagIds: number[] | undefined;
  if (tagParam !== null) {
    if (!/^[0-9]+(,[0-9]+)*$/.test(tagParam) || tagParam.split(",").length > 5) errors.push({ in: "query", path: "/tag_id", code: "invalid_format" });
    else tagIds = tagParam.split(",").map(Number);
  }
  const dateParam = (name: string): number | undefined => {
    const raw = params.get(name);
    if (raw === null) return undefined;
    const ms = Date.parse(raw);
    if (Number.isNaN(ms) || !/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
      errors.push({ in: "query", path: `/${name}`, code: "invalid_format" });
      return undefined;
    }
    return ms;
  };
  const from = dateParam("published_from");
  const to = dateParam("published_to");
  if (from !== undefined && to !== undefined && from > to) errors.push({ in: "query", path: "/published_from", code: "out_of_range" });
  const sort = params.get("sort") ?? (trashed ? "-deleted_at" : "-updated_at");
  const m = /^(-?)([a-z_]+)$/.exec(sort);
  if (!m || !SORTS.includes(m[2])) errors.push({ in: "query", path: "/sort", code: "not_in_enum", params: { expected: SORTS } });
  if (errors.length) throw validationFailed(errors);
  // The trash needs `read` + (`delete` | `delete_own`).
  if (trashed && roleOf(db) === "translator") throw deny("delete", "GET", "/posts?trashed=true");

  let rows = db.posts.filter((p) => postIsTrashed(p) === trashed);
  // A `delete_own`-only user sees only their own trashed posts.
  if (trashed && roleOf(db) === "author") rows = rows.filter((p) => isOwner(p));
  if (keyword) {
    rows = rows.filter((p) => postWorking(db, p).translations.some((t) => t.title.toLowerCase().includes(keyword) || t.slug.toLowerCase().includes(keyword)));
  }
  if (statuses?.length) rows = rows.filter((p) => statuses.includes(p.status));
  if (categoryId !== undefined) rows = rows.filter((p) => postWorking(db, p).post.category_id === categoryId);
  if (tagIds) rows = rows.filter((p) => tagIds!.every((t) => postWorking(db, p).tag_ids.includes(t)));
  if (createdBy !== undefined) rows = rows.filter((p) => p.created_by?.id === createdBy);
  if (pending !== undefined) rows = rows.filter((p) => hasDraft(db, p) === pending);
  if (from !== undefined || to !== undefined) {
    rows = rows.filter((p) => {
      const at = p.published_at;
      if (!at) return false;
      const ms = Date.parse(at);
      return (from === undefined || ms >= from) && (to === undefined || ms <= to);
    });
  }
  const items = rows.map((p) => postListItem(db, p, locale));
  const dir = m![1] ? -1 : 1;
  const field = m![2];
  const valueOf = (r: PostListItem): string | number => {
    if (field === "title") return (r.title ?? "").toLowerCase();
    return ((r as unknown as Record<string, unknown>)[field] as string | number | null) ?? "";
  };
  items.sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return cmp * dir || a.id - b.id;
  });
  return paginate(items, params);
}

export function getPost(db: MockDb, id: string, params?: Params) {
  if (params) rejectUnknown(params, ["locale"]);
  const root = findPost(db, id);
  return { data: postDetail(db, root, params?.get("locale") ?? DEFAULT_LOCALE_CODE), etag: etagOfPost(root) };
}

// ---------------------------------------------------------------------------------------------------------------
// GET /posts/slug-check
// ---------------------------------------------------------------------------------------------------------------
export function checkPostSlug(db: MockDb, params: Params) {
  rejectUnknown(params, ["locale", "slug", "post_id"]);
  const errors: ApiFieldError[] = [];
  const locale = params.get("locale");
  const slug = params.get("slug");
  if (locale === null) errors.push({ in: "query", path: "/locale", code: "required" });
  else if (!(MOCK_LOCALE_CODES as readonly string[]).includes(locale)) errors.push({ in: "query", path: "/locale", code: "unknown_reference" });
  if (slug === null) errors.push({ in: "query", path: "/slug", code: "required" });
  else if ([...slug].length > 200) errors.push({ in: "query", path: "/slug", code: "too_long", params: { max: 200 } });
  const postIdRaw = params.get("post_id");
  if (postIdRaw !== null && !/^[1-9]\d{0,17}$/.test(postIdRaw)) errors.push({ in: "query", path: "/post_id", code: "invalid_format" });
  if (errors.length) throw validationFailed(errors);

  const normalized = slug!.trim().toLowerCase();
  const valid = normalized.length <= MAX_SLUG && SLUG_PATTERN.test(normalized);
  const reason = valid ? null : normalized.length > MAX_SLUG ? ("too_long" as const) : ("format" as const);
  const owner = valid ? slugOwner(db, locale!, normalized, postIdRaw === null ? undefined : Number(postIdRaw)) : undefined;
  return {
    locale: locale!,
    slug: slug!,
    normalized,
    valid,
    reason,
    available: valid && !owner,
    conflict: owner ? { post_id: owner.id, title: titleOf(owner.live, locale!).title } : null,
    suggestion: owner ? freeSlug(db, locale!, normalized, postIdRaw === null ? undefined : Number(postIdRaw)) : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Translation rules (05 13.3.1)
// ---------------------------------------------------------------------------------------------------------------
function textLimit(value: unknown, max: number, path: string, errors: ApiFieldError[], nullable = true) {
  if (value === undefined) return;
  if (value === null) {
    if (!nullable) errors.push({ in: "body", path, code: "invalid_type" });
    return;
  }
  if (typeof value !== "string") errors.push({ in: "body", path, code: "invalid_type" });
  else if ([...value].length > max) errors.push({ in: "body", path, code: "too_long", params: { max } });
}

function checkTranslation(db: MockDb, code: string, t: unknown, errors: ApiFieldError[], mode: "create" | "patch") {
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
    else if ([...title.trim()].length > MAX_POST_TITLE) errors.push({ in: "body", path: `${base}/title`, code: "too_long", params: { max: MAX_POST_TITLE } });
  }
  if (t.slug !== undefined) {
    if (typeof t.slug !== "string") errors.push({ in: "body", path: `${base}/slug`, code: "invalid_type" });
    else if (t.slug.length > MAX_SLUG) errors.push({ in: "body", path: `${base}/slug`, code: "pattern_mismatch", params: { rule: "too_long" } });
    else if (!SLUG_PATTERN.test(t.slug)) errors.push({ in: "body", path: `${base}/slug`, code: "pattern_mismatch", params: { rule: "format" } });
  }
  textLimit(t.excerpt, MAX_EXCERPT, `${base}/excerpt`, errors);
  textLimit(t.label, MAX_LABEL, `${base}/label`, errors);
  textLimit(t.location_label, MAX_LOCATION_LABEL, `${base}/location_label`, errors);
  textLimit(t.gallery_heading, MAX_GALLERY_HEADING, `${base}/gallery_heading`, errors);
  textLimit(t.gallery_description, MAX_GALLERY_DESCRIPTION, `${base}/gallery_description`, errors);
  textLimit(t.hero_alt, MAX_HERO_ALT, `${base}/hero_alt`, errors);
  textLimit(t.seo_title, MAX_SEO_TITLE, `${base}/seo_title`, errors);
  textLimit(t.seo_description, MAX_SEO_DESCRIPTION, `${base}/seo_description`, errors);
  if (t.body !== undefined) errors.push(...bodyErrors(db, t.body, `${base}/body`));
  if (t.og_image_id !== undefined && t.og_image_id !== null && !(Number.isInteger(t.og_image_id) && db.assets.some((a) => a.id === t.og_image_id && !a.deleted_at))) {
    errors.push({ in: "body", path: `${base}/og_image_id`, code: "unknown_reference", params: { ref_type: "media_assets" } });
  }
  if (t.is_enabled !== undefined && typeof t.is_enabled !== "boolean") errors.push({ in: "body", path: `${base}/is_enabled`, code: "invalid_type" });
  if (t.is_enabled === false && code === DEFAULT_LOCALE_CODE) errors.push({ in: "body", path: `${base}/is_enabled`, code: "immutable" });
}

function normaliseTranslation(code: string, t: Record<string, unknown>, old?: MockPostTranslation): MockPostTranslation {
  const str = (v: unknown, fallback: string | null) => (v === undefined ? fallback : v === null ? null : String(v).trim() === "" ? null : String(v));
  return {
    locale_code: code,
    slug: typeof t.slug === "string" ? t.slug : (old?.slug ?? ""),
    title: t.title === undefined ? (old?.title ?? "") : String(t.title).trim(),
    excerpt: str(t.excerpt, old?.excerpt ?? null),
    label: str(t.label, old?.label ?? null),
    location_label: str(t.location_label, old?.location_label ?? null),
    body: t.body === undefined ? (old?.body ?? null) : (t.body as Record<string, unknown> | null),
    gallery_heading: str(t.gallery_heading, old?.gallery_heading ?? null),
    gallery_description: str(t.gallery_description, old?.gallery_description ?? null),
    hero_alt: str(t.hero_alt, old?.hero_alt ?? null),
    seo_title: str(t.seo_title, old?.seo_title ?? null),
    seo_description: str(t.seo_description, old?.seo_description ?? null),
    og_image_id: t.og_image_id === undefined ? (old?.og_image_id ?? null) : (t.og_image_id as number | null),
    is_enabled: typeof t.is_enabled === "boolean" ? t.is_enabled : (old?.is_enabled ?? true),
  };
}

// The shared fields of a body (create and patch): category, tags, hero / teaser, flag, display date.
// `currentAuthor` = the author the post has now (a PATCH): the check runs only when the value CHANGES, so an author switched off
// later stays on the post and a form that sends the whole object again is not refused (05 15.8).
function checkSharedFields(db: MockDb, input: Record<string, unknown>, errors: ApiFieldError[], currentAuthor: number | null = null) {
  if (input.author_id !== undefined && input.author_id !== null) {
    if (!Number.isInteger(input.author_id) || (input.author_id as number) < 1) errors.push({ in: "body", path: "/author_id", code: "invalid_type" });
    else if (input.author_id !== currentAuthor) {
      const author = db.authors.find((a) => a.id === input.author_id && !a.deleted_at);
      if (!author) errors.push({ in: "body", path: "/author_id", code: "unknown_reference", params: { ref_type: "authors" } });
      else if (!author.is_active) errors.push({ in: "body", path: "/author_id", code: "author_inactive" });
    }
  }
  if (input.category_id !== undefined && input.category_id !== null) {
    if (!Number.isInteger(input.category_id) || (input.category_id as number) < 1) errors.push({ in: "body", path: "/category_id", code: "invalid_type" });
    else if (!db.categories.some((c) => c.id === input.category_id && !c.deleted_at)) errors.push({ in: "body", path: "/category_id", code: "unknown_reference", params: { ref_type: "categories" } });
  }
  if (input.tag_ids !== undefined) {
    if (!Array.isArray(input.tag_ids)) errors.push({ in: "body", path: "/tag_ids", code: "invalid_type" });
    else {
      if (input.tag_ids.length > MAX_TAGS) errors.push({ in: "body", path: "/tag_ids", code: "limit_exceeded", params: { max: MAX_TAGS } });
      const seen = new Set<unknown>();
      input.tag_ids.forEach((id, i) => {
        if (!Number.isInteger(id) || (id as number) < 1) errors.push({ in: "body", path: `/tag_ids/${i}`, code: "invalid_type" });
        else if (seen.has(id)) errors.push({ in: "body", path: `/tag_ids/${i}`, code: "duplicate" });
        else if (!db.tags.some((t) => t.id === id && !t.deleted_at)) errors.push({ in: "body", path: `/tag_ids/${i}`, code: "unknown_reference", params: { ref_type: "tags" } });
        seen.add(id);
      });
    }
  }
  for (const f of ["hero_media_id", "teaser_media_id"] as const) {
    const v = input[f];
    if (v === undefined || v === null) continue;
    if (!Number.isInteger(v) || (v as number) < 1) errors.push({ in: "body", path: `/${f}`, code: "invalid_type" });
    else if (!db.assets.some((a) => a.id === v && !a.deleted_at)) errors.push({ in: "body", path: `/${f}`, code: "unknown_reference", params: { ref_type: "media_assets" } });
  }
  if (input.is_featured !== undefined && typeof input.is_featured !== "boolean") errors.push({ in: "body", path: "/is_featured", code: "invalid_type" });
  if (input.published_at !== undefined && input.published_at !== null) {
    if (typeof input.published_at !== "string" || Number.isNaN(Date.parse(input.published_at))) errors.push({ in: "body", path: "/published_at", code: "invalid_format" });
    // The display date can not be in the future (PT-7): a future date would be a silent schedule without a worker. Wall-clock now.
    else if (Date.parse(input.published_at) > Date.now()) errors.push({ in: "body", path: "/published_at", code: "out_of_range", params: { max: new Date().toISOString() } });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// POST /posts
// ---------------------------------------------------------------------------------------------------------------
export function createPost(db: MockDb, body: unknown) {
  if (roleOf(db) === "translator") throw deny("create", "POST", "/posts");
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(body)) {
    if (!["translations", "category_id", "author_id", "tag_ids", "hero_media_id", "teaser_media_id", "is_featured", "published_at"].includes(k)) errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  }
  if (!isObject(body.translations)) errors.push({ in: "body", path: "/translations", code: body.translations === undefined ? "required" : "invalid_type" });
  else {
    for (const [code, t] of Object.entries(body.translations)) checkTranslation(db, code, t, errors, "create");
    if (!isObject(body.translations[DEFAULT_LOCALE_CODE])) errors.push({ in: "body", path: `/translations/${DEFAULT_LOCALE_CODE}/title`, code: "required" });
  }
  checkSharedFields(db, body, errors);
  if (errors.length) throw validationFailed(errors);

  const translations = body.translations as Record<string, Record<string, unknown>>;
  const id = db.nextPostId++;
  const clashes: ApiFieldError[] = [];
  const rows: MockPostTranslation[] = [];
  // The English slug first: a Lao-only title falls back to it (05 13.3.4).
  const order = Object.keys(translations).sort((a) => (a === "en" ? -1 : 1));
  for (const code of order) {
    const t = translations[code];
    const row = normaliseTranslation(code, t);
    if (typeof t.slug !== "string") {
      const english = rows.find((r) => r.locale_code === "en")?.slug;
      row.slug = freeSlug(db, code, slugify(row.title) || english || `post-${postPublicId(id).slice(0, 8)}`);
    } else if (slugOwner(db, code, row.slug)) {
      clashes.push({ in: "body", path: `/translations/${code}/slug`, code: "duplicate", params: { suggestion: freeSlug(db, code, row.slug) } });
    }
    rows.push(row);
  }
  if (clashes.length) {
    db.nextPostId -= 1;
    throw duplicate(clashes);
  }
  const stamp = tick(db);
  const root: MockPostRoot = {
    id,
    public_id: postPublicId(id),
    status: "draft",
    lock_version: 1,
    // The display date is a column of the root, not part of the draft (set at creation, changed alone by PATCH).
    published_at: (body.published_at as string | null | undefined) ?? null,
    first_published_at: null,
    unpublished_at: null,
    created_by: MOCK_USER,
    updated_by: MOCK_USER,
    created_at: stamp,
    updated_at: stamp,
    deleted_at: null,
    live: {
      post: {
        category_id: (body.category_id as number | null | undefined) ?? null,
        author_id: (body.author_id as number | null | undefined) ?? null,
        hero_media_id: (body.hero_media_id as number | null | undefined) ?? null,
        teaser_media_id: (body.teaser_media_id as number | null | undefined) ?? null,
        is_featured: body.is_featured === true,
      },
      tag_ids: Array.isArray(body.tag_ids) ? [...(body.tag_ids as number[])] : [],
      translations: rows.sort((a, b) => MOCK_LOCALE_CODES.indexOf(a.locale_code as never) - MOCK_LOCALE_CODES.indexOf(b.locale_code as never)),
      media: [],
    },
  };
  db.posts.push(root);
  return { data: writeResult(db, root, serpWarnings(root.live)), etag: etagOfPost(root) };
}

function serpWarnings(snap: MockPostSnapshot): SaveLiveWarning[] {
  const out: SaveLiveWarning[] = [];
  for (const t of snap.translations) {
    if (t.seo_title && [...t.seo_title].length > SERP_TITLE) out.push({ path: `/translations/${t.locale_code}/seo_title`, code: "serp_title_long", params: { length: [...t.seo_title].length, recommended: SERP_TITLE } });
    if (t.seo_description && [...t.seo_description].length > SERP_DESCRIPTION) out.push({ path: `/translations/${t.locale_code}/seo_description`, code: "serp_description_long", params: { length: [...t.seo_description].length, recommended: SERP_DESCRIPTION } });
    if (t.label && [...t.label].length > LABEL_RECOMMENDED) out.push({ path: `/translations/${t.locale_code}/label`, code: "label_long", params: { length: [...t.label].length, recommended: LABEL_RECOMMENDED } });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// PATCH /posts/{id} (PT-2, PT-3)
// ---------------------------------------------------------------------------------------------------------------
export function patchPost(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
  const root = findPost(db, id);
  if (authorLocked(db, root)) throw deny("update_own", "PATCH", "/posts/{id}");
  // Route policy: `update` | `update_own` (owner) | `translate`. Every role of this model holds `translate`, so nobody is
  // refused here; the VALUES decide below.
  requireMatch(ifMatch, root);
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const errors: ApiFieldError[] = [];
  const keys = Object.keys(body);
  if (keys.length === 0) throw validationFailed([{ in: "body", path: "", code: "min_properties" }]);
  for (const k of keys) {
    if (["status", "scheduled_at", "unpublished_at", "first_published_at"].includes(k)) errors.push({ in: "body", path: `/${k}`, code: k === "status" ? "immutable" : "not_applicable" });
    else if (!["translations", "media_translations", "category_id", "author_id", "tag_ids", "hero_media_id", "teaser_media_id", "is_featured", "published_at"].includes(k)) errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  }
  trashedCheck(root);
  const snapNow = postWorking(db, root);
  if (body.translations !== undefined) {
    if (!isObject(body.translations)) errors.push({ in: "body", path: "/translations", code: "invalid_type" });
    else for (const [code, t] of Object.entries(body.translations)) checkTranslation(db, code, t, errors, "patch");
  }
  if (body.media_translations !== undefined) {
    if (!isObject(body.media_translations)) errors.push({ in: "body", path: "/media_translations", code: "invalid_type" });
    else {
      for (const [rowId, perLocale] of Object.entries(body.media_translations)) {
        if (!snapNow.media.some((m) => String(m.id) === rowId)) {
          errors.push({ in: "body", path: `/media_translations/${rowId}`, code: "unknown_reference" });
          continue;
        }
        if (!isObject(perLocale)) {
          errors.push({ in: "body", path: `/media_translations/${rowId}`, code: "invalid_type" });
          continue;
        }
        for (const [code, v] of Object.entries(perLocale)) {
          if (!(MOCK_LOCALE_CODES as readonly string[]).includes(code)) errors.push({ in: "body", path: `/media_translations/${rowId}/${code}`, code: "unknown_reference" });
          else if (!isObject(v)) errors.push({ in: "body", path: `/media_translations/${rowId}/${code}`, code: "invalid_type" });
          else {
            for (const f of Object.keys(v)) if (f !== "alt" && f !== "caption") errors.push({ in: "body", path: `/media_translations/${rowId}/${code}/${f}`, code: "unknown_field" });
            textLimit(v.alt, MAX_GALLERY_ALT, `/media_translations/${rowId}/${code}/alt`, errors);
            textLimit(v.caption, MAX_GALLERY_CAPTION, `/media_translations/${rowId}/${code}/caption`, errors);
          }
        }
      }
    }
  }
  checkSharedFields(db, body, errors, snapNow.post.author_id ?? null);
  if (errors.length) throw validationFailed(errors);

  // Apply on a copy first: no change at all -> 200 with the same ETag, no side effect (05 13.3.3).
  const next = structuredClone(snapNow);
  if (body.category_id !== undefined) next.post.category_id = body.category_id as number | null;
  if (body.author_id !== undefined) next.post.author_id = body.author_id as number | null;
  if (body.tag_ids !== undefined) next.tag_ids = [...(body.tag_ids as number[])];
  if (body.hero_media_id !== undefined) next.post.hero_media_id = body.hero_media_id as number | null;
  if (body.teaser_media_id !== undefined) next.post.teaser_media_id = body.teaser_media_id as number | null;
  if (body.is_featured !== undefined) next.post.is_featured = body.is_featured as boolean;
  const slugClashes: ApiFieldError[] = [];
  if (isObject(body.translations)) {
    for (const [code, t] of Object.entries(body.translations)) {
      if (t === null) next.translations = next.translations.filter((x) => x.locale_code !== code);
      else {
        const old = next.translations.find((x) => x.locale_code === code);
        const input = t as Record<string, unknown>;
        const merged = normaliseTranslation(code, input, old);
        if (!old && typeof input.slug !== "string") {
          const english = next.translations.find((x) => x.locale_code === "en")?.slug;
          merged.slug = freeSlug(db, code, slugify(merged.title) || english || `post-${root.public_id.slice(0, 8)}`, root.id);
        }
        // A slug is checked against the REAL rows of the other posts (a pending draft is invisible).
        if (merged.slug !== old?.slug && slugOwner(db, code, merged.slug, root.id)) {
          slugClashes.push({ in: "body", path: `/translations/${code}/slug`, code: "duplicate", params: { suggestion: freeSlug(db, code, merged.slug, root.id) } });
        }
        next.translations = old ? next.translations.map((x) => (x.locale_code === code ? merged : x)) : [...next.translations, merged];
      }
    }
  }
  if (isObject(body.media_translations)) {
    for (const [rowId, perLocale] of Object.entries(body.media_translations)) {
      const row = next.media.find((m) => String(m.id) === rowId)!;
      for (const [code, v] of Object.entries(perLocale as Record<string, Record<string, unknown>>)) {
        const prev = row.translations[code] ?? {};
        row.translations[code] = { ...prev, ...(v.alt !== undefined ? { alt: (v.alt as string | null) === "" ? null : (v.alt as string | null) } : {}), ...(v.caption !== undefined ? { caption: (v.caption as string | null) === "" ? null : (v.caption as string | null) } : {}) };
      }
    }
  }
  // The display date (PT-7): a column of the root, changed by a PATCH that carries NOTHING else that changes. Unchanged = a no-op.
  const sameDate = (a: string | null, b: string | null) => (a === null || b === null ? a === b : Date.parse(a) === Date.parse(b));
  const dateChange = body.published_at !== undefined && !sameDate(body.published_at as string | null, root.published_at);
  const snapChanged = JSON.stringify(next) !== JSON.stringify(snapNow);
  if (dateChange) {
    if (!canUpdate(db, root)) throw deny(roleOf(db) === "author" ? "update_own" : "update", "PATCH", "/published_at");
    if (snapChanged) throw validationFailed([{ in: "body", path: "/published_at", code: "not_applicable", params: { reason: "send_alone" } }]);
    if (body.published_at === null && root.status === "published") throw validationFailed([{ in: "body", path: "/published_at", code: "required" }]);
    // One command of its own: it goes live AT ONCE on a published post (no draft, no publish), moves the ETag once.
    touch(db, root);
    root.published_at = body.published_at as string | null;
    return { data: writeResult(db, root), etag: etagOfPost(root) };
  }
  if (!snapChanged) return { data: writeResult(db, root), etag: etagOfPost(root) };

  // Who may write which value (the check is on the VALUE: a form may send the whole object, 05 11.1.3).
  if (!canUpdate(db, root)) {
    const first = (path: string) => deny(roleOf(db) === "author" ? "update_own" : "update", "PATCH", path);
    for (const f of ["category_id", "author_id", "hero_media_id", "teaser_media_id", "is_featured"] as const) {
      if ((next.post[f] ?? null) !== (snapNow.post[f] ?? null)) throw first(`/${f}`);
    }
    if (JSON.stringify(next.tag_ids) !== JSON.stringify(snapNow.tag_ids)) throw first("/tag_ids");
    for (const code of new Set([...next.translations.map((t) => t.locale_code), ...snapNow.translations.map((t) => t.locale_code)])) {
      const before = snapNow.translations.find((t) => t.locale_code === code);
      const after = next.translations.find((t) => t.locale_code === code);
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      // The default language, deleting a language row and the shared per-language fields are not a translator's; adding the
      // row of a language that is not the default one is ("the translation row of that language", PT-3).
      if (code === DEFAULT_LOCALE_CODE || !after) throw first(`/translations/${code}`);
      for (const f of ["og_image_id", "is_enabled"] as const) if (after[f] !== (before?.[f] ?? (f === "is_enabled" ? true : null))) throw first(`/translations/${code}/${f}`);
    }
    next.media.forEach((row) => {
      const before = snapNow.media.find((m) => m.id === row.id);
      for (const code of Object.keys(row.translations)) {
        if (code === DEFAULT_LOCALE_CODE && JSON.stringify(row.translations[code]) !== JSON.stringify(before?.translations[code])) throw first(`/media_translations/${row.id}/${code}`);
      }
    });
  }
  if (slugClashes.length) throw duplicate(slugClashes);

  const { snapshot, stamp } = beginWrite(db, root);
  const warnings: SaveLiveWarning[] = serpWarnings(next);
  if (root.first_published_at) {
    for (const t of next.translations) {
      const old = snapNow.translations.find((x) => x.locale_code === t.locale_code);
      if (old && old.slug !== t.slug) warnings.push({ path: `/translations/${t.locale_code}/slug`, code: "slug_changed_published", params: { locale: t.locale_code, old_slug: old.slug } });
    }
  }
  Object.assign(snapshot.post, next.post);
  snapshot.tag_ids = next.tag_ids;
  snapshot.translations = next.translations;
  snapshot.media = next.media;
  commitWrite(root, stamp);
  return { data: writeResult(db, root, warnings), etag: etagOfPost(root) };
}

// ---------------------------------------------------------------------------------------------------------------
// PUT /posts/{id}/media (PT-6)
// ---------------------------------------------------------------------------------------------------------------
export function replacePostMedia(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
  const root = findPost(db, id);
  if (authorLocked(db, root)) throw deny("update_own", "PUT", "/posts/{id}/media");
  // `update` | `update_own` (owner); `translate` alone does not do (05 13.3.7).
  if (!canUpdate(db, root)) throw deny(roleOf(db) === "author" ? "update_own" : "update", "PUT", "/posts/{id}/media");
  requireMatch(ifMatch, root);
  if (!isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(body)) if (k !== "media") errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  if (!Array.isArray(body.media)) errors.push({ in: "body", path: "/media", code: body.media === undefined ? "required" : "invalid_type" });
  trashedCheck(root);
  const snapNow = postWorking(db, root);
  const rows: MockPostMedia[] = [];
  if (Array.isArray(body.media)) {
    if (body.media.length > MAX_GALLERY_ITEMS) errors.push({ in: "body", path: "/media", code: "limit_exceeded", params: { max: MAX_GALLERY_ITEMS } });
    const seenIds = new Set<number>();
    body.media.forEach((raw, i) => {
      const at = `/media/${i}`;
      if (!isObject(raw)) {
        errors.push({ in: "body", path: at, code: "invalid_type" });
        return;
      }
      for (const k of Object.keys(raw)) if (!["id", "media_id", "translations"].includes(k)) errors.push({ in: "body", path: `${at}/${k}`, code: "unknown_field" });
      let rowId: number | null = null;
      if (raw.id !== undefined) {
        if (!Number.isInteger(raw.id) || !snapNow.media.some((m) => m.id === raw.id)) errors.push({ in: "body", path: `${at}/id`, code: "unknown_reference" });
        else if (seenIds.has(raw.id as number)) errors.push({ in: "body", path: `${at}/id`, code: "duplicate" });
        else {
          rowId = raw.id as number;
          seenIds.add(rowId);
        }
      }
      if (!Number.isInteger(raw.media_id)) errors.push({ in: "body", path: `${at}/media_id`, code: raw.media_id === undefined ? "required" : "invalid_type" });
      else if (!db.assets.some((a) => a.id === raw.media_id && !a.deleted_at)) errors.push({ in: "body", path: `${at}/media_id`, code: "unknown_reference", params: { ref_type: "media_assets" } });
      // An omitted `translations` means NO texts (the stricter reading of 05 13.3.7): the client always sends them.
      const translations: MockPostMedia["translations"] = {};
      if (raw.translations !== undefined && !isObject(raw.translations)) errors.push({ in: "body", path: `${at}/translations`, code: "invalid_type" });
      else {
        for (const [code, v] of Object.entries((raw.translations ?? {}) as Record<string, unknown>)) {
          if (!(MOCK_LOCALE_CODES as readonly string[]).includes(code)) errors.push({ in: "body", path: `${at}/translations/${code}`, code: "unknown_reference" });
          else if (!isObject(v)) errors.push({ in: "body", path: `${at}/translations/${code}`, code: "invalid_type" });
          else {
            for (const f of Object.keys(v)) if (f !== "alt" && f !== "caption") errors.push({ in: "body", path: `${at}/translations/${code}/${f}`, code: "unknown_field" });
            textLimit(v.alt, MAX_GALLERY_ALT, `${at}/translations/${code}/alt`, errors);
            textLimit(v.caption, MAX_GALLERY_CAPTION, `${at}/translations/${code}/caption`, errors);
            translations[code] = { alt: blank(v.alt as string | null | undefined) ? null : (v.alt as string), caption: blank(v.caption as string | null | undefined) ? null : (v.caption as string) };
          }
        }
      }
      rows.push({ id: rowId ?? 0, media_id: raw.media_id as number, sort_order: i, translations });
    });
  }
  if (errors.length) throw validationFailed(errors);

  // New rows reserve their ids (03 7.1 item 8).
  const next = rows.map((r) => ({ ...r, id: r.id || db.nextPostMediaId++ }));
  const before = snapNow.media.slice().sort((a, b) => a.sort_order - b.sort_order);
  if (JSON.stringify(before) === JSON.stringify(next)) {
    return { data: { media: next.map((m) => mediaItem(db, m)), aggregate: stampOf(db, root), warnings: [] }, etag: etagOfPost(root) };
  }
  const { snapshot, stamp } = beginWrite(db, root);
  snapshot.media = next;
  commitWrite(root, stamp);
  return { data: { media: next.map((m) => mediaItem(db, m)), aggregate: stampOf(db, root), warnings: [] }, etag: etagOfPost(root) };
}

// ---------------------------------------------------------------------------------------------------------------
// DELETE / restore
// ---------------------------------------------------------------------------------------------------------------
// A published post that leaves `published` with a draft pending: the draft becomes a `history` row (never a failure).
function keepDraftAsHistory(db: MockDb, root: MockPostRoot, note: string): SaveLiveWarning[] {
  const draft = postDraftRow(db, root);
  if (!draft || root.status !== "published") return [];
  draft.kind = "history";
  draft.change_note = note;
  draft.is_preview = false;
  return [{ path: "", code: "draft_kept_as_history", params: { revision_id: draft.id, version: draft.version } }];
}
function referencedWarning(db: MockDb, root: MockPostRoot): SaveLiveWarning[] {
  const total = postReferenceCount(db, root.id);
  return total > 0 ? [{ path: "", code: "post_referenced", params: { total_references: total } }] : [];
}

export function deletePost(db: MockDb, id: string, params: Params, ifMatch: string | null) {
  rejectUnknown(params, []);
  const root = findPost(db, id);
  const role = roleOf(db);
  const allowed = role === "editor" || (role === "author" && isOwner(root) && !root.first_published_at);
  if (!allowed) throw deny(role === "author" ? "delete_own" : "delete", "DELETE", "/posts/{id}");
  requireMatch(ifMatch, root);
  if (postIsTrashed(root)) return { data: null, etag: etagOfPost(root) };
  const warnings: SaveLiveWarning[] = [];
  if (root.status === "published") warnings.push(...referencedWarning(db, root));
  const stamp = touch(db, root);
  if (root.status === "published") {
    warnings.push(...keepDraftAsHistory(db, root, "unpublish"));
    root.unpublished_at = stamp;
    root.status = "archived";
  }
  root.deleted_at = stamp;
  return { data: { aggregate: stampOf(db, root), warnings }, etag: etagOfPost(root) };
}

export function restorePost(db: MockDb, id: string, ifMatch: string | null) {
  const root = findPost(db, id);
  // `cms.blog:delete` only (`delete_own` does not restore, 05 13.3.2).
  if (roleOf(db) !== "editor") throw deny("delete", "POST", "/posts/{id}/restore");
  requireMatch(ifMatch, root);
  if (!postIsTrashed(root)) throw invalidState("not_trashed");
  const clashes: ApiFieldError[] = [];
  for (const t of root.live.translations) {
    if (slugOwner(db, t.locale_code, t.slug, root.id)) clashes.push({ in: "entity", path: `/translations/${t.locale_code}/slug`, code: "duplicate", params: { suggestion: freeSlug(db, t.locale_code, t.slug, root.id) } });
  }
  if (clashes.length) throw duplicate(clashes);
  touch(db, root);
  root.deleted_at = null;
  root.status = "draft";
  return { data: writeResult(db, root), etag: etagOfPost(root) };
}

// ---------------------------------------------------------------------------------------------------------------
// Publish engine (05 12.7 instantiated by 13.3.6)
// ---------------------------------------------------------------------------------------------------------------
export function validatePostForPublish(db: MockDb, root: MockPostRoot): { blockers: PublishIssue[]; warnings: PublishIssue[] } {
  const snap = postWorking(db, root);
  const blockers: PublishIssue[] = [];
  const warnings: PublishIssue[] = [];
  const def = DEFAULT_LOCALE_CODE;
  const assetOf = (id: number | null) => (id === null ? undefined : db.assets.find((a) => a.id === id && !a.deleted_at));
  const altOf = (asset: ReturnType<typeof assetOf>, code: string) => asset?.translations[code]?.alt ?? "";
  const dflt = snap.translations.find((t) => t.locale_code === def);

  // root
  if (snap.post.category_id === null) blockers.push(issue("/category_id", "required"));
  else {
    const category = db.categories.find((c) => c.id === snap.post.category_id && !c.deleted_at);
    if (!category) blockers.push(issue("/category_id", "unknown_reference", { ref_type: "categories", ref_id: snap.post.category_id }));
    else if (!category.is_active) warnings.push(issue("/category_id", "category_inactive", { ref_id: category.id }, false));
  }
  const checkMedia = (id: number | null, path: string, required: boolean, heroAlt: string | null) => {
    if (id === null) {
      if (required) blockers.push(issue(path, "required"));
      return;
    }
    const asset = assetOf(id);
    if (!asset) {
      blockers.push(issue(path, "unknown_reference", { ref_type: "media_assets", ref_id: id }));
      return;
    }
    if (asset.status !== "ready") blockers.push(issue(path, "media_not_ready", { media_id: id }));
    else if (blank(heroAlt) && blank(altOf(asset, def)) && !asset.is_decorative) blockers.push(issue(path, "media_alt_missing", { media_id: id, locale: def }));
  };
  checkMedia(snap.post.hero_media_id, "/hero_media_id", true, dflt?.hero_alt ?? null);
  checkMedia(snap.post.teaser_media_id, "/teaser_media_id", false, null);
  snap.tag_ids.forEach((tid, i) => {
    if (!db.tags.some((t) => t.id === tid && !t.deleted_at)) blockers.push(issue(`/tag_ids/${i}`, "unknown_reference", { ref_type: "tags", ref_id: tid }));
  });

  // translations
  for (const f of ["title", "excerpt", "seo_title"] as const) {
    if (blank(dflt?.[f])) blockers.push(issue(`/translations/${def}/${f}`, "empty_default_locale", { locale: def }));
  }
  for (const t of snap.translations) {
    // The pending draft of another post is invisible to the save; publish checks the real rows again.
    if (slugOwner(db, t.locale_code, t.slug, root.id)) blockers.push(issue(`/translations/${t.locale_code}/slug`, "duplicate", { locale: t.locale_code }));
    if (t.og_image_id !== null) {
      const og = assetOf(t.og_image_id);
      if (!og) blockers.push(issue(`/translations/${t.locale_code}/og_image_id`, "unknown_reference", { ref_type: "media_assets", ref_id: t.og_image_id }));
      else if (og.status !== "ready") blockers.push(issue(`/translations/${t.locale_code}/og_image_id`, "media_not_ready", { media_id: t.og_image_id }));
    }
    // the structure of every enabled language's body is checked again (a blocker with the node pointer)
    if (t.is_enabled && t.body) for (const e of bodyErrors(db, t.body, `/translations/${t.locale_code}/body`)) blockers.push(issue(e.path, e.code, e.params as PublishIssue["params"]));
    // images inside the body
    (Array.isArray(t.body?.content) ? (t.body!.content as unknown[]) : []).forEach((node, i) => {
      if (!isObject(node) || node.type !== "image" || !isObject(node.attrs)) return;
      const path = `/translations/${t.locale_code}/body/content/${i}/attrs/media_id`;
      const asset = assetOf(node.attrs.media_id as number);
      if (!asset) blockers.push(issue(path, "unknown_reference", { ref_type: "media_assets" }));
      else if (blank(node.attrs.alt as string | undefined) && blank(altOf(asset, t.locale_code)) && !asset.is_decorative) blockers.push(issue(path, "media_alt_missing", { media_id: asset.id, locale: t.locale_code }));
    });
    if (t.seo_title && [...t.seo_title].length > SERP_TITLE) warnings.push(issue(`/translations/${t.locale_code}/seo_title`, "serp_title_long", { length: [...t.seo_title].length, recommended: SERP_TITLE }, false));
    if (t.seo_description && [...t.seo_description].length > SERP_DESCRIPTION) warnings.push(issue(`/translations/${t.locale_code}/seo_description`, "serp_description_long", { length: [...t.seo_description].length, recommended: SERP_DESCRIPTION }, false));
    if (t.label && [...t.label].length > LABEL_RECOMMENDED) warnings.push(issue(`/translations/${t.locale_code}/label`, "label_long", { length: [...t.label].length, recommended: LABEL_RECOMMENDED }, false));
  }
  if (!bodyHasText(dflt?.body)) warnings.push(issue(`/translations/${def}/body`, "body_empty", { locale: def }, false));
  for (const code of MOCK_ACTIVE_LOCALE_CODES) {
    if (code === def) continue;
    const t = snap.translations.find((x) => x.locale_code === code);
    const missing = (blank(t?.title) ? 1 : 0) + (blank(t?.excerpt) ? 1 : 0) + (blank(t?.seo_title) ? 1 : 0);
    if (missing > 0) warnings.push(issue(`/translations/${code}`, "translation_incomplete", { locale: code, missing }, false));
  }

  // gallery
  snap.media.slice().sort((a, b) => a.sort_order - b.sort_order).forEach((row) => {
    const path = `/media/${row.id}/media_id`;
    const asset = assetOf(row.media_id);
    if (!asset) blockers.push(issue(path, "unknown_reference", { ref_type: "media_assets", ref_id: row.media_id }));
    else if (asset.status !== "ready") blockers.push(issue(path, "media_not_ready", { media_id: row.media_id }));
    else if (blank(row.translations[def]?.alt) && blank(altOf(asset, def)) && !asset.is_decorative) blockers.push(issue(path, "media_alt_missing", { media_id: row.media_id, locale: def }));
  });
  return { blockers, warnings };
}

function blockedError(blockers: PublishIssue[], warnings: PublishIssue[]) {
  const shown = blockers.slice(0, MAX_ISSUES);
  return fail(422, "PUBLISH_BLOCKED", `Cannot publish: ${blockers.length} item(s) must be fixed first.`, {
    errors: shown,
    details: { blocker_count: blockers.length, truncated: blockers.length > MAX_ISSUES, warning_count: warnings.length, warnings: warnings.slice(0, MAX_ISSUES) },
  });
}

// `system`: the scheduler worker publishing at the time (no rights check).
export function publishPost(db: MockDb, id: string, params: Params, body: unknown, ifMatch: string | null, system = false) {
  rejectUnknown(params, ["dry_run"]);
  const dryRun = boolParam(params, "dry_run") ?? false;
  const root = findPost(db, id);
  if (!system && (roleOf(db) !== "editor" || db.workflowRole !== "full")) throw deny("publish", "POST", "/posts/{id}/publish");
  requireMatch(ifMatch, root);
  if (body !== undefined && body !== null && !isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const input = (body ?? {}) as Record<string, unknown>;
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(input)) if (k !== "change_note") errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  if (input.change_note !== undefined && (typeof input.change_note !== "string" || [...input.change_note].length > 200)) errors.push({ in: "body", path: "/change_note", code: "too_long", params: { max: 200 } });
  if (errors.length) throw validationFailed(errors);
  trashedCheck(root);
  if (root.status === "published" && !hasDraft(db, root)) throw invalidState("nothing_to_publish");

  const { blockers, warnings } = validatePostForPublish(db, root);
  if (blockers.length > 0) throw blockedError(blockers, warnings);
  if (dryRun) return { data: { publishable: true as const, warnings }, etag: undefined };

  const stamp = touch(db, root);
  clearSchedule(db, "posts", root.id);
  const note = typeof input.change_note === "string" && input.change_note ? input.change_note : null;
  const draft = hasDraft(db, root) ? postDraftRow(db, root) : undefined;
  const snapshot = structuredClone(postWorking(db, root));
  // `published_at = coalesce(the date on the root, now)` - kept on a re-publish (PT-7).
  const publishedAt = root.published_at ?? stamp;
  const wasPublished = root.status === "published" && Boolean(draft);
  const oldLive = root.live;
  root.live = snapshot;
  let published: StoredRevision;
  if (draft) {
    draft.snapshot = structuredClone(snapshot) as unknown as Record<string, unknown>;
    draft.kind = "published";
    draft.change_note = note;
    published = draft;
  } else {
    published = pushRevision(db, "posts", root.id, "cms.posts", "published", structuredClone(snapshot) as unknown as Record<string, unknown>, note, stamp, MOCK_USER);
  }
  root.status = "published";
  root.published_at = publishedAt;
  root.first_published_at ??= stamp;
  root.unpublished_at = null;
  // 14.12: a published post whose slug moved in a language gets a 301 from /blog/<old> in that language - or says why not.
  const moves: PathMove[] = [];
  if (wasPublished) {
    for (const t of snapshot.translations) {
      const old = oldLive.translations.find((x) => x.locale_code === t.locale_code);
      if (old && old.slug !== t.slug) moves.push({ warningPath: `/translations/${t.locale_code}/slug`, source: `/blog/${old.slug}`, target: `/blog/${t.slug}`, localeCode: t.locale_code, kind: "post" });
    }
  }
  const autoWarnings = autoRedirectWarnings(db, moves);
  const result = { ...writeResult(db, root, [...warnings, ...autoWarnings].map((w) => ({ path: w.path, code: w.code, params: w.params }))), published_revision: { id: published.id, version: published.version } };
  return { data: result, etag: etagOfPost(root) };
}

export function unpublishPost(db: MockDb, id: string, params: Params, ifMatch: string | null) {
  // `confirm_references` belongs to albums / FAQ groups / forms: a post is never blocked by who links to it (PT-8).
  rejectUnknown(params, []);
  const root = findPost(db, id);
  if (roleOf(db) !== "editor") throw deny("unpublish", "POST", "/posts/{id}/unpublish");
  requireMatch(ifMatch, root);
  trashedCheck(root);
  if (root.status !== "published" && root.status !== "scheduled") throw invalidState("not_published");
  const warnings = referencedWarning(db, root);
  const stamp = touch(db, root);
  clearSchedule(db, "posts", root.id);
  warnings.push(...keepDraftAsHistory(db, root, "unpublish"));
  root.status = "archived";
  root.unpublished_at = stamp;
  return { data: writeResult(db, root, warnings), etag: etagOfPost(root) };
}

export function discardPostDraft(db: MockDb, id: string, ifMatch: string | null) {
  const root = findPost(db, id);
  if (authorLocked(db, root)) throw deny("update_own", "POST", "/posts/{id}/discard-draft");
  if (!canUpdate(db, root)) throw deny(roleOf(db) === "author" ? "update_own" : "update", "POST", "/posts/{id}/discard-draft");
  requireMatch(ifMatch, root);
  trashedCheck(root);
  const draft = hasDraft(db, root) ? postDraftRow(db, root) : undefined;
  if (!draft) throw invalidState("no_draft");
  draft.kind = "history";
  draft.change_note = "discarded";
  draft.is_preview = false;
  touch(db, root);
  clearSchedule(db, "posts", root.id);
  return { data: writeResult(db, root), etag: etagOfPost(root) };
}

// ---------------------------------------------------------------------------------------------------------------
// Revisions (05 12.8 for posts)
// ---------------------------------------------------------------------------------------------------------------
const KINDS = ["draft", "published", "history", "restore"];

function liveRevisionId(db: MockDb, root: MockPostRoot): number | null {
  if (root.status !== "published") return null;
  const rows = revList(db, root).filter((r) => r.kind === "published");
  return rows.length ? rows.reduce((a, b) => (b.version > a.version ? b : a)).id : null;
}

export function listPostRevisions(db: MockDb, id: string, params: Params) {
  rejectUnknown(params, ["page", "limit", "kind", "include_preview", "sort"]);
  const root = findPost(db, id);
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
  if (!includePreview) rows = rows.filter((r) => !r.is_preview);
  rows.sort((a, b) => (sort === "version" ? a.version - b.version : b.version - a.version));
  const summaries: RevisionSummary[] = rows.map(({ entity: _e, snapshot: _s, ...summary }) => {
    void _e;
    void _s;
    return { ...summary, is_live: summary.id === live };
  });
  return paginate(summaries, params);
}

export function getPostRevision(db: MockDb, id: string, revId: string) {
  const root = findPost(db, id);
  const rev = revList(db, root).find((r) => String(r.id) === revId);
  if (!rev) throw notFound();
  return { ...rev, entity: { type: "cms.posts", id: root.id, key: null }, is_live: rev.id === liveRevisionId(db, root) };
}

export function restorePostRevision(db: MockDb, id: string, revId: string, body: unknown, ifMatch: string | null) {
  const root = findPost(db, id);
  const rev = revList(db, root).find((r) => String(r.id) === revId);
  if (!rev) throw notFound();
  if (!canUpdate(db, root)) throw deny(roleOf(db) === "author" ? "update_own" : "update", "POST", "/posts/{id}/revisions/{revId}/restore");
  requireMatch(ifMatch, root);
  if (body !== undefined && body !== null && !isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const input = (body ?? {}) as Record<string, unknown>;
  const bodyErrors: ApiFieldError[] = Object.keys(input).filter((k) => k !== "change_note").map((k) => ({ in: "body" as const, path: `/${k}`, code: "unknown_field" }));
  if (input.change_note !== undefined && (typeof input.change_note !== "string" || [...input.change_note].length > 200)) bodyErrors.push({ in: "body", path: "/change_note", code: "too_long", params: { max: 200 } });
  if (bodyErrors.length) throw validationFailed(bodyErrors);
  trashedCheck(root);
  if (rev.schema_version > 1) throw invalidState("snapshot_incompatible");
  const restoredFrom = { revision_id: rev.id, version: rev.version };
  const snapshot = rev.snapshot as unknown as MockPostSnapshot;
  const current = postWorking(db, root);
  if (rev.kind === "draft" || JSON.stringify(snapshot) === JSON.stringify(current)) {
    return { data: { ...writeResult(db, root), restored_from: restoredFrom }, etag: etagOfPost(root) };
  }
  // All or nothing: the references first.
  const errors: ApiFieldError[] = [];
  const mediaOk = (mid: number | null) => mid === null || db.assets.some((a) => a.id === mid && !a.deleted_at);
  if (snapshot.post.category_id !== null && !db.categories.some((c) => c.id === snapshot.post.category_id && !c.deleted_at)) errors.push({ in: "entity", path: "/post/category_id", code: "unknown_reference" });
  if (!mediaOk(snapshot.post.hero_media_id)) errors.push({ in: "entity", path: "/post/hero_media_id", code: "unknown_reference" });
  if (!mediaOk(snapshot.post.teaser_media_id)) errors.push({ in: "entity", path: "/post/teaser_media_id", code: "unknown_reference" });
  snapshot.tag_ids.forEach((tid, i) => {
    if (!db.tags.some((t) => t.id === tid && !t.deleted_at)) errors.push({ in: "entity", path: `/tag_ids/${i}`, code: "unknown_reference" });
  });
  snapshot.media.forEach((m, i) => {
    if (!mediaOk(m.media_id)) errors.push({ in: "entity", path: `/media/${i}/media_id`, code: "unknown_reference" });
  });
  if (errors.length) throw validationFailed(errors);
  const clashes: ApiFieldError[] = [];
  for (const t of snapshot.translations) {
    if (slugOwner(db, t.locale_code, t.slug, root.id)) clashes.push({ in: "entity", path: `/translations/${t.locale_code}/slug`, code: "duplicate" });
  }
  if (clashes.length && root.status !== "published") throw duplicate(clashes);

  const stamp = tick(db);
  const note = (typeof input.change_note === "string" && input.change_note) || `restore of v${rev.version}`;
  pushRevision(db, "posts", root.id, "cms.posts", "restore", structuredClone(current) as unknown as Record<string, unknown>, note, stamp, MOCK_USER);
  const next = structuredClone(snapshot);
  if (root.status === "published") {
    const draft = postDraftRow(db, root);
    if (draft) draft.snapshot = next as unknown as Record<string, unknown>;
    else pushRevision(db, "posts", root.id, "cms.posts", "draft", next as unknown as Record<string, unknown>, null, stamp, MOCK_USER);
  } else {
    root.live = next;
  }
  commitWrite(root, stamp);
  return { data: { ...writeResult(db, root), restored_from: restoredFrom }, etag: etagOfPost(root) };
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers of a browser click-through (`window.__MATERM_MOCK__`)
// ---------------------------------------------------------------------------------------------------------------
// Somebody else saved the post: the next command with the old ETag is a 409 CONFLICT_LOCK_VERSION.
export function touchPostAsSomeoneElse(db: MockDb, id: number): number {
  const root = db.posts.find((p) => p.id === id);
  if (!root) throw notFound();
  touch(db, root);
  root.updated_by = SOMCHAI;
  return root.lock_version;
}

export const postsSummary = (db: MockDb) =>
  db.posts.map((p) => ({ id: p.id, status: p.status, lock_version: p.lock_version, deleted_at: p.deleted_at, created_by: p.created_by?.id ?? null }));

// For the previews: the path of a post is `/blog/<slug of the language>`, the default language's slug when it has none.
export function postPreviewPath(db: MockDb, root: MockPostRoot, locale: string): string {
  const snap = postWorking(db, root);
  const slug = snap.translations.find((t) => t.locale_code === locale)?.slug ?? snap.translations.find((t) => t.locale_code === DEFAULT_LOCALE_CODE)?.slug ?? String(root.id);
  return `/blog/${slug}`;
}

export { canUpdate as canUpdatePost, isOwner as isPostOwner };

// ---------------------------------------------------------------------------------------------------------------
// D1: review and schedule (05 12.10 - 12.11), the generic model of `mock-review-schedule.ts`
// ---------------------------------------------------------------------------------------------------------------
const d1 = makeReviewSchedule<MockPostRoot>({
  kind: "posts",
  entityType: "cms.posts",
  permission: "cms.blog",
  path: "/posts/{id}",
  review: true,
  find: findPost,
  requireMatch,
  touch,
  trashedCheck,
  hasDraft,
  validate: validatePostForPublish,
  blockedError,
  writeResult: (db, root, warnings) => writeResult(db, root, warnings as SaveLiveWarning[]),
  etag: etagOfPost,
  snapshot: (db, root) => postWorking(db, root) as unknown as Record<string, unknown>,
  // `update` | `update_own` of mine (submit); `review`, `publish` and `schedule` are the editor's only.
  denied: (db, root, action) => ((action === "update" ? canUpdate(db, root) : roleOf(db) === "editor") ? null : action),
  publishNow: (db, id) => {
    publishPost(db, id, new URLSearchParams(), undefined, etagOfPost(findPost(db, id)), true);
  },
});
export const submitPostForReview = d1.submitReview;
export const rejectPost = d1.reject;
export const schedulePost = d1.schedule;
export const unschedulePost = d1.unschedule;
export const firePostSchedule = d1.fire;
export const failPostSchedule = d1.fail3;
export const makePostScheduleOverdue = d1.makeOverdue;
