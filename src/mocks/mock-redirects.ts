// In-memory model of the redirects endpoints, strict to doc/05 section 14 (backend 7551846): save-live rows with a soft delete into the
// 30-day trash, `If-Match` mandatory on PATCH / DELETE / restore / revision restore (`"<updated_at>"`), a revision row (FLAT snapshot) per
// change, the field rules of 14.2, the loop / chain / published-page rules of 14.5 and the CSV of 14.7.
// What is simplified: the permissions (read + delete for the trash, export) are the page's job, the audit log is not modelled (the History
// tab reads the revisions) and the graph walk is done in memory for the languages that appear in the data.
import {
  MOCK_LOCALE_CODES,
  MOCK_USER,
  badRequest,
  boolParam,
  duplicate,
  etagOf,
  fail,
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
import { withLocalOffset } from "@/mocks/mock-taxonomy";
import type { ApiFieldError } from "@/types/api";
import type { SaveLiveWarning } from "@/types/media";
import type { Redirect, RedirectCheckResult, RedirectSnapshot, RedirectStatusCode } from "@/types/redirects";

const STATUS_CODES = [301, 302, 307, 308];
const SORTABLE = ["source_path", "target", "status_code", "created_at", "updated_at", "deleted_at"];
const TRASH_DAYS = 30;
export const MAX_HOPS = 3;
export const EXPORT_MAX_ROWS = 50_000;
// A test lowers it to reach 422 `EXPORT_TOO_LARGE`.
export const exportState = { max: EXPORT_MAX_ROWS };

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
    deleted_at: null,
    purge_at: null,
    ...extra,
  });
  // INVENTED rows (the real seed has none): a plain one, a language-specific one, an external one, an inactive one, a two-step chain
  // and one in the trash.
  const trashedAt = micros(Date.UTC(2026, 9, 28, 9, 0, 0), 300);
  db.redirects = [
    row(1, "/old-blog", "/blog", 301, { note: "Blog moved in 2025" }),
    row(2, "/about", "/our-path", 302),
    row(3, "/gallery-2025", "/gallery", 301, { locale_code: "en" }),
    row(4, "/promo", "https://example.com/promo", 307, { note: "Partner landing page" }),
    row(5, "/legacy", "/contact", 308, { is_active: false }),
    row(6, "/team", "/about", 301),
    row(7, "/old-team", "/our-path", 301, { deleted_at: trashedAt, purge_at: new Date(Date.parse(trashedAt) + TRASH_DAYS * 86_400_000).toISOString(), updated_at: trashedAt }),
  ];
  db.nextRedirectId = 8;
}

export const stamped = (row: Redirect): Redirect => ({
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

// The flat snapshot (14.6): no `deleted_at`, no wrapper.
export function redirectSnapshot(row: Pick<Redirect, "source_path" | "locale_code" | "target" | "status_code" | "is_active" | "note">): RedirectSnapshot {
  return { source_path: row.source_path, locale_code: row.locale_code, target: row.target, status_code: row.status_code, is_active: row.is_active, note: row.note };
}

// ---------------------------------------------------------------------------------------------------------------
// Field rules (14.2)
// ---------------------------------------------------------------------------------------------------------------
const WS_CTRL = /[\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/;
const LOCALE_FORMAT = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const body = (path: string, code: string, params?: ApiFieldError["params"]): ApiFieldError => ({ in: "body", path, code, ...(params ? { params } : {}) });

// trim, lower case, drop every trailing `/` (a lone `/` stays); the form the portal looks up.
export const normSource = (v: string) => {
  let s = v.trim().toLowerCase();
  while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
};
export const normInternal = (v: string) => normSource(v.replace(/[?#].*$/, ""));

export function sourceErrors(raw: unknown): ApiFieldError[] {
  if (raw === undefined || raw === null) return [body("/source_path", "required")];
  if (typeof raw !== "string") return [body("/source_path", "invalid_type")];
  const s = normSource(raw);
  if (s === "") return [body("/source_path", "required")];
  if ([...s].length > 500) return [body("/source_path", "too_long", { max: 500 })];
  let rule: string | null = null;
  if (!s.startsWith("/")) rule = "must_start_with_slash";
  else if (s.startsWith("//")) rule = "protocol_relative";
  else if (/[?#]/.test(s)) rule = "no_query_or_fragment";
  else if (s.includes("\\")) rule = "no_backslash";
  else if (WS_CTRL.test(s)) rule = "no_whitespace_or_control";
  else {
    const segments = s.slice(1).split("/");
    if (s.length > 1 && segments.some((x) => x === "")) rule = "empty_segment";
    else if (segments.some((x) => x === "." || x === "..")) rule = "dot_segment";
  }
  return rule ? [body("/source_path", "pattern_mismatch", { rule })] : [];
}

export function targetErrors(raw: unknown): ApiFieldError[] {
  if (raw === undefined || raw === null) return [body("/target", "required")];
  if (typeof raw !== "string") return [body("/target", "invalid_type")];
  const t = raw.trim();
  if (t === "") return [body("/target", "required")];
  if ([...t].length > 2000) return [body("/target", "too_long", { max: 2000 })];
  if (WS_CTRL.test(t)) return [body("/target", "pattern_mismatch", { rule: "no_whitespace_or_control" })];
  if (t.includes("\\")) return [body("/target", "pattern_mismatch", { rule: "no_backslash" })];
  if (t.startsWith("//")) return [body("/target", "pattern_mismatch", { rule: "protocol_relative" })];
  if (t.startsWith("/")) return [];
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(t)?.[1]?.toLowerCase();
  if (scheme === "https") {
    if (!/^https:\/\//i.test(t)) return [body("/target", "path_or_https_url")];
    const authority = t.replace(/^https:\/\//i, "").split(/[/?#]/)[0];
    if (authority.includes("@")) return [body("/target", "userinfo_not_allowed")];
    if (authority === "" || authority.startsWith(":")) return [body("/target", "host_required")];
    return [];
  }
  if (scheme === "http") return [body("/target", "https_only")];
  if (scheme && ["javascript", "data", "vbscript", "file", "ftp"].includes(scheme)) return [body("/target", "scheme_not_allowed")];
  return [body("/target", "path_or_https_url")];
}

const ALLOWED = ["source_path", "target", "status_code", "locale_code", "is_active", "note"];

function fieldErrors(b: Record<string, unknown>, mode: "create" | "patch" | "check"): ApiFieldError[] {
  const errors: ApiFieldError[] = [];
  const allowed = mode === "check" ? [...ALLOWED, "id"] : ALLOWED;
  for (const k of Object.keys(b)) if (!allowed.includes(k)) errors.push(body(`/${k}`, "unknown_field"));
  if (mode === "patch" && Object.keys(b).length === 0) errors.push(body("", "min_properties"));
  if (mode !== "patch" || "source_path" in b) errors.push(...sourceErrors(b.source_path));
  if (mode !== "patch" || "target" in b) errors.push(...targetErrors(b.target));
  if (typeof b.source_path === "string" && typeof b.target === "string" && !errors.some((e) => e.path === "/source_path" || e.path === "/target")) {
    if (b.target.trim().startsWith("/") && normInternal(b.target) === normSource(b.source_path)) errors.push(body("/target", "self_redirect", { path: normSource(b.source_path) }));
  }
  if ("status_code" in b && (typeof b.status_code !== "number" || !STATUS_CODES.includes(b.status_code))) errors.push(body("/status_code", "not_in_enum", { expected: STATUS_CODES.join(", ") }));
  if ("locale_code" in b && b.locale_code !== null && b.locale_code !== "") {
    if (typeof b.locale_code !== "string" || !LOCALE_FORMAT.test(b.locale_code)) errors.push(body("/locale_code", "invalid_format"));
    else if (!(MOCK_LOCALE_CODES as readonly string[]).includes(b.locale_code)) errors.push(body("/locale_code", "unknown_reference"));
  }
  if ("is_active" in b && typeof b.is_active !== "boolean") errors.push(body("/is_active", "invalid_type"));
  if ("note" in b && b.note !== null && (typeof b.note !== "string" || [...b.note].length > 500)) errors.push(body("/note", typeof b.note === "string" ? "too_long" : "invalid_type", typeof b.note === "string" ? { max: 500 } : undefined));
  return errors;
}

// ---------------------------------------------------------------------------------------------------------------
// Slot, loop, chain, published page (14.5)
// ---------------------------------------------------------------------------------------------------------------
type Candidate = { id?: number; source_path: string; target: string; locale_code: string | null; is_active: boolean };

const slotTaken = (db: MockDb, c: Candidate) =>
  db.redirects.some((r) => r.id !== c.id && !r.deleted_at && r.source_path === c.source_path && (r.locale_code ?? "") === (c.locale_code ?? ""));

type GraphResult = { error: ApiFieldError | null; hops: number; finalTarget: string };

// One language at a time (the portal decides in one language per request): the rule of the language wins over the rule of "every language".
function walkLanguage(db: MockDb, c: Candidate, language: string | null): GraphResult | null {
  const edges = db.redirects.filter((r) => r.id !== c.id && r.is_active && !r.deleted_at).map((r) => ({ from: r.source_path, to: r.target, locale: r.locale_code }));
  edges.push({ from: c.source_path, to: c.target, locale: c.locale_code });
  const ruleAt = (path: string) => {
    const specific = language === null ? undefined : edges.find((e) => e.from === path && e.locale === language);
    return specific ?? edges.find((e) => e.from === path && e.locale === null && (language === null || !edges.some((x) => x.from === path && x.locale === language)));
  };
  // The candidate does not take part in a language where another rule at its source shadows it.
  if (ruleAt(c.source_path)?.to !== c.target || (ruleAt(c.source_path)?.locale ?? null) !== c.locale_code) return null;
  const walk = [c.source_path, c.target];
  let current = c.target;
  let forward = 1;
  while (current.startsWith("/")) {
    const next = ruleAt(current);
    if (!next) break;
    if (walk.includes(next.to) && next.to.startsWith("/")) {
      walk.push(next.to);
      return { error: body("/target", "redirect_loop", { path: walk, locale: language ?? "" }), hops: forward, finalTarget: next.to };
    }
    walk.push(next.to);
    forward += 1;
    current = next.to;
  }
  // Longest chain that ends at the candidate's source.
  const back = (path: string, seen: string[]): number => {
    let best = 0;
    for (const e of edges) {
      if (e.to !== path || e.from === c.source_path || seen.includes(e.from)) continue;
      if (e.locale !== null && language !== null && e.locale !== language) continue;
      if (e.locale !== null && language === null) continue;
      if (e.locale === null && language !== null && edges.some((x) => x.from === e.from && x.locale === language)) continue;
      best = Math.max(best, 1 + back(e.from, [...seen, e.from]));
    }
    return best;
  };
  const hops = back(c.source_path, [c.source_path]) + forward;
  return { error: null, hops, finalTarget: walk[walk.length - 1] };
}

function analyse(db: MockDb, c: Candidate): { errors: ApiFieldError[]; warnings: SaveLiveWarning[]; hops: number } {
  const warnings: SaveLiveWarning[] = [];
  if (!c.is_active) return { errors: [], warnings, hops: 0 };
  const languages = new Set<string | null>([null]);
  for (const r of db.redirects) if (!r.deleted_at && r.is_active && r.locale_code) languages.add(r.locale_code);
  if (c.locale_code) languages.add(c.locale_code);
  const results = [...languages].filter((l) => c.locale_code === null || l === c.locale_code).map((l) => walkLanguage(db, c, l)).filter((r): r is GraphResult => r !== null);
  const loop = results.find((r) => r.error);
  if (loop?.error) return { errors: [loop.error], warnings, hops: 0 };
  const worst = results.reduce<GraphResult>((a, b) => (b.hops > a.hops ? b : a), { error: null, hops: 1, finalTarget: c.target });
  if (worst.hops > MAX_HOPS) return { errors: [body("/target", "redirect_chain_too_long", { hops: worst.hops, max: MAX_HOPS, final_target: worst.finalTarget })], warnings, hops: 0 };
  if (worst.hops >= 2) warnings.push({ path: "/target", code: "redirect_chain", params: { hops: worst.hops, final_target: worst.finalTarget } });
  // BR-26: a published page at the same path wins over the redirect.
  const page = db.pages.find((p) => p.status === "published" && !p.deleted_at && p.live.page.path === c.source_path);
  if (page) warnings.push({ path: "/source_path", code: "source_is_published_page", params: { page_id: page.id, page_key: page.live.page.key } });
  return { errors: [], warnings, hops: worst.hops };
}

const dupError = (where: "body" | "entity" = "body") => ({ in: where, path: "/source_path", code: "duplicate" }) as ApiFieldError;

// ---------------------------------------------------------------------------------------------------------------
// POST /redirects/check
// ---------------------------------------------------------------------------------------------------------------
export function checkRedirect(db: MockDb, input: unknown): RedirectCheckResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw badRequest();
  const b = input as Record<string, unknown>;
  const syntax = fieldErrors(b, "check");
  const sourceOk = !syntax.some((e) => e.path === "/source_path");
  const locale = typeof b.locale_code === "string" && b.locale_code !== "" ? b.locale_code : null;
  const isActive = typeof b.is_active === "boolean" ? b.is_active : true;
  const status = (typeof b.status_code === "number" && STATUS_CODES.includes(b.status_code) ? b.status_code : 301) as RedirectStatusCode;
  const normalized = sourceOk && typeof b.source_path === "string"
    ? { source_path: normSource(b.source_path), locale_code: locale, target: typeof b.target === "string" ? b.target.trim() : "", status_code: status, is_active: isActive }
    : null;
  if (syntax.length || !normalized) return { valid: false, normalized, errors: syntax, warnings: [], hops: 0 };
  const candidate: Candidate = { id: typeof b.id === "number" ? b.id : undefined, source_path: normalized.source_path, target: normalized.target, locale_code: locale, is_active: isActive };
  if (slotTaken(db, candidate)) return { valid: false, normalized, errors: [dupError()], warnings: [], hops: 0 };
  const result = analyse(db, candidate);
  return { valid: result.errors.length === 0, normalized, errors: result.errors, warnings: result.warnings, hops: result.errors.length ? 0 : result.hops };
}

// ---------------------------------------------------------------------------------------------------------------
// GET list / detail
// ---------------------------------------------------------------------------------------------------------------
function filtered(db: MockDb, params: Params, trashed: boolean): Redirect[] {
  const errors: ApiFieldError[] = [];
  const keyword = params.get("keyword");
  const statusRaw = params.get("status_code");
  let status: number | undefined;
  if (statusRaw !== null) {
    status = Number(statusRaw);
    if (!Number.isInteger(status)) errors.push({ in: "query", path: "/status_code", code: "invalid_type" });
    else if (!STATUS_CODES.includes(status)) errors.push({ in: "query", path: "/status_code", code: "not_in_enum" });
  }
  // A language code, or `none` = only the rows for every language. There is no `all`.
  const locale = params.get("locale_code");
  if (locale !== null && locale !== "none" && !LOCALE_FORMAT.test(locale)) errors.push({ in: "query", path: "/locale_code", code: "invalid_format" });
  if (errors.length) throw validationFailed(errors);
  const active = boolParam(params, "is_active");
  const kw = keyword?.trim().toLowerCase();
  return db.redirects.filter((r) => {
    if (Boolean(r.deleted_at) !== trashed) return false;
    if (kw && !(r.source_path.includes(kw) || r.target.toLowerCase().includes(kw) || (r.note ?? "").toLowerCase().includes(kw))) return false;
    if (status !== undefined && r.status_code !== status) return false;
    if (locale === "none" ? r.locale_code !== null : locale !== null && r.locale_code !== locale) return false;
    if (active !== undefined && r.is_active !== active) return false;
    return true;
  });
}

export function listRedirects(db: MockDb, params: Params) {
  rejectUnknown(params, ["page", "limit", "keyword", "status_code", "locale_code", "is_active", "trashed", "sort"]);
  const trashed = boolParam(params, "trashed") ?? false;
  const sort = params.get("sort") ?? (trashed ? "-deleted_at" : "source_path");
  const m = /^(-?)([a-z_]+)$/.exec(sort);
  if (!m || !SORTABLE.includes(m[2])) throw validationFailed([{ in: "query", path: "/sort", code: "not_in_enum" }]);
  const rows = filtered(db, params, trashed);
  const dir = m[1] ? -1 : 1;
  rows.sort((a, b) => {
    const x = (a as unknown as Record<string, string | number | null>)[m[2]] ?? "";
    const y = (b as unknown as Record<string, string | number | null>)[m[2]] ?? "";
    return (x < y ? -1 : x > y ? 1 : 0) * dir || a.id - b.id;
  });
  return paginate(rows.map(stamped), params);
}

export function getRedirect(db: MockDb, id: string) {
  const row = findRow(db, id);
  return { data: stamped(row), etag: etagOf(row.updated_at) };
}

// ---------------------------------------------------------------------------------------------------------------
// GET /redirects/export (14.7): `from,to,code`, UTF-8 BOM, CRLF, by id, formula-safe cells.
// ---------------------------------------------------------------------------------------------------------------
const safeCell = (v: string) => {
  const guarded = /^[\s\u200b-\u200f\ufeff]*[=+\-@\uff1d\uff0b\uff0d\uff20]/.test(v) ? `\x27${v}` : v;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
};

export function exportRedirects(db: MockDb, params: Params): string {
  rejectUnknown(params, ["keyword", "status_code", "locale_code", "is_active", "trashed"]);
  if (params.get("trashed") === "true") throw validationFailed([{ in: "query", path: "/trashed", code: "not_applicable" }]);
  const rows = filtered(db, params, false).sort((a, b) => a.id - b.id);
  if (rows.length > exportState.max) throw fail(422, "EXPORT_TOO_LARGE", "The export is too large.", { details: { matched: rows.length, max: exportState.max } });
  return "\ufeff" + ["from,to,code", ...rows.map((r) => [safeCell(r.source_path), safeCell(r.target), r.status_code].join(","))].join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------------------------------------------
// POST / PATCH / DELETE / restore
// ---------------------------------------------------------------------------------------------------------------
const noteOf = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const localeOf = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);

// A write: the answer always carries `warnings` (maybe empty).
const written = (row: Redirect, warnings: SaveLiveWarning[]) => ({ data: { ...stamped(row), warnings }, etag: etagOf(row.updated_at) });

// Slot first (409), then the graph (422), like the real write.
function semantic(db: MockDb, c: Candidate, where: "body" | "entity", graph: boolean) {
  if (slotTaken(db, c)) throw duplicate([dupError(where)]);
  if (!graph) return { warnings: [] as SaveLiveWarning[] };
  const result = analyse(db, c);
  if (result.errors.length) throw validationFailed(result.errors.map((e) => ({ ...e, in: where })));
  return { warnings: result.warnings };
}

export function createRedirect(db: MockDb, input: unknown) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw badRequest();
  const b = input as Record<string, unknown>;
  const errors = fieldErrors(b, "create");
  if (errors.length) throw validationFailed(errors);
  const c: Candidate = {
    source_path: normSource(b.source_path as string),
    target: (b.target as string).trim(),
    locale_code: localeOf(b.locale_code),
    is_active: typeof b.is_active === "boolean" ? b.is_active : true,
  };
  const { warnings } = semantic(db, c, "body", c.is_active);
  const at = tick(db);
  const row: Redirect = {
    id: db.nextRedirectId++,
    public_id: `0192d3a4-7c1e-7b52-9d0a-${String(db.nextRedirectId).padStart(12, "0")}`,
    ...c,
    status_code: (typeof b.status_code === "number" ? b.status_code : 301) as RedirectStatusCode,
    note: noteOf(b.note),
    created_by: MOCK_USER,
    updated_by: MOCK_USER,
    created_at: at,
    updated_at: at,
    deleted_at: null,
    purge_at: null,
  };
  db.redirects.push(row);
  return written(row, warnings);
}

export function patchRedirect(db: MockDb, id: string, input: unknown, ifMatch: string | null) {
  const row = findRow(db, id);
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw badRequest();
  const b = input as Record<string, unknown>;
  const errors = fieldErrors(b, "patch");
  if (errors.length) throw validationFailed(errors);
  requireIfMatch(ifMatch, etagOf(row.updated_at));
  if (row.deleted_at) throw invalidState("trashed");

  const next: Redirect = { ...row };
  if ("source_path" in b) next.source_path = normSource(b.source_path as string);
  if ("target" in b) next.target = (b.target as string).trim();
  if ("status_code" in b) next.status_code = b.status_code as RedirectStatusCode;
  if ("locale_code" in b) next.locale_code = localeOf(b.locale_code);
  if ("is_active" in b) next.is_active = b.is_active as boolean;
  if ("note" in b) next.note = noteOf(b.note);
  // A PATCH that changes nothing: same ETag, no revision.
  if (JSON.stringify(redirectSnapshot(next)) === JSON.stringify(redirectSnapshot(row))) return written(row, []);

  const slotChanged = next.source_path !== row.source_path || next.locale_code !== row.locale_code;
  const graphChanged = slotChanged || next.target !== row.target || next.is_active !== row.is_active;
  const c: Candidate = { id: row.id, source_path: next.source_path, target: next.target, locale_code: next.locale_code, is_active: next.is_active };
  const { warnings } = slotChanged || graphChanged ? semantic(db, c, "body", graphChanged && next.is_active) : { warnings: [] };
  const at = tick(db);
  pushRevision(db, "redirects", row.id, "cms.redirects", "history", redirectSnapshot(row), null, at, MOCK_USER);
  Object.assign(row, next, { updated_at: at, updated_by: MOCK_USER });
  return written(row, warnings);
}

// Soft delete: the slot is free at once. A row already in the trash: 200, nothing changes.
export function deleteRedirect(db: MockDb, id: string, ifMatch: string | null) {
  const row = findRow(db, id);
  requireIfMatch(ifMatch, etagOf(row.updated_at));
  if (row.deleted_at) return;
  const at = tick(db);
  row.deleted_at = at;
  row.purge_at = new Date(Date.parse(at) + TRASH_DAYS * 86_400_000).toISOString();
  row.updated_at = at;
  row.updated_by = MOCK_USER;
}

export function restoreRedirectFromTrash(db: MockDb, id: string, ifMatch: string | null) {
  const row = findRow(db, id);
  requireIfMatch(ifMatch, etagOf(row.updated_at));
  if (!row.deleted_at) throw invalidState("not_trashed");
  // The graph may have changed while it was in the trash.
  const { warnings } = semantic(db, { id: row.id, source_path: row.source_path, target: row.target, locale_code: row.locale_code, is_active: row.is_active }, "body", row.is_active);
  const at = tick(db);
  row.deleted_at = null;
  row.purge_at = null;
  row.updated_at = at;
  row.updated_by = MOCK_USER;
  return written(row, warnings);
}

// ---------------------------------------------------------------------------------------------------------------
// Revisions (14.6)
// ---------------------------------------------------------------------------------------------------------------
export function restoreRedirect(db: MockDb, id: string, rev: { id: number; version: number; schema_version: number; snapshot: Record<string, unknown> }, note: string, ifMatch: string | null) {
  const row = findRow(db, id);
  requireIfMatch(ifMatch, etagOf(row.updated_at));
  if (row.deleted_at) throw invalidState("trashed");
  if (rev.schema_version > 1) throw invalidState("snapshot_incompatible");
  const snap = rev.snapshot as Partial<RedirectSnapshot>;
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
  if (JSON.stringify(redirectSnapshot(next)) === JSON.stringify(redirectSnapshot(row))) return { data: { ...stamped(row), warnings: [], restored_from: restoredFrom }, etag: etagOf(row.updated_at) };
  const { warnings } = semantic(db, { id: row.id, source_path: next.source_path, target: next.target, locale_code: next.locale_code, is_active: next.is_active }, "entity", next.is_active);
  const at = tick(db);
  pushRevision(db, "redirects", row.id, "cms.redirects", "restore", redirectSnapshot(row), note, at, MOCK_USER);
  Object.assign(row, next, { updated_at: at, updated_by: MOCK_USER });
  return { data: { ...stamped(row), warnings, restored_from: restoredFrom }, etag: etagOf(row.updated_at) };
}

// One earlier version of `/old-blog` (the state BEFORE an edit). INVENTED history.
export function seedRedirectRevisions(db: MockDb) {
  const r = db.redirects[0];
  pushRevision(db, "redirects", r.id, "cms.redirects", "history", redirectSnapshot({ ...r, target: "/posts", status_code: 302, note: null }), null, micros(Date.UTC(2026, 9, 25, 8, 0, 0), 300), MOCK_USER);
}
