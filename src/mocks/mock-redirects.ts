// In-memory model of the redirects endpoints (doc/05 section 6.10, FR-SEO-05/06, BR-26). Save-live: a write is live at once, `If-Match`
// mandatory on PATCH / DELETE (`"<updated_at>"`), a revision row per change.
// PROVISIONAL (the spec lists paths only; to be reconciled with the backend): the list filters (`keyword`, `status_code`,
// `locale_code` = a code or `all`, `is_active`, `sort`), the body / answer of `POST /redirects/check`, the 422 codes `redirect_loop`,
// `redirect_chain_too_long`, `target_equals_source` on `target`, the 409 `CONFLICT_DUPLICATE` on `/source_path`, the non-blocking write
// warning `page_published`, the CSV `from,to,code` of the export and the revision snapshot `{ redirect: {...} }`.
import {
  MOCK_LOCALE_CODES,
  MOCK_USER,
  badRequest,
  boolParam,
  duplicate,
  etagOf,
  micros,
  notFound,
  paginate,
  pushRevision,
  rejectUnknown,
  requireIfMatch,
  tick,
  validationFailed,
  invalidState,
  type MockDb,
  type Params,
} from "@/mocks/mock-core";
import { withLocalOffset } from "@/mocks/mock-taxonomy";
import type { ApiFieldError } from "@/types/api";
import type { SaveLiveWarning } from "@/types/media";
import type { Redirect, RedirectCheckIssue, RedirectCheckResult, RedirectStatusCode } from "@/types/redirects";

const SEED_AT = micros(Date.UTC(2026, 9, 26, 9, 0, 0), 210);
const STATUS_CODES = [301, 302, 307, 308];
const SORTABLE = ["source_path", "target", "status_code", "created_at", "updated_at"];
export const MAX_HOPS = 3;

export function seedRedirects(db: MockDb) {
  const row = (id: number, source_path: string, target: string, status_code: RedirectStatusCode, extra: Partial<Redirect> = {}): Redirect => ({
    id,
    public_id: `0192d3a4-7c1e-7b52-9d0a-0000000000e${id}`,
    source_path,
    target,
    status_code,
    locale_code: null,
    is_active: true,
    note: null,
    created_by: MOCK_USER,
    updated_by: MOCK_USER,
    created_at: micros(Date.UTC(2026, 9, 24, 9, 0, 0), 200 + id),
    updated_at: micros(Date.UTC(2026, 9, 24, 9, 0, 0), 200 + id),
    ...extra,
  });
  // INVENTED rows (the real seed has none): a plain one, a language-specific one, an external one, an inactive one and a two-step chain.
  db.redirects = [
    row(1, "/old-blog", "/blog", 301, { note: "Blog moved in 2025" }),
    row(2, "/about", "/our-path", 302),
    row(3, "/gallery-2025", "/gallery", 301, { locale_code: "en" }),
    row(4, "/promo", "https://example.com/promo", 307, { note: "Partner landing page" }),
    row(5, "/legacy", "/contact", 308, { is_active: false }),
    row(6, "/team", "/about", 301),
  ];
  db.nextRedirectId = 7;
  void SEED_AT;
}

const stamped = (row: Redirect): Redirect => ({
  ...structuredClone(row),
  created_at: withLocalOffset(row.created_at) as string,
  updated_at: withLocalOffset(row.updated_at) as string,
  etag: etagOf(row.updated_at),
});

function findRow(db: MockDb, id: string): Redirect {
  const row = db.redirects.find((r) => String(r.id) === id);
  if (!row) throw notFound();
  return row;
}

export function redirectSnapshot(row: Pick<Redirect, "source_path" | "locale_code" | "target" | "status_code" | "is_active" | "note">): Record<string, unknown> {
  return { redirect: { source_path: row.source_path, locale_code: row.locale_code, target: row.target, status_code: row.status_code, is_active: row.is_active, note: row.note } };
}

// ---------------------------------------------------------------------------------------------------------------
// Check (FR-SEO-06, BR-26)
// ---------------------------------------------------------------------------------------------------------------
const normSource = (v: string) => {
  let s = v.trim().toLowerCase();
  if (s && !s.startsWith("/")) s = `/${s}`;
  while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
};

type Candidate = { id?: number; source_path: string; target: string; locale_code: string | null };

function analyse(db: MockDb, c: Candidate): { errors: RedirectCheckIssue[]; warnings: RedirectCheckIssue[] } {
  const errors: RedirectCheckIssue[] = [];
  const warnings: RedirectCheckIssue[] = [];
  const source = normSource(c.source_path);
  if (c.target === source) errors.push({ code: "target_equals_source" });

  if (db.redirects.some((r) => r.id !== c.id && r.source_path === source && (r.locale_code ?? "") === (c.locale_code ?? ""))) {
    errors.push({ code: "duplicate", params: { path: source } });
  }

  // Follow the active redirects from the target (internal only). A redirect applies to the language of the candidate when it has no language
  // or the same one; a candidate for every language meets every redirect.
  if (c.target.startsWith("/") && c.target !== source) {
    const chain = [source, c.target];
    let current = c.target;
    let hops = 1;
    for (;;) {
      const next = db.redirects.find(
        (r) => r.id !== c.id && r.is_active && r.source_path === current && (c.locale_code === null || r.locale_code === null || r.locale_code === c.locale_code)
      );
      if (!next) break;
      hops += 1;
      if (chain.slice(0, -1).includes(next.target) || next.target === source) {
        chain.push(next.target);
        errors.push({ code: "redirect_loop", params: { chain } });
        break;
      }
      chain.push(next.target);
      current = next.target;
      if (!current.startsWith("/")) break;
      if (hops > 10) break;
    }
    if (!errors.some((e) => e.code === "redirect_loop") && hops > MAX_HOPS) {
      errors.push({ code: "redirect_chain_too_long", params: { hops, max: MAX_HOPS, final_target: chain[chain.length - 1], chain } });
    }
  }

  // BR-26: a published page at the same path wins over the redirect.
  const page = db.pages.find((p) => p.status === "published" && !p.deleted_at && p.live.page.path === source);
  if (page) warnings.push({ code: "page_published", params: { path: source, page_id: page.id } });
  return { errors, warnings };
}

export function checkRedirect(db: MockDb, body: unknown): RedirectCheckResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw badRequest();
  const b = body as Record<string, unknown>;
  const errors: ApiFieldError[] = [];
  for (const k of Object.keys(b)) if (!["source_path", "target", "status_code", "locale_code", "id"].includes(k)) errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  if (typeof b.source_path !== "string" || b.source_path.trim() === "") errors.push({ in: "body", path: "/source_path", code: b.source_path === undefined ? "required" : "invalid_type" });
  if (typeof b.target !== "string" || b.target.trim() === "") errors.push({ in: "body", path: "/target", code: b.target === undefined ? "required" : "invalid_type" });
  if (errors.length) throw validationFailed(errors);
  const locale = typeof b.locale_code === "string" && b.locale_code !== "" ? b.locale_code : null;
  const result = analyse(db, { id: typeof b.id === "number" ? b.id : undefined, source_path: b.source_path as string, target: (b.target as string).trim(), locale_code: locale });
  return { valid: result.errors.length === 0, ...result };
}

// ---------------------------------------------------------------------------------------------------------------
// Validation of a write
// ---------------------------------------------------------------------------------------------------------------
function validateFields(db: MockDb, body: Record<string, unknown>, mode: "create" | "patch"): ApiFieldError[] {
  const errors: ApiFieldError[] = [];
  const allowed = ["source_path", "target", "status_code", "locale_code", "is_active", "note"];
  for (const k of Object.keys(body)) if (!allowed.includes(k)) errors.push({ in: "body", path: `/${k}`, code: "unknown_field" });
  if (mode === "patch" && Object.keys(body).length === 0) errors.push({ in: "body", path: "", code: "min_properties" });
  if (mode === "create" || "source_path" in body) {
    const v = body.source_path;
    if (typeof v !== "string") errors.push({ in: "body", path: "/source_path", code: v === undefined ? "required" : "invalid_type" });
    else if (!/^\/[^\s?#]*$/.test(normSource(v)) || normSource(v).startsWith("//") || /:\/\//.test(v)) errors.push({ in: "body", path: "/source_path", code: "pattern_mismatch" });
    else if (normSource(v).length > 500) errors.push({ in: "body", path: "/source_path", code: "too_long", params: { max: 500 } });
  }
  if (mode === "create" || "target" in body) {
    const v = body.target;
    if (typeof v !== "string") errors.push({ in: "body", path: "/target", code: v === undefined ? "required" : "invalid_type" });
    else if (!/^(\/(?!\/)|https:\/\/)\S*$/i.test(v.trim())) errors.push({ in: "body", path: "/target", code: "pattern_mismatch" });
    else if (v.trim().length > 2000) errors.push({ in: "body", path: "/target", code: "too_long", params: { max: 2000 } });
  }
  if ("status_code" in body && (typeof body.status_code !== "number" || !STATUS_CODES.includes(body.status_code))) errors.push({ in: "body", path: "/status_code", code: "not_in_enum" });
  if ("locale_code" in body && body.locale_code !== null && (typeof body.locale_code !== "string" || !(MOCK_LOCALE_CODES as readonly string[]).includes(body.locale_code))) {
    errors.push({ in: "body", path: "/locale_code", code: "unknown_reference" });
  }
  if ("is_active" in body && typeof body.is_active !== "boolean") errors.push({ in: "body", path: "/is_active", code: "invalid_type" });
  if ("note" in body && body.note !== null && (typeof body.note !== "string" || [...body.note].length > 500)) errors.push({ in: "body", path: "/note", code: "too_long", params: { max: 500 } });
  void db;
  return errors;
}

// The chain rules and the collision with another row, as the errors of a write.
function semanticErrors(db: MockDb, c: Candidate): { found: ApiFieldError[]; warnings: SaveLiveWarning[]; dup: boolean } {
  const { errors, warnings } = analyse(db, c);
  const found: ApiFieldError[] = [];
  let dup = false;
  for (const e of errors) {
    if (e.code === "duplicate") dup = true;
    else found.push({ in: "body", path: "/target", code: e.code, ...(e.params ? { params: e.params as ApiFieldError["params"] } : {}) });
  }
  return {
    found,
    dup,
    warnings: warnings.map((w) => ({ path: "/source_path", code: w.code, message: "A published page at this address wins over the redirect.", params: w.params })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// GET list / detail
// ---------------------------------------------------------------------------------------------------------------
function filtered(db: MockDb, params: Params): Redirect[] {
  const errors: ApiFieldError[] = [];
  const keyword = params.get("keyword");
  if (keyword !== null && [...keyword].length > 100) errors.push({ in: "query", path: "/keyword", code: "too_long", params: { max: 100 } });
  const statusRaw = params.get("status_code");
  let status: number | undefined;
  if (statusRaw !== null) {
    status = Number(statusRaw);
    if (!STATUS_CODES.includes(status)) errors.push({ in: "query", path: "/status_code", code: "not_in_enum" });
  }
  const locale = params.get("locale_code");
  if (locale !== null && locale !== "all" && !(MOCK_LOCALE_CODES as readonly string[]).includes(locale)) errors.push({ in: "query", path: "/locale_code", code: "unknown_reference" });
  if (errors.length) throw validationFailed(errors);
  const active = boolParam(params, "is_active");
  const kw = keyword?.trim().toLowerCase();
  return db.redirects.filter((r) => {
    if (kw && !(r.source_path.includes(kw) || r.target.toLowerCase().includes(kw) || (r.note ?? "").toLowerCase().includes(kw))) return false;
    if (status !== undefined && r.status_code !== status) return false;
    if (locale === "all" ? r.locale_code !== null : locale !== null && r.locale_code !== locale) return false;
    if (active !== undefined && r.is_active !== active) return false;
    return true;
  });
}

export function listRedirects(db: MockDb, params: Params) {
  rejectUnknown(params, ["page", "limit", "keyword", "status_code", "locale_code", "is_active", "sort"]);
  const sort = params.get("sort") ?? "source_path";
  const m = /^(-?)([a-z_]+)$/.exec(sort);
  if (!m || !SORTABLE.includes(m[2])) throw validationFailed([{ in: "query", path: "/sort", code: "not_in_enum" }]);
  const rows = filtered(db, params);
  const dir = m[1] ? -1 : 1;
  rows.sort((a, b) => {
    const x = (a as unknown as Record<string, string | number>)[m[2]];
    const y = (b as unknown as Record<string, string | number>)[m[2]];
    return (x < y ? -1 : x > y ? 1 : 0) * dir || a.id - b.id;
  });
  return paginate(rows.map(stamped), params);
}

export function getRedirect(db: MockDb, id: string) {
  const row = findRow(db, id);
  return { data: stamped(row), etag: etagOf(row.updated_at) };
}

// CSV `from,to,code` of the rows that match the filters (doc/05 6.10).
export function exportRedirects(db: MockDb, params: Params) {
  rejectUnknown(params, ["keyword", "status_code", "locale_code", "is_active"]);
  const rows = filtered(db, params).sort((a, b) => a.source_path.localeCompare(b.source_path));
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return ["from,to,code", ...rows.map((r) => [cell(r.source_path), cell(r.target), r.status_code].join(","))].join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------------------------------------------
// POST / PATCH / DELETE
// ---------------------------------------------------------------------------------------------------------------
export function createRedirect(db: MockDb, body: unknown) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw badRequest();
  const b = body as Record<string, unknown>;
  const errors = validateFields(db, b, "create");
  if (errors.length) throw validationFailed(errors);
  const source = normSource(b.source_path as string);
  const target = (b.target as string).trim();
  const locale = typeof b.locale_code === "string" ? b.locale_code : null;
  const sem = semanticErrors(db, { source_path: source, target, locale_code: locale });
  if (sem.found.length) throw validationFailed(sem.found);
  if (sem.dup) throw duplicate([{ in: "body", path: "/source_path", code: "duplicate" }]);
  const at = tick(db);
  const row: Redirect = {
    id: db.nextRedirectId++,
    public_id: `0192d3a4-7c1e-7b52-9d0a-${String(db.nextRedirectId).padStart(12, "0")}`,
    source_path: source,
    target,
    status_code: (typeof b.status_code === "number" ? b.status_code : 301) as RedirectStatusCode,
    locale_code: locale,
    is_active: typeof b.is_active === "boolean" ? b.is_active : true,
    note: typeof b.note === "string" && b.note.trim() ? b.note.trim() : null,
    created_by: MOCK_USER,
    updated_by: MOCK_USER,
    created_at: at,
    updated_at: at,
  };
  db.redirects.push(row);
  return { data: { ...stamped(row), ...(sem.warnings.length ? { warnings: sem.warnings } : {}) }, etag: etagOf(row.updated_at) };
}

export function patchRedirect(db: MockDb, id: string, body: unknown, ifMatch: string | null) {
  const row = findRow(db, id);
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw badRequest();
  const b = body as Record<string, unknown>;
  const errors = validateFields(db, b, "patch");
  if (errors.length) throw validationFailed(errors);
  requireIfMatch(ifMatch, etagOf(row.updated_at));

  const next: Redirect = { ...row };
  if ("source_path" in b) next.source_path = normSource(b.source_path as string);
  if ("target" in b) next.target = (b.target as string).trim();
  if ("status_code" in b) next.status_code = b.status_code as RedirectStatusCode;
  if ("locale_code" in b) next.locale_code = (b.locale_code as string | null) ?? null;
  if ("is_active" in b) next.is_active = b.is_active as boolean;
  if ("note" in b) next.note = typeof b.note === "string" && b.note.trim() ? b.note.trim() : null;
  if (JSON.stringify(redirectSnapshot(next)) === JSON.stringify(redirectSnapshot(row))) return { data: stamped(row), etag: etagOf(row.updated_at) };

  const sem = semanticErrors(db, { id: row.id, source_path: next.source_path, target: next.target, locale_code: next.locale_code });
  if (sem.found.length) throw validationFailed(sem.found);
  if (sem.dup) throw duplicate([{ in: "body", path: "/source_path", code: "duplicate" }]);
  const at = tick(db);
  pushRevision(db, "redirects", row.id, "cms.redirects", "history", redirectSnapshot(row), null, at, MOCK_USER);
  Object.assign(row, next, { updated_at: at, updated_by: MOCK_USER });
  return { data: { ...stamped(row), ...(sem.warnings.length ? { warnings: sem.warnings } : {}) }, etag: etagOf(row.updated_at) };
}

export function deleteRedirect(db: MockDb, id: string, ifMatch: string | null) {
  const row = findRow(db, id);
  requireIfMatch(ifMatch, etagOf(row.updated_at));
  db.redirects = db.redirects.filter((r) => r.id !== row.id);
}

// ---------------------------------------------------------------------------------------------------------------
// Revisions
// ---------------------------------------------------------------------------------------------------------------
export function restoreRedirect(db: MockDb, id: string, rev: { id: number; version: number; schema_version: number; snapshot: Record<string, unknown> }, note: string, ifMatch: string | null) {
  const row = findRow(db, id);
  requireIfMatch(ifMatch, etagOf(row.updated_at));
  if (rev.schema_version > 1) throw invalidState("snapshot_incompatible");
  const snap = (rev.snapshot as { redirect?: Partial<Redirect> }).redirect ?? {};
  const restoredFrom = { revision_id: rev.id, version: rev.version };
  const next: Redirect = {
    ...row,
    source_path: snap.source_path ?? row.source_path,
    target: snap.target ?? row.target,
    status_code: snap.status_code ?? row.status_code,
    locale_code: snap.locale_code ?? null,
    is_active: snap.is_active ?? row.is_active,
    note: snap.note ?? null,
  };
  if (JSON.stringify(redirectSnapshot(next)) === JSON.stringify(redirectSnapshot(row))) return { data: { ...stamped(row), restored_from: restoredFrom }, etag: etagOf(row.updated_at) };
  const sem = semanticErrors(db, { id: row.id, source_path: next.source_path, target: next.target, locale_code: next.locale_code });
  const blocking: ApiFieldError[] = sem.found.map((f) => ({ ...f, in: "entity" as const }));
  if (blocking.length) throw validationFailed(blocking);
  if (sem.dup) throw duplicate([{ in: "entity", path: "/source_path", code: "duplicate" }]);
  const at = tick(db);
  pushRevision(db, "redirects", row.id, "cms.redirects", "restore", redirectSnapshot(row), note, at, MOCK_USER);
  Object.assign(row, next, { updated_at: at, updated_by: MOCK_USER });
  return { data: { ...stamped(row), restored_from: restoredFrom }, etag: etagOf(row.updated_at) };
}

// One earlier version of `/old-blog` (the state BEFORE an edit). INVENTED history.
export function seedRedirectRevisions(db: MockDb) {
  const r = db.redirects[0];
  pushRevision(db, "redirects", r.id, "cms.redirects", "history", redirectSnapshot({ ...r, target: "/posts", status_code: 302, note: null }), null, micros(Date.UTC(2026, 9, 25, 8, 0, 0), 300), MOCK_USER);
}
