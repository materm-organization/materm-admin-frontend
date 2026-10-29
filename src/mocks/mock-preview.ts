// In-memory model of the preview-link endpoints (doc/05 section 12.9, doc/api/openapi-admin.yaml: createPagePreviewLink,
// listPagePreviewLinks, revokePreviewLink), strict like the backend (`modules/cms/preview`):
//  - POST /pages/{id}/preview-links   body optional `{ locale?, ttl_minutes? }` (unknown field / bad type / `ttl_minutes` outside
//    1..1440 -> 422), then 503 when the server has no portal URL (`details.dependency = "preview.portalUrl"`, before anything is
//    written), 422 `unknown_reference` at /locale for an inactive language, the 30-per-hour limit (429 + Retry-After; every
//    attempt that gets this far counts, also one that then fails), trashed page 409 `INVALID_STATE`, 20 live links per user and
//    page (422 `limit_exceeded`). 201 + `Cache-Control: no-store`; the raw token exists ONLY inside the answer's `url`.
//  - GET  /pages/{id}/preview-links   `state` (active default | expired | revoked | all), `sort`, `page`, `limit`; a holder of
//    `update` sees every user's links, a translate-only user only their own; rows never have a url / token.
//  - DELETE /preview-links/{id}       the owner or an `update` holder (else 403); a second revoke is a 200.
// Times are wall-clock (a link lives 30 real minutes). `MOCK_USER` is "me" for every write of the model.
import {
  MOCK_ACTIVE_LOCALE_CODES,
  MOCK_USER,
  DEFAULT_LOCALE_CODE,
  fail,
  invalidState,
  notFound,
  validationFailed,
  pushRevision,
  paginate,
  type MockDb,
  type MockPreviewLink,
  type Params,
} from "@/mocks/mock-core";
import { findRoot, isTrashed, working } from "@/mocks/mock-pages";
import { canUpdatePost, findPost, postIsTrashed, postPreviewPath, postWorking, roleOf } from "@/mocks/mock-posts";
import type { ApiFieldError } from "@/types/api";
import type { UserRef } from "@/types/media";
import type { PreviewLinkCreated, PreviewLinkItem, PreviewLinkRevoked, PreviewLinkState } from "@/types/preview-links";

export const PREVIEW_PORTAL_URL = "https://materm.example";
export const PREVIEW_MAX_LIVE = 20;
export const PREVIEW_RATE_LIMIT = 30;
const HOUR_MS = 3_600_000;
const SOMCHAI: UserRef = { id: 4, name: "Somchai Vongsa" };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const iso = (ms: number) => new Date(ms).toISOString();

type Kind = "pages" | "posts";

// Does the translate-only model (no `update`, no `review` on the page) apply?
const translatorOnly = (db: MockDb) => db.translateOnly.includes("pages");
// What the signed-in user may do with the links of an entity: a post follows PT-2 (`update`, or `update_own` of my own post),
// a page needs `update`. `holder` = the user can create links and sees every user's links of it.
function holdsUpdate(db: MockDb, kind: Kind, id: number): boolean {
  if (kind === "pages") return !translatorOnly(db);
  const root = db.posts.find((p) => p.id === id);
  return root ? canUpdatePost(db, root) : roleOf(db) === "editor";
}

function stateOf(link: MockPreviewLink, now = Date.now()): PreviewLinkState {
  if (link.revoked_at !== null) return "revoked";
  return link.expires_at <= now ? "expired" : "active";
}

// 32 random bytes as base64url without padding = 43 characters (05 12.9.6).
export function newPreviewToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------------------------------------------
export function createPreviewLink(db: MockDb, id: string, body: unknown, kind: Kind = "pages"): PreviewLinkCreated {
  // The route policy comes first: `read` + (`update` | `review`) - a translator has neither. For a post the owner counts
  // with `update_own` (05 13.3.8, Q-A34), so the post is looked up first.
  const key = kind === "pages" ? "cms.pages" : "cms.blog";
  const denied = () => fail(403, "FORBIDDEN", "You do not have permission to perform this action.", { details: { summary: `${key}:read & (${key}:update | ${key}:review) POST preview-links` } });
  if (kind === "pages" && translatorOnly(db)) throw denied();
  const root = kind === "pages" ? findRoot(db, id) : findPost(db, id);
  if (!holdsUpdate(db, kind, root.id)) throw denied();

  if (body !== undefined && body !== null && !isObject(body)) throw validationFailed([{ in: "body", path: "", code: "invalid_type" }]);
  const input = (body ?? {}) as Record<string, unknown>;
  const errors: ApiFieldError[] = [];
  for (const key of Object.keys(input)) if (key !== "locale" && key !== "ttl_minutes") errors.push({ in: "body", path: `/${key}`, code: "unknown_field" });
  let ttl = 30;
  if (input.ttl_minutes !== undefined) {
    if (typeof input.ttl_minutes !== "number" || !Number.isInteger(input.ttl_minutes)) errors.push({ in: "body", path: "/ttl_minutes", code: "invalid_type" });
    else if (input.ttl_minutes < 1 || input.ttl_minutes > 1440) errors.push({ in: "body", path: "/ttl_minutes", code: "out_of_range", params: { min: 1, max: 1440 } });
    else ttl = input.ttl_minutes;
  }
  if (input.locale !== undefined && (typeof input.locale !== "string" || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(input.locale))) {
    errors.push({ in: "body", path: "/locale", code: typeof input.locale === "string" ? "pattern_mismatch" : "invalid_type" });
  }
  if (errors.length) throw validationFailed(errors);

  // Before anything is written, any limiter hit and any lookup.
  if (db.previewUnconfigured) {
    throw fail(503, "SERVICE_UNAVAILABLE", "A service this request depends on is not available.", { details: { dependency: "preview.portalUrl" } });
  }
  let locale = DEFAULT_LOCALE_CODE;
  if (typeof input.locale === "string") {
    if (!(MOCK_ACTIVE_LOCALE_CODES as readonly string[]).includes(input.locale)) throw validationFailed([{ in: "body", path: "/locale", code: "unknown_reference" }]);
    locale = input.locale;
  }

  // 30 links per user and hour, all pages together; counted before the page is looked at, so a refusal below still counts.
  const now = Date.now();
  db.previewIssued = db.previewIssued.filter((t) => now - t < HOUR_MS);
  if (db.previewIssued.length >= PREVIEW_RATE_LIMIT) {
    const retry = Math.max(1, Math.ceil((db.previewIssued[0] + HOUR_MS - now) / 1000));
    throw fail(429, "RATE_LIMITED", "Too many requests. Try again later.", {}, { "Retry-After": String(retry) });
  }
  db.previewIssued.push(now);

  if (kind === "pages" ? isTrashed(root as ReturnType<typeof findRoot>) : postIsTrashed(root as ReturnType<typeof findPost>)) throw invalidState("trashed");
  const live = db.previewLinks.filter((l) => l.entity === kind && l.page_id === root.id && l.created_by?.id === MOCK_USER.id && stateOf(l, now) === "active").length;
  if (live >= PREVIEW_MAX_LIVE) throw validationFailed([{ in: "body", path: "", code: "limit_exceeded", params: { max: PREVIEW_MAX_LIVE } }]);

  // Freeze the working copy (a page that was never published has no draft row: the real rows are used).
  const snapshot = kind === "pages" ? working(db, root as ReturnType<typeof findRoot>) : postWorking(db, root as ReturnType<typeof findPost>);
  const frozenAt = iso(now);
  const revision = pushRevision(db, kind, root.id, `cms.${kind}`, "history", structuredClone(snapshot) as unknown as Record<string, unknown>, "preview", frozenAt, MOCK_USER);
  const link: MockPreviewLink = {
    id: db.nextPreviewLinkId++,
    entity: kind,
    page_id: root.id,
    locale,
    created_by: MOCK_USER,
    created_at: now,
    expires_at: now + ttl * 60_000,
    revoked_at: null,
    last_used_at: null,
    use_count: 0,
    revision: { id: revision.id, version: revision.version, frozen_at: frozenAt },
    frozen_lock_version: root.lock_version,
  };
  db.previewLinks.push(link);

  const token = newPreviewToken();
  const path = kind === "pages" ? (snapshot as ReturnType<typeof working>).page.path : postPreviewPath(db, root as ReturnType<typeof findPost>, locale);
  const url = `${PREVIEW_PORTAL_URL}/api/preview?token=${token}&path=${encodeURIComponent(path)}&locale=${encodeURIComponent(locale)}`;
  return {
    id: link.id,
    url,
    expires_at: iso(link.expires_at),
    locale,
    entity: { type: `cms.${kind}`, id: root.id },
    revision: link.revision,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------------------------------------------
const STATES = ["active", "expired", "revoked", "all"] as const;
const SORTS = ["-created_at", "created_at", "expires_at", "-expires_at"] as const;

function toItem(db: MockDb, link: MockPreviewLink, now: number): PreviewLinkItem {
  const root = link.entity === "pages" ? db.pages.find((p) => p.id === link.page_id) : db.posts.find((p) => p.id === link.page_id);
  return {
    id: link.id,
    locale: link.locale,
    state: stateOf(link, now),
    created_at: iso(link.created_at),
    expires_at: iso(link.expires_at),
    revoked_at: link.revoked_at === null ? null : iso(link.revoked_at),
    last_used_at: link.last_used_at === null ? null : iso(link.last_used_at),
    use_count: link.use_count,
    revision: link.revision,
    is_stale: root ? root.lock_version > link.frozen_lock_version : false,
    created_by: link.created_by,
  };
}

export function listPreviewLinks(db: MockDb, id: string, params: Params, kind: Kind = "pages") {
  const root = kind === "pages" ? findRoot(db, id) : findPost(db, id);
  const errors: ApiFieldError[] = [];
  for (const key of new Set(params.keys())) if (!["state", "sort", "page", "limit"].includes(key)) errors.push({ in: "query", path: `/${key}`, code: "unknown_field" });
  const state = params.get("state") ?? "active";
  if (!(STATES as readonly string[]).includes(state)) errors.push({ in: "query", path: "/state", code: "not_in_enum", params: { expected: [...STATES] } });
  const sort = params.get("sort") ?? "-created_at";
  if (!(SORTS as readonly string[]).includes(sort)) errors.push({ in: "query", path: "/sort", code: "not_in_enum" });
  for (const [name, max] of [["page", Infinity], ["limit", 100]] as const) {
    const raw = params.get(name);
    if (raw !== null && (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max)) errors.push({ in: "query", path: `/${name}`, code: Number(raw) > max ? "out_of_range" : "invalid_format" });
  }
  if (errors.length) throw validationFailed(errors);

  const now = Date.now();
  let rows = db.previewLinks.filter((l) => l.entity === kind && l.page_id === root.id);
  // A holder of `read` alone sees only their own links.
  if (!holdsUpdate(db, kind, root.id)) rows = rows.filter((l) => l.created_by?.id === MOCK_USER.id);
  if (state !== "all") rows = rows.filter((l) => stateOf(l, now) === state);
  const field = sort.replace(/^-/, "") as "created_at" | "expires_at";
  const dir = sort.startsWith("-") ? -1 : 1;
  rows = [...rows].sort((a, b) => (a[field] - b[field]) * dir || (a.id - b.id) * dir);
  const page = paginate(rows, params);
  return { data: page.data.map((l) => toItem(db, l, now)), meta: page.meta };
}

// ---------------------------------------------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------------------------------------------
export function revokePreviewLink(db: MockDb, id: string): PreviewLinkRevoked {
  if (!/^\d+$/.test(id)) throw notFound();
  const link = db.previewLinks.find((l) => l.id === Number(id));
  if (!link) throw notFound();
  // The owner, or a holder of `update` on the entity the link is frozen on.
  const mine = link.created_by?.id === MOCK_USER.id;
  if (!mine && !holdsUpdate(db, link.entity, link.page_id)) throw fail(403, "FORBIDDEN", "You do not have permission to perform this action.");
  if (link.revoked_at === null) link.revoked_at = Date.now();
  return { id: link.id, state: "revoked", revoked_at: iso(link.revoked_at) };
}

// ---------------------------------------------------------------------------------------------------------------
// Seeds and the helpers of a browser click-through (`window.__MATERM_MOCK__`)
// ---------------------------------------------------------------------------------------------------------------
function issueRaw(db: MockDb, pageId: number, who: UserRef, ageMs: number, ttlMin: number, extra: Partial<MockPreviewLink> = {}, reuseRevision?: { id: number; version: number; created_at: string }): MockPreviewLink {
  const root = db.pages.find((p) => p.id === pageId)!;
  const createdAt = Date.now() - ageMs;
  // A seeded link may point at a preview row the page's History already has (page 9) instead of adding one.
  const revision = reuseRevision ?? pushRevision(db, "pages", root.id, "cms.pages", "history", structuredClone(working(db, root)) as unknown as Record<string, unknown>, "preview", iso(createdAt), who);
  const link: MockPreviewLink = {
    id: db.nextPreviewLinkId++,
    entity: "pages",
    page_id: pageId,
    locale: DEFAULT_LOCALE_CODE,
    created_by: who,
    created_at: createdAt,
    expires_at: createdAt + ttlMin * 60_000,
    revoked_at: null,
    last_used_at: null,
    use_count: 0,
    revision: { id: revision.id, version: revision.version, frozen_at: reuseRevision ? reuseRevision.created_at : iso(createdAt) },
    frozen_lock_version: root.lock_version,
    ...extra,
  };
  db.previewLinks.push(link);
  return link;
}

// Page 9: an active link of somebody else that is older than the page's last edit, an expired and a revoked one of mine.
// Page 8 already holds 19 of my active links: one more is fine, the next is `limit_exceeded`.
export function seedPreviewLinks(db: MockDb) {
  const seededRow = db.revisions["pages/9"]?.find((r) => r.is_preview);
  if (db.pages.some((p) => p.id === 9) && seededRow) {
    issueRaw(db, 9, SOMCHAI, 10 * 60_000, 60, { use_count: 3, last_used_at: Date.now() - 2 * 60_000, frozen_lock_version: 1, locale: "en" }, seededRow);
    issueRaw(db, 9, MOCK_USER, 3 * HOUR_MS, 30, { use_count: 1 }, seededRow);
    issueRaw(db, 9, MOCK_USER, 5 * 60_000, 240, { revoked_at: Date.now() - 60_000 }, seededRow);
  }
  if (db.pages.some((p) => p.id === 8)) fillPreviewLinks(db, 8, PREVIEW_MAX_LIVE - 1);
}

export function fillPreviewLinks(db: MockDb, pageId: number, count: number) {
  for (let i = 0; i < count; i++) issueRaw(db, pageId, MOCK_USER, (i + 1) * 60_000, 1440);
}

export const setPreviewUnconfigured = (db: MockDb, on: boolean) => {
  db.previewUnconfigured = on;
};

// The next creation is a 429 (30 links already issued in the last hour).
export function exhaustPreviewRate(db: MockDb) {
  const now = Date.now();
  db.previewIssued = Array.from({ length: PREVIEW_RATE_LIMIT }, (_, i) => now - (PREVIEW_RATE_LIMIT - i) * 1000);
}

// A summary without any url (for a click-through script).
export const previewLinkSummary = (db: MockDb) =>
  db.previewLinks.map((l) => ({ id: l.id, entity: l.entity, page_id: l.page_id, state: stateOf(l), created_by: l.created_by?.id ?? null }));

