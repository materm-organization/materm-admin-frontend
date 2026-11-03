// In-memory model of the authors endpoints, strict to doc/05 section 15 (backend 53cc0c1): save-live rows with a soft delete into the
// 30-day trash, `If-Match` mandatory on PATCH / DELETE / restore / revision restore (`"<updated_at>"`), a revision row per change, the
// field rules of 15.2 (every problem in ONE 422), the merge and translate-only rules of 15.3, the unique user link (409 `duplicate` at
// `/user_id`) and the delete guard of 15.5 (409 `ENTITY_REFERENCED`, `details.reason = author_has_posts`).
// INVENTED seed: authors 1 - 4 (the real seed has none), their links to users 4 / 7 and the posts that use them. A post's `author_id` is
// seeded here (the posts model reads `db.authors`).
import {
  DEFAULT_LOCALE_CODE,
  MOCK_LOCALE_CODES,
  MOCK_USER,
  badRequest,
  boolParam,
  duplicate,
  etagOf,
  fail,
  forbidden,
  invalidState,
  micros,
  notFound,
  paginate,
  pushRevision,
  rejectUnknown,
  requireIfMatch,
  tick,
  validationFailed,
  type MockDb,
  type Params,
} from "@/mocks/mock-core";
import { postIsTrashed, postWorking } from "@/mocks/mock-posts";
import { withLocalOffset } from "@/mocks/mock-taxonomy";
import type { ApiFieldError } from "@/types/api";
import type { Author, AuthorSnapshot, AuthorUserRef } from "@/types/authors";

const TRASH_DAYS = 30;
const SORTABLE = ["display_name", "post_count", "created_at", "updated_at", "deleted_at"];
export const MAX_NAME = 120;
export const MAX_BIO = 2000;
export const MAX_JOB = 120;

// The users the picker and the `user` ref know. INVENTED (the same people the posts model uses).
export const MOCK_AUTHOR_USERS: AuthorUserRef[] = [
  { id: 4, name: "Somchai Vongsa", username: "somchai" },
  { id: 6, name: "Noy Keomany", username: "noy" },
  { id: 7, name: "Dara Phommachan", username: "dara" },
  { id: 9, name: "Lao Editor", username: "laoeditor" },
];

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const body = (path: string, code: string, params?: ApiFieldError["params"]): ApiFieldError => ({ in: "body", path, code, ...(params ? { params } : {}) });
const len = (v: string) => [...v.trim()].length;
const textOrNull = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export function seedAuthors(db: MockDb) {
  const at = micros(Date.UTC(2026, 9, 29, 9, 0, 0), 500);
  const row = (id: number, display_name: string, extra: Partial<Author>): Author => ({
    id,
    public_id: `0192d3a4-7c1e-7b52-9d0a-0000000000a${id}`,
    display_name,
    user_id: null,
    user: null,
    avatar_media_id: null,
    avatar: null,
    is_active: true,
    translations: {},
    post_count: 0,
    published_post_count: 0,
    created_by: MOCK_USER,
    updated_by: MOCK_USER,
    created_at: at,
    updated_at: at,
    deleted_at: null,
    purge_at: null,
    ...extra,
  });
  const trashedAt = micros(Date.UTC(2026, 9, 30, 9, 0, 0), 500);
  db.authors = [
    row(1, "Somchai Vongsa", { user_id: 4, translations: { la: { bio: "Somchai writes about trails.", job_title: "Editor in chief" }, en: { bio: "Somchai writes about trails.", job_title: "Editor in chief" } } }),
    row(2, "Dara Phommachan", { user_id: 7, translations: { en: { bio: null, job_title: "Photographer" } } }),
    row(3, "Mali Keo", { is_active: false, translations: { la: { bio: null, job_title: "Guest writer" } } }),
    row(4, "Old Contributor", { deleted_at: trashedAt, purge_at: new Date(Date.parse(trashedAt) + TRASH_DAYS * 86_400_000).toISOString(), updated_at: trashedAt }),
  ];
  db.nextAuthorId = 5;
  // Who wrote the seeded posts (a post the seed does not name has no author).
  const byPost: Record<number, number> = { 2: 2, 4: 1, 5: 3, 6: 1 };
  for (const p of db.posts) p.live.post.author_id = byPost[p.id] ?? null;
}

// ---- counts and the view ------------------------------------------------------------------------------------------------
function counts(db: MockDb, id: number) {
  const mine = db.posts.filter((p) => !postIsTrashed(p) && (postWorking(db, p).post.author_id ?? null) === id);
  return { post_count: mine.length, published_post_count: mine.filter((p) => p.status === "published" || p.status === "scheduled").length };
}

function view(db: MockDb, row: Author, warnings?: Author["warnings"]): Author {
  const user = row.user_id === null ? null : (MOCK_AUTHOR_USERS.find((u) => u.id === row.user_id) ?? null);
  const asset = row.avatar_media_id === null ? undefined : db.assets.find((a) => a.id === row.avatar_media_id);
  return {
    ...structuredClone(row),
    user,
    avatar: asset
      ? { id: asset.id, status: asset.status, original_filename: asset.original_filename, mime_type: asset.mime_type, width: asset.width ?? null, height: asset.height ?? null, url: asset.url }
      : null,
    ...counts(db, row.id),
    created_at: withLocalOffset(row.created_at) as string,
    updated_at: withLocalOffset(row.updated_at) as string,
    etag: etagOf(row.updated_at),
    ...(warnings ? { warnings } : {}),
  };
}

function findRow(db: MockDb, id: string): Author {
  const row = db.authors.find((a) => String(a.id) === id);
  if (!row) throw notFound();
  return row;
}

export function authorSnapshot(row: Author): AuthorSnapshot {
  return {
    author: { display_name: row.display_name, user_id: row.user_id, avatar_media_id: row.avatar_media_id, is_active: row.is_active },
    translations: Object.entries(row.translations)
      .filter(([, t]) => t.bio || t.job_title)
      .map(([locale_code, t]) => ({ locale_code, bio: t.bio ?? null, job_title: t.job_title ?? null }))
      .sort((a, b) => a.locale_code.localeCompare(b.locale_code)),
  };
}

// ---- field rules (15.2): every problem at once ------------------------------------------------------------------------------
const ALLOWED = ["display_name", "user_id", "avatar_media_id", "is_active", "translations"];

function fieldErrors(db: MockDb, b: Record<string, unknown>, mode: "create" | "patch"): ApiFieldError[] {
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(b)) if (!ALLOWED.includes(k)) errors.push(body(`/${k}`, "unknown_field"));
  if (mode === "patch" && Object.keys(b).length === 0) errors.push(body("", "min_properties"));
  if (mode === "create" || "display_name" in b) {
    if (typeof b.display_name !== "string") errors.push(body("/display_name", b.display_name === undefined || b.display_name === null ? "required" : "invalid_type"));
    else if (b.display_name.trim() === "") errors.push(body("/display_name", "required"));
    else if (len(b.display_name) > MAX_NAME) errors.push(body("/display_name", "too_long", { max: MAX_NAME }));
  }
  if ("user_id" in b && b.user_id !== null) {
    if (!Number.isInteger(b.user_id) || (b.user_id as number) < 1) errors.push(body("/user_id", "out_of_range"));
    else if (!MOCK_AUTHOR_USERS.some((u) => u.id === b.user_id)) errors.push(body("/user_id", "unknown_reference", { ref_type: "users" }));
  }
  if ("avatar_media_id" in b && b.avatar_media_id !== null) {
    if (!Number.isInteger(b.avatar_media_id) || (b.avatar_media_id as number) < 1) errors.push(body("/avatar_media_id", "out_of_range"));
    else {
      const asset = db.assets.find((a) => a.id === b.avatar_media_id && !a.deleted_at);
      if (!asset) errors.push(body("/avatar_media_id", "unknown_reference", { ref_type: "media_assets" }));
      else if (asset.kind !== "image") errors.push(body("/avatar_media_id", "kind_mismatch", { expected: "image" }));
    }
  }
  if ("is_active" in b && typeof b.is_active !== "boolean") errors.push(body("/is_active", "invalid_type"));
  if ("translations" in b) {
    if (!isObject(b.translations)) errors.push(body("/translations", "invalid_type"));
    else {
      for (const [code, t] of Object.entries(b.translations)) {
        if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code)) errors.push(body(`/translations/${code}`, "invalid_format"));
        else if (!(MOCK_LOCALE_CODES as readonly string[]).includes(code)) errors.push(body(`/translations/${code}`, "unknown_reference"));
        else if (t === null) {
          if (mode === "create") errors.push(body(`/translations/${code}`, "invalid_type"));
        } else if (!isObject(t)) errors.push(body(`/translations/${code}`, "invalid_type"));
        else {
          for (const k of Object.keys(t)) if (k !== "bio" && k !== "job_title") errors.push(body(`/translations/${code}/${k}`, "unknown_field"));
          if (typeof t.bio === "string" && len(t.bio) > MAX_BIO) errors.push(body(`/translations/${code}/bio`, "too_long", { max: MAX_BIO }));
          if (typeof t.job_title === "string" && len(t.job_title) > MAX_JOB) errors.push(body(`/translations/${code}/job_title`, "too_long", { max: MAX_JOB }));
        }
      }
    }
  }
  return errors;
}

const userTaken = (db: MockDb, userId: number | null, selfId?: number) =>
  userId !== null && db.authors.some((a) => a.id !== selfId && !a.deleted_at && a.user_id === userId);
const dupUser = () => body("/user_id", "duplicate");

// ---- list / get --------------------------------------------------------------------------------------------------------------
export function listAuthors(db: MockDb, params: Params) {
  rejectUnknown(params, ["page", "limit", "keyword", "is_active", "has_user", "trashed", "sort"]);
  const trashed = boolParam(params, "trashed") ?? false;
  const active = boolParam(params, "is_active");
  const hasUser = boolParam(params, "has_user");
  const sort = params.get("sort") ?? (trashed ? "-deleted_at" : "display_name");
  const m = /^(-?)([a-z_]+)$/.exec(sort);
  if (!m || !SORTABLE.includes(m[2])) throw validationFailed([{ in: "query", path: "/sort", code: "not_in_enum" }]);
  const kw = params.get("keyword")?.trim().toLowerCase();
  const rows = db.authors
    .filter((a) => {
      if (Boolean(a.deleted_at) !== trashed) return false;
      if (active !== undefined && a.is_active !== active) return false;
      if (hasUser !== undefined && (a.user_id !== null) !== hasUser) return false;
      if (kw) {
        const hay = [a.display_name, ...Object.values(a.translations).flatMap((t) => [t.bio ?? "", t.job_title ?? ""])].join("\n").toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    })
    .map((a) => view(db, a));
  const dir = m[1] ? -1 : 1;
  rows.sort((a, b) => {
    const x = (a as unknown as Record<string, string | number | null>)[m[2]] ?? "";
    const y = (b as unknown as Record<string, string | number | null>)[m[2]] ?? "";
    const cx = typeof x === "string" ? x.toLowerCase() : x;
    const cy = typeof y === "string" ? y.toLowerCase() : y;
    return (cx < cy ? -1 : cx > cy ? 1 : 0) * dir || a.id - b.id;
  });
  return paginate(rows, params);
}

export function getAuthor(db: MockDb, id: string) {
  const row = findRow(db, id);
  return { data: view(db, row), etag: etagOf(row.updated_at) };
}

// ---- POST / PATCH ------------------------------------------------------------------------------------------------------------
function applyTranslations(target: Author, input: Record<string, Record<string, unknown> | null>) {
  for (const [code, t] of Object.entries(input)) {
    if (t === null) {
      delete target.translations[code];
      continue;
    }
    const merged = { ...(target.translations[code] ?? { bio: null, job_title: null }) };
    if ("bio" in t) merged.bio = textOrNull(t.bio);
    if ("job_title" in t) merged.job_title = textOrNull(t.job_title);
    // A language with neither text goes away.
    if (merged.bio === null && merged.job_title === null) delete target.translations[code];
    else target.translations[code] = merged;
  }
}

export function createAuthor(db: MockDb, input: unknown) {
  if (!isObject(input)) throw badRequest();
  const errors = fieldErrors(db, input, "create");
  if (errors.length) throw validationFailed(errors);
  const userId = (input.user_id as number | null | undefined) ?? null;
  if (userTaken(db, userId)) throw duplicate([dupUser()]);
  const at = tick(db);
  const row: Author = {
    id: db.nextAuthorId++,
    public_id: `0192d3a4-7c1e-7b52-9d0a-${String(db.nextAuthorId).padStart(12, "0")}`,
    display_name: (input.display_name as string).trim(),
    user_id: userId,
    user: null,
    avatar_media_id: (input.avatar_media_id as number | null | undefined) ?? null,
    avatar: null,
    is_active: typeof input.is_active === "boolean" ? input.is_active : true,
    translations: {},
    post_count: 0,
    published_post_count: 0,
    created_by: MOCK_USER,
    updated_by: MOCK_USER,
    created_at: at,
    updated_at: at,
    deleted_at: null,
    purge_at: null,
  };
  if (isObject(input.translations)) applyTranslations(row, input.translations as Record<string, Record<string, unknown> | null>);
  db.authors.push(row);
  return { data: view(db, row, []), etag: etagOf(row.updated_at) };
}

// Translate-only (15.3): the bio / job title of a language that is not the default one; a whole language is never deleted.
function translateOnlyWriter(db: MockDb) {
  return db.translateOnly.includes("authors") || db.translateOnly.includes("posts");
}

export function patchAuthor(db: MockDb, id: string, input: unknown, ifMatch: string | null) {
  const row = findRow(db, id);
  if (!isObject(input)) throw badRequest();
  const errors = fieldErrors(db, input, "patch");
  if (errors.length) throw validationFailed(errors);
  requireIfMatch(ifMatch, etagOf(row.updated_at));
  if (row.deleted_at) throw invalidState("trashed");
  if (translateOnlyWriter(db)) {
    for (const k of Object.keys(input)) if (k !== "translations") throw forbidden(`/${k}`);
    for (const [code, t] of Object.entries(input.translations as Record<string, unknown>)) {
      if (code === DEFAULT_LOCALE_CODE) throw forbidden(`/translations/${code}`);
      if (t === null) throw forbidden(`/translations/${code}`);
    }
  }

  const next = structuredClone(row);
  if ("display_name" in input) next.display_name = (input.display_name as string).trim();
  if ("user_id" in input) next.user_id = input.user_id as number | null;
  if ("avatar_media_id" in input) next.avatar_media_id = input.avatar_media_id as number | null;
  if ("is_active" in input) next.is_active = input.is_active as boolean;
  if (isObject(input.translations)) applyTranslations(next, input.translations as Record<string, Record<string, unknown> | null>);
  if (JSON.stringify(authorSnapshot(next)) === JSON.stringify(authorSnapshot(row))) return { data: view(db, row, []), etag: etagOf(row.updated_at) };
  if (next.user_id !== row.user_id && userTaken(db, next.user_id, row.id)) throw duplicate([dupUser()]);

  const at = tick(db);
  pushRevision(db, "authors", row.id, "cms.authors", "history", authorSnapshot(row) as unknown as Record<string, unknown>, null, at, MOCK_USER);
  Object.assign(row, next, { updated_at: at, updated_by: MOCK_USER });
  return { data: view(db, row, []), etag: etagOf(row.updated_at) };
}

// ---- DELETE / restore --------------------------------------------------------------------------------------------------------
export function deleteAuthor(db: MockDb, id: string, ifMatch: string | null) {
  const row = findRow(db, id);
  requireIfMatch(ifMatch, etagOf(row.updated_at));
  if (row.deleted_at) return;
  const { post_count } = counts(db, row.id);
  if (post_count > 0) {
    throw fail(409, "ENTITY_REFERENCED", `Cannot delete: ${post_count} post(s) use this author.`, { details: { reason: "author_has_posts", post_count } });
  }
  const at = tick(db);
  row.deleted_at = at;
  row.purge_at = new Date(Date.parse(at) + TRASH_DAYS * 86_400_000).toISOString();
  row.updated_at = at;
  row.updated_by = MOCK_USER;
}

export function restoreAuthorFromTrash(db: MockDb, id: string, ifMatch: string | null) {
  const row = findRow(db, id);
  requireIfMatch(ifMatch, etagOf(row.updated_at));
  if (!row.deleted_at) throw invalidState("not_trashed");
  if (userTaken(db, row.user_id, row.id)) throw duplicate([dupUser()]);
  row.deleted_at = null;
  row.purge_at = null;
  row.updated_at = tick(db);
  row.updated_by = MOCK_USER;
  return { data: view(db, row, []), etag: etagOf(row.updated_at) };
}

// ---- revisions (15.4) --------------------------------------------------------------------------------------------------------
export function restoreAuthor(db: MockDb, id: string, rev: { id: number; version: number; schema_version: number; snapshot: Record<string, unknown> }, note: string, ifMatch: string | null) {
  const row = findRow(db, id);
  requireIfMatch(ifMatch, etagOf(row.updated_at));
  if (row.deleted_at) throw invalidState("trashed");
  if (rev.schema_version > 1) throw invalidState("snapshot_incompatible");
  const snap = rev.snapshot as Partial<AuthorSnapshot>;
  const restoredFrom = { revision_id: rev.id, version: rev.version };
  const next = structuredClone(row);
  if (snap.author) {
    next.display_name = snap.author.display_name;
    next.user_id = snap.author.user_id;
    next.avatar_media_id = snap.author.avatar_media_id;
    next.is_active = snap.author.is_active;
  }
  next.translations = Object.fromEntries((snap.translations ?? []).map((t) => [t.locale_code, { bio: t.bio, job_title: t.job_title }]));
  if (JSON.stringify(authorSnapshot(next)) === JSON.stringify(authorSnapshot(row))) {
    return { data: { ...view(db, row, []), restored_from: restoredFrom }, etag: etagOf(row.updated_at) };
  }
  if (next.user_id !== row.user_id && userTaken(db, next.user_id, row.id)) throw duplicate([{ in: "entity", path: "/author/user_id", code: "duplicate" }]);
  const at = tick(db);
  pushRevision(db, "authors", row.id, "cms.authors", "restore", authorSnapshot(row) as unknown as Record<string, unknown>, note, at, MOCK_USER);
  Object.assign(row, next, { updated_at: at, updated_by: MOCK_USER });
  return { data: { ...view(db, row, []), restored_from: restoredFrom }, etag: etagOf(row.updated_at) };
}

// One earlier version of Somchai (the state BEFORE an edit). INVENTED history.
export function seedAuthorRevisions(db: MockDb) {
  const a = db.authors[0];
  const before = authorSnapshot({ ...a, translations: { la: { bio: "Somchai writes.", job_title: "Writer" } } });
  pushRevision(db, "authors", a.id, "cms.authors", "history", before as unknown as Record<string, unknown>, null, micros(Date.UTC(2026, 9, 30, 8, 0, 0), 300), { id: 4, name: "Somchai Vongsa" });
}

// ---- GET /users (only what the author form's picker reads) -------------------------------------------------------------------------
export function listUsersForPicker(params: Params) {
  const kw = params.get("keyword")?.trim().toLowerCase();
  const rows = MOCK_AUTHOR_USERS.filter((u) => !kw || u.name.toLowerCase().includes(kw) || u.username.includes(kw));
  return paginate(rows, params);
}
