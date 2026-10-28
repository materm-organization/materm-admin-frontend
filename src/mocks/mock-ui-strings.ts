// In-memory model of the UI-string endpoints (doc/05 section 11.4; shapes: doc/api/openapi-admin.yaml UiStringItem,
// UiStringLocale, UiStringListEnvelope, PutUiStringRequest, UiStringWriteResult, UiStringsBundleManifest,
// BundleSyncResult). Seeded like the admin backend: the manifest is `migrations/seeds/ui-strings.json` (39 keys x
// 2 languages, a verbatim copy in `seed/ui-strings.json`) and one row per key x language whose value equals the
// source (78 rows = NOT overrides, S-7). INVENTED on top: three overrides and one orphan row.
//
// Contract assumption about the key-level restore (the PROVISIONAL decision of the task): the ETag of a restore is
// the quoted version of the LATEST revision of that key (`"0"` while the key has none), answered as the `ETag` header
// of `GET /ui-strings/{key}/revisions`. `uiStringKeyEtag` is the only place that builds it.
import seedManifest from "@/mocks/seed/ui-strings.json";
import { checkIcuValue, analyzeIcu } from "@/lib/icu";
import {
  DEFAULT_LOCALE_CODE,
  MOCK_ACTIVE_LOCALE_CODES,
  MOCK_LOCALE_CODES,
  MOCK_USER,
  badRequest,
  boolParam,
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
  type MockManifest,
  type MockUiRow,
  type Params,
} from "@/mocks/mock-core";
import type { ApiFieldError } from "@/types/api";
import type { SaveLiveWarning } from "@/types/media";
import type { BundleSyncResult, UiStringItem, UiStringLocale } from "@/types/ui-strings";

const KEY_PATTERN = /^[A-Za-z0-9_.-]+$/;
const BUNDLE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const SEED_AT = micros(Date.UTC(2026, 9, 26, 9, 0, 0), 200);
const SYNCED_AT = micros(Date.UTC(2026, 9, 26, 9, 0, 0), 190);
export const BUNDLE_SYNC_LIMIT = 10;

export function seedManifestOf(): MockManifest {
  const m = seedManifest as { generated_at: string; source_commit: string; keys: MockManifest["keys"] };
  return { version: 1, generated_at: m.generated_at, source_commit: m.source_commit, synced_at: SYNCED_AT, keys: structuredClone(m.keys) };
}

export function seedUiStrings(db: MockDb) {
  const manifest = seedManifestOf();
  db.manifests = [manifest];
  const rows: MockUiRow[] = [];
  for (const k of manifest.keys) {
    for (const code of MOCK_ACTIVE_LOCALE_CODES) {
      const value = k.values[code];
      if (value === undefined) continue;
      rows.push({ id: db.nextUiRowId++, key: k.key, locale: code, value, note: null, updated_at: SEED_AT, updated_by: null });
    }
  }
  // INVENTED edits (the real database has none): a Lao translation, an English wording change, and a row whose key
  // left the bundle (an orphan).
  const edit = (key: string, locale: string, value: string, note: string | null, when: string, who = MOCK_USER) => {
    const row = rows.find((r) => r.key === key && r.locale === locale)!;
    row.value = value;
    row.note = note;
    row.updated_at = when;
    row.updated_by = who;
  };
  edit("blog.categories.all", "la", "ທັງໝົດ", null, micros(Date.UTC(2026, 9, 21, 9, 0, 0), 300));
  edit("blog.index.listLabel", "en", "All blog posts", "Reads better for screen readers", micros(Date.UTC(2026, 9, 22, 9, 30, 0), 300));
  edit("site.nav.closeMenu", "la", "ປິດເມນູ", null, micros(Date.UTC(2026, 9, 21, 9, 5, 0), 300));
  rows.push({ id: db.nextUiRowId++, key: "blog.index.oldTitle", locale: "la", value: "Old title", note: null, updated_at: SEED_AT, updated_by: null });
  rows.push({ id: db.nextUiRowId++, key: "blog.index.oldTitle", locale: "en", value: "Old title", note: null, updated_at: SEED_AT, updated_by: null });
  db.uiRows = rows;
}

// ---------------------------------------------------------------------------------------------------------------
// Derived
// ---------------------------------------------------------------------------------------------------------------
const latestManifest = (db: MockDb): MockManifest | null => db.manifests.at(-1) ?? null;
const namespaceOf = (key: string) => key.split(".")[0];

function knownKeys(db: MockDb): string[] {
  const keys = new Set<string>(latestManifest(db)?.keys.map((k) => k.key) ?? []);
  for (const r of db.uiRows) keys.add(r.key);
  return [...keys];
}

function sourceOf(db: MockDb, key: string, locale: string): string | null {
  return latestManifest(db)?.keys.find((k) => k.key === key)?.values[locale] ?? null;
}

function localeCell(db: MockDb, key: string, locale: string): UiStringLocale {
  const manifest = latestManifest(db);
  const row = db.uiRows.find((r) => r.key === key && r.locale === locale);
  const source = sourceOf(db, key, locale);
  const value = row?.value ?? null;
  return {
    source,
    value,
    is_override: manifest ? value !== null && value !== source : null,
    effective: value ?? source,
    note: row?.note ?? null,
    etag: row ? etagOf(row.updated_at) : null,
    updated_at: row?.updated_at ?? null,
    updated_by: row?.updated_by ?? null,
  };
}

function sourcePlaceholders(db: MockDb, key: string): string[] {
  const text = sourceOf(db, key, DEFAULT_LOCALE_CODE) ?? sourceOf(db, key, "en");
  if (text === null) return [];
  const result = analyzeIcu(text);
  return result.ok ? result.placeholders : [];
}

function itemOf(db: MockDb, key: string, locales: readonly string[]): UiStringItem {
  const manifest = latestManifest(db);
  return {
    key,
    namespace: namespaceOf(key),
    in_bundle: manifest ? manifest.keys.some((k) => k.key === key) : null,
    placeholders: sourcePlaceholders(db, key),
    locales: Object.fromEntries(locales.map((l) => [l, localeCell(db, key, l)])),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Key-level revision ETag (the provisional contract)
// ---------------------------------------------------------------------------------------------------------------
export const uiStringLatestVersion = (db: MockDb, key: string): number =>
  (db.revisions[`ui-strings/${key}`] ?? []).reduce((max, r) => Math.max(max, r.version), 0);

export const uiStringKeyEtag = (db: MockDb, key: string): string => `"${uiStringLatestVersion(db, key)}"`;

export function uiStringSnapshot(db: MockDb, key: string): Record<string, unknown> {
  const rows = db.uiRows.filter((r) => r.key === key).sort((a, b) => a.locale.localeCompare(b.locale));
  return {
    key,
    values: Object.fromEntries(rows.map((r) => [r.locale, r.value])),
    notes: Object.fromEntries(rows.filter((r) => r.note).map((r) => [r.locale, r.note])),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// GET /ui-strings
// ---------------------------------------------------------------------------------------------------------------
const LIST_PARAMS = ["page", "limit", "keyword", "namespace", "locale", "overridden", "missing", "same_as", "orphan", "sort"] as const;
const LOCALE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export function listUiStrings(db: MockDb, params: Params) {
  rejectUnknown(params, LIST_PARAMS);
  const errors: ApiFieldError[] = [];
  const csv = (name: string): string[] | undefined => {
    const raw = params.get(name);
    if (raw === null) return undefined;
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 10) errors.push({ in: "query", path: `/${name}`, code: "too_many_items", params: { max: 10 } });
    return parts;
  };
  const namespaces = csv("namespace");
  const localeParam = csv("locale");
  const locales = localeParam?.length ? localeParam : [...MOCK_ACTIVE_LOCALE_CODES];
  for (const l of locales) {
    if (!(MOCK_LOCALE_CODES as readonly string[]).includes(l)) errors.push({ in: "query", path: "/locale", code: "unknown_reference" });
  }
  const missing = params.get("missing");
  const sameAs = params.get("same_as");
  for (const [name, v] of [["missing", missing], ["same_as", sameAs]] as const) {
    if (v !== null && !LOCALE_PATTERN.test(v)) errors.push({ in: "query", path: `/${name}`, code: "invalid_format" });
  }
  if (sameAs !== null && locales.length !== 1) errors.push({ in: "query", path: "/same_as", code: "invalid_format" });
  let overridden: boolean | undefined;
  let orphan: boolean | undefined;
  try {
    overridden = boolParam(params, "overridden");
    orphan = boolParam(params, "orphan");
  } catch (e) {
    errors.push(...(((e as { body?: { errors?: ApiFieldError[] } }).body?.errors) ?? []));
  }
  const keyword = params.get("keyword");
  if (keyword !== null && [...keyword].length > 100) errors.push({ in: "query", path: "/keyword", code: "too_long", params: { max: 100 } });
  const sort = params.get("sort") ?? "key";
  if (!/^-?(key|namespace|updated_at)$/.test(sort)) errors.push({ in: "query", path: "/sort", code: "not_in_enum" });
  const { limit } = { limit: Number(params.get("limit") ?? 50) };
  if (params.has("limit") && (!Number.isInteger(limit) || limit < 1 || limit > 100)) errors.push({ in: "query", path: "/limit", code: "out_of_range" });
  if (errors.length) throw validationFailed(errors);

  const manifest = latestManifest(db);
  const needsManifest = overridden !== undefined || missing !== null || sameAs !== null || orphan !== undefined;
  if (needsManifest && !manifest) throw invalidState("bundle_not_synced");

  const kw = keyword?.trim().toLowerCase();
  let keys = knownKeys(db);
  if (namespaces?.length) keys = keys.filter((k) => namespaces.includes(namespaceOf(k)));
  const items = keys.map((k) => itemOf(db, k, locales));
  const filtered = items.filter((item) => {
    if (kw) {
      const hit = item.key.toLowerCase().includes(kw) || Object.values(item.locales).some((c) => (c.effective ?? "").toLowerCase().includes(kw));
      if (!hit) return false;
    }
    if (overridden === true && !Object.values(item.locales).some((c) => c.is_override)) return false;
    if (overridden === false && Object.values(item.locales).some((c) => c.is_override)) return false;
    if (missing !== null && localeCell(db, item.key, missing).effective !== null) return false;
    if (sameAs !== null) {
      const mine = item.locales[locales[0]].effective;
      if (mine === null || mine !== localeCell(db, item.key, sameAs).effective) return false;
    }
    if (orphan !== undefined && (item.in_bundle === false) !== orphan) return false;
    return true;
  });
  const dir = sort.startsWith("-") ? -1 : 1;
  const field = sort.replace(/^-/, "");
  const updatedAt = (item: UiStringItem) => Object.values(item.locales).reduce((m, c) => (c.updated_at && c.updated_at > m ? c.updated_at : m), "");
  filtered.sort((a, b) => {
    const av = field === "namespace" ? a.namespace : field === "updated_at" ? updatedAt(a) : a.key;
    const bv = field === "namespace" ? b.namespace : field === "updated_at" ? updatedAt(b) : b.key;
    return av.localeCompare(bv) * dir || a.key.localeCompare(b.key);
  });

  const all = keys.map((k) => itemOf(db, k, [...MOCK_ACTIVE_LOCALE_CODES]));
  const summary = {
    keys: all.length,
    overridden: all.filter((i) => Object.values(i.locales).some((c) => c.is_override)).length,
    orphans: all.filter((i) => i.in_bundle === false).length,
    missing: Object.fromEntries(MOCK_ACTIVE_LOCALE_CODES.map((l) => [l, all.filter((i) => i.locales[l].effective === null).length])),
  };
  const { data, meta } = paginate(filtered, params, 50);
  return {
    data,
    meta: {
      ...meta,
      manifest: manifest ? { version: manifest.version, generated_at: manifest.generated_at, source_commit: manifest.source_commit, synced_at: manifest.synced_at, key_count: manifest.keys.length } : null,
      summary,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// PUT / DELETE /ui-strings/{key}/{locale}
// ---------------------------------------------------------------------------------------------------------------
function resolveCell(db: MockDb, key: string, locale: string, mustKnowKey: boolean) {
  if (!KEY_PATTERN.test(key) || key.length > 200) throw validationFailed([{ in: "path", path: "/key", code: "pattern_mismatch" }]);
  if (!LOCALE_PATTERN.test(locale)) throw validationFailed([{ in: "path", path: "/locale", code: "pattern_mismatch" }]);
  if (!(MOCK_LOCALE_CODES as readonly string[]).includes(locale)) throw notFound();
  if (mustKnowKey && !knownKeys(db).includes(key)) throw notFound();
}

function checkOptionalIfMatch(row: MockUiRow | undefined, ifMatch: string | null) {
  if (ifMatch === null) return;
  if (!row || ifMatch !== etagOf(row.updated_at)) throw fail(409, "CONFLICT_LOCK_VERSION", "The record was changed by someone else. Reload and try again.");
}

export function putUiString(db: MockDb, key: string, locale: string, body: unknown, ifMatch: string | null) {
  resolveCell(db, key, locale, true);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw badRequest();
  const input = body as Record<string, unknown>;
  const errors: ApiFieldError[] = Object.keys(input)
    .filter((k) => k !== "value" && k !== "note")
    .map((k) => ({ in: "body" as const, path: `/${k}`, code: "unknown_field" }));
  const value = input.value;
  if (typeof value !== "string") errors.push({ in: "body", path: "/value", code: value === undefined ? "required" : "invalid_type" });
  else if (value.length < 1) errors.push({ in: "body", path: "/value", code: "too_short", params: { min: 1 } });
  else if ([...value].length > 2000) errors.push({ in: "body", path: "/value", code: "too_long", params: { max: 2000 } });
  const note = input.note;
  if (note !== undefined && note !== null && (typeof note !== "string" || [...note].length > 200)) {
    errors.push({ in: "body", path: "/note", code: "too_long", params: { max: 200 } });
  }
  const sameLocaleSource = sourceOf(db, key, locale);
  const placeholderSource = sameLocaleSource ?? sourceOf(db, key, DEFAULT_LOCALE_CODE);
  const warnings: SaveLiveWarning[] = [];
  if (errors.length === 0 && typeof value === "string") {
    let expected: string[] | null = null;
    if (placeholderSource !== null) {
      const parsed = analyzeIcu(placeholderSource);
      expected = parsed.ok ? parsed.placeholders : null;
    }
    if (expected === null) warnings.push({ path: "/value", code: "no_source", message: "There is no source text to compare the placeholders with." });
    const check = checkIcuValue(value, expected);
    if (!check.ok) errors.push({ in: "body", path: "/value", code: check.code, params: check.params as ApiFieldError["params"] });
  }
  if (errors.length) throw validationFailed(errors);

  const row = db.uiRows.find((r) => r.key === key && r.locale === locale);
  checkOptionalIfMatch(row, ifMatch);
  const nextNote = note === undefined ? (row?.note ?? null) : (note as string | null) || null;
  const text = value as string;

  if (!row && text === sameLocaleSource) {
    return { data: { key, locale, source: sameLocaleSource, value: null, is_override: latestManifest(db) ? false : null, effective: sameLocaleSource, note: null, etag: null, updated_at: null, is_new: false, no_change: true, warnings }, etag: undefined as string | undefined };
  }
  if (row && row.value === text && row.note === nextNote) {
    const cell = localeCell(db, key, locale);
    return { data: { key, locale, ...cell, is_new: false, no_change: false, warnings }, etag: cell.etag ?? undefined };
  }
  // The before-image of the whole key is only written when the key already has a row.
  if (db.uiRows.some((r) => r.key === key)) {
    pushRevision(db, "ui-strings", key, "cms.ui_strings", "history", uiStringSnapshot(db, key), null, tick(db), MOCK_USER, 1, anchorOf(key));
  }
  const at = tick(db);
  let isNew = false;
  if (row) {
    row.value = text;
    row.note = nextNote;
    row.updated_at = at;
    row.updated_by = MOCK_USER;
  } else {
    isNew = true;
    db.uiRows.push({ id: db.nextUiRowId++, key, locale, value: text, note: nextNote, updated_at: at, updated_by: MOCK_USER });
  }
  const cell = localeCell(db, key, locale);
  return { data: { key, locale, ...cell, is_new: isNew, no_change: false, warnings }, etag: cell.etag ?? undefined };
}

export function deleteUiString(db: MockDb, key: string, locale: string, ifMatch: string | null) {
  resolveCell(db, key, locale, false);
  const row = db.uiRows.find((r) => r.key === key && r.locale === locale);
  checkOptionalIfMatch(row, ifMatch);
  // Reverting an override needs `update`; `translate` alone may only write values (05 11.1.3).
  if (db.translateOnly.includes("ui-strings")) throw forbidden("delete");
  if (!row) return null;
  pushRevision(db, "ui-strings", key, "cms.ui_strings", "history", uiStringSnapshot(db, key), null, tick(db), MOCK_USER, 1, anchorOf(key));
  db.uiRows = db.uiRows.filter((r) => r !== row);
  const source = sourceOf(db, key, locale);
  return { key, locale, source, effective: source };
}

// 63 bits of a hash of the key stand in for the anchor id of 05 11.7 (S-8); only used as the revision's entity id.
function anchorOf(key: string): number {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

// ---------------------------------------------------------------------------------------------------------------
// GET /ui-strings/{key} (what a restore answers) and the revision restore
// ---------------------------------------------------------------------------------------------------------------
export function getUiStringKey(db: MockDb, key: string): UiStringItem {
  if (!KEY_PATTERN.test(key) || !knownKeys(db).includes(key)) throw notFound();
  return itemOf(db, key, [...MOCK_ACTIVE_LOCALE_CODES]);
}

export function uiStringKnown(db: MockDb, key: string): boolean {
  return KEY_PATTERN.test(key) && knownKeys(db).includes(key);
}

export function restoreUiString(db: MockDb, key: string, rev: { id: number; version: number; schema_version: number; snapshot: Record<string, unknown> }, note: string, ifMatch: string | null) {
  if (!uiStringKnown(db, key)) throw notFound();
  requireIfMatch(ifMatch, uiStringKeyEtag(db, key));
  if (rev.schema_version > 1) throw invalidState("snapshot_incompatible");
  const snap = rev.snapshot as { values?: Record<string, string>; notes?: Record<string, string> };
  const values = snap.values ?? {};
  const notes = snap.notes ?? {};
  const errors: ApiFieldError[] = [];
  for (const code of Object.keys(values)) {
    if (!(MOCK_LOCALE_CODES as readonly string[]).includes(code)) errors.push({ in: "entity", path: `/values/${code}`, code: "unknown_reference" });
  }
  if (errors.length) throw validationFailed(errors);

  const restoredFrom = { revision_id: rev.id, version: rev.version };
  const before = uiStringSnapshot(db, key);
  const wanted = { key, values: Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b))), notes: Object.fromEntries(Object.entries(notes).sort(([a], [b]) => a.localeCompare(b))) };
  if (JSON.stringify(wanted) === JSON.stringify(before)) {
    return { data: { ...getUiStringKey(db, key), restored_from: restoredFrom }, etag: uiStringKeyEtag(db, key) };
  }
  pushRevision(db, "ui-strings", key, "cms.ui_strings", "restore", before, note, tick(db), MOCK_USER, 1, anchorOf(key));
  const at = tick(db);
  db.uiRows = db.uiRows.filter((r) => r.key !== key || r.locale in values);
  for (const [locale, text] of Object.entries(values)) {
    const row = db.uiRows.find((r) => r.key === key && r.locale === locale);
    if (row) {
      row.value = text;
      row.note = notes[locale] ?? null;
      row.updated_at = at;
      row.updated_by = MOCK_USER;
    } else {
      db.uiRows.push({ id: db.nextUiRowId++, key, locale, value: text, note: notes[locale] ?? null, updated_at: at, updated_by: MOCK_USER });
    }
  }
  return { data: { ...getUiStringKey(db, key), restored_from: restoredFrom }, etag: uiStringKeyEtag(db, key) };
}

// ---------------------------------------------------------------------------------------------------------------
// POST /ui-strings/bundle-sync
// ---------------------------------------------------------------------------------------------------------------
const MAX_BODY_BYTES = 1_000_000;

export function bundleSync(db: MockDb, params: Params, body: unknown): BundleSyncResult {
  rejectUnknown(params, ["dry_run"]);
  const dryRun = boolParam(params, "dry_run") ?? false;
  if (JSON.stringify(body ?? null).length > MAX_BODY_BYTES) {
    throw fail(413, "PAYLOAD_TOO_LARGE", "The request body is larger than 1 MB.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw badRequest();
  const input = body as Record<string, unknown>;
  const errors: ApiFieldError[] = Object.keys(input)
    .filter((k) => !["generated_at", "source_commit", "keys"].includes(k))
    .map((k) => ({ in: "body" as const, path: `/${k}`, code: "unknown_field" }));
  if (typeof input.generated_at !== "string" || Number.isNaN(Date.parse(input.generated_at))) errors.push({ in: "body", path: "/generated_at", code: input.generated_at === undefined ? "required" : "invalid_format" });
  if (typeof input.source_commit !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(input.source_commit)) errors.push({ in: "body", path: "/source_commit", code: input.source_commit === undefined ? "required" : "pattern_mismatch" });
  const keys = input.keys;
  if (!Array.isArray(keys) || keys.length < 1) errors.push({ in: "body", path: "/keys", code: keys === undefined ? "required" : "too_short", params: { min: 1 } });
  else if (keys.length > 2000) errors.push({ in: "body", path: "/keys", code: "too_many_items", params: { max: 2000 } });
  if (errors.length) throw validationFailed(errors);

  const list = keys as Array<Record<string, unknown>>;
  const seen = new Set<string>();
  list.forEach((k, i) => {
    const base = `/keys/${i}`;
    if (!k || typeof k !== "object") {
      errors.push({ in: "body", path: base, code: "invalid_type" });
      return;
    }
    for (const f of Object.keys(k)) if (!["key", "namespace", "values"].includes(f)) errors.push({ in: "body", path: `${base}/${f}`, code: "unknown_field" });
    const key = k.key;
    if (typeof key !== "string" || !BUNDLE_KEY_PATTERN.test(key) || key.length > 200) errors.push({ in: "body", path: `${base}/key`, code: key === undefined ? "required" : "pattern_mismatch" });
    else if (seen.has(key)) errors.push({ in: "body", path: `${base}/key`, code: "duplicate" });
    else seen.add(key);
    if (typeof key === "string" && k.namespace !== namespaceOf(key)) errors.push({ in: "body", path: `${base}/namespace`, code: "pattern_mismatch" });
    const values = k.values;
    if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).length < 1) {
      errors.push({ in: "body", path: `${base}/values`, code: values === undefined ? "required" : "too_short", params: { min: 1 } });
      return;
    }
    for (const [locale, text] of Object.entries(values as Record<string, unknown>)) {
      const p = `${base}/values/${locale}`;
      if (!(MOCK_LOCALE_CODES as readonly string[]).includes(locale)) errors.push({ in: "body", path: p, code: "unknown_reference" });
      else if (typeof text !== "string" || text.length < 1) errors.push({ in: "body", path: p, code: "too_short", params: { min: 1 } });
      else if ([...text].length > 2000) errors.push({ in: "body", path: p, code: "too_long", params: { max: 2000 } });
      else {
        const parsed = analyzeIcu(text);
        if (!parsed.ok) errors.push({ in: "body", path: p, code: parsed.issue.code, params: parsed.issue.params });
      }
    }
  });
  if (errors.length) throw validationFailed(errors);

  if (db.bundleSyncs >= BUNDLE_SYNC_LIMIT) {
    throw fail(429, "RATE_LIMITED", "Too many requests. Please try again later.", {}, { "Retry-After": "1800" });
  }
  db.bundleSyncs += 1;

  const previous = latestManifest(db);
  const next = list as Array<{ key: string; namespace: string; values: Record<string, string> }>;
  const counts = { keys: next.length, inserted: 0, source_updated: 0, kept_override: 0, unchanged: 0 };
  const newKeys: string[] = [];
  const conflicts: BundleSyncResult["placeholder_conflicts"] = [];
  const at = tick(db);
  const apply = !dryRun;
  const rows = apply ? db.uiRows : structuredClone(db.uiRows);
  for (const k of next) {
    const isNewKey = !rows.some((r) => r.key === k.key) && !previous?.keys.some((p) => p.key === k.key);
    if (isNewKey) newKeys.push(k.key);
    for (const [locale, source] of Object.entries(k.values)) {
      const row = rows.find((r) => r.key === k.key && r.locale === locale);
      if (!row) {
        counts.inserted += 1;
        rows.push({ id: db.nextUiRowId + rows.length, key: k.key, locale, value: source, note: null, updated_at: at, updated_by: MOCK_USER });
        continue;
      }
      const prevSource = previous?.keys.find((p) => p.key === k.key)?.values[locale];
      if (prevSource !== undefined && row.value === prevSource) {
        if (source !== row.value) {
          counts.source_updated += 1;
          row.value = source;
          row.updated_at = at;
          row.updated_by = MOCK_USER;
        } else counts.unchanged += 1;
      } else {
        if (row.value === source) counts.unchanged += 1;
        else {
          counts.kept_override += 1;
          const exp = analyzeIcu(source);
          const act = analyzeIcu(row.value);
          if (exp.ok && act.ok && JSON.stringify(exp.placeholders) !== JSON.stringify(act.placeholders)) {
            conflicts.push({ key: k.key, locale, expected: exp.placeholders, actual: act.placeholders });
          }
        }
      }
    }
  }
  const inNext = new Set(next.map((k) => k.key));
  const orphanKeys = [...new Set(rows.map((r) => r.key))].filter((key) => !inNext.has(key)).sort();

  const content = JSON.stringify(next);
  const unchanged = previous !== null && JSON.stringify(previous.keys) === content;
  const version = unchanged ? previous.version : (previous?.version ?? 0) + 1;
  if (apply) {
    db.nextUiRowId += counts.inserted;
    if (!unchanged) {
      db.manifests.push({ version, generated_at: input.generated_at as string, source_commit: input.source_commit as string, synced_at: at, keys: structuredClone(next) });
    }
  }
  return {
    dry_run: dryRun,
    manifest: { version, generated_at: input.generated_at as string, source_commit: input.source_commit as string, key_count: next.length, unchanged },
    counts,
    new_keys: newKeys.slice(0, 100),
    placeholder_conflicts: conflicts.slice(0, 100),
    orphans: orphanKeys.slice(0, 200),
    orphan_count: orphanKeys.length,
    truncated: newKeys.length > 100 || conflicts.length > 100 || orphanKeys.length > 200,
  };
}

// History of one key: two earlier versions of `site.nav.closeMenu` (before the Lao override of the seed above).
export function seedUiStringRevisions(db: MockDb) {
  const key = "site.nav.closeMenu";
  const base = Date.UTC(2026, 9, 20, 8, 0, 0);
  const snap = (la: string, en: string) => ({ key, values: { la, en }, notes: {} });
  pushRevision(db, "ui-strings", key, "cms.ui_strings", "history", snap("Close menu", "Close menu"), null, micros(base + 3_600_000), { id: 4, name: "Somchai Vongsa" }, 1, anchorOf(key));
  pushRevision(db, "ui-strings", key, "cms.ui_strings", "history", snap("Close menu", "Close the menu"), "wording", micros(base + 7_200_000), { id: 6, name: "Noy Keomany" }, 1, anchorOf(key));
}

void SEED_AT;
