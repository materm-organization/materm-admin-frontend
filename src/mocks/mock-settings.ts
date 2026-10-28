// In-memory model of the settings endpoints (doc/05 section 11.3; shapes: doc/api/openapi-admin.yaml SettingsGroup,
// SettingsFieldDef, PutSettingsRequest). The key definitions and values are the ones the admin backend seed writes
// (`migrations/seeds/0040_site_settings.sql`, brand logo/emblem = media 23/24 as `bootstrap/seed_site.go` sets them),
// with the limits of the key registry of 11.3. A group's ETag is `"<n>"`, n = the version of its latest revision
// (`"0"` while it was never edited); a `PUT` replaces the whole group.
import {
  DEFAULT_LOCALE_CODE,
  MOCK_LOCALE_CODES,
  MOCK_USER,
  badRequest,
  etagOf,
  fail,
  forbidden,
  invalidState,
  micros,
  notFound,
  pushRevision,
  requireIfMatch,
  tick,
  validationFailed,
  type MockDb,
  type MockSettingRow,
} from "@/mocks/mock-core";
import type { ApiFieldError } from "@/types/api";
import type { SaveLiveWarning, UserRef } from "@/types/media";
import type { SettingsFieldDef, SettingsGroup, SettingsMediaRef, SettingsValue } from "@/types/settings";

const GROUPS = ["brand", "contact", "footer", "site", "seo"] as const;
const IMAGE_ACCEPT = { kinds: ["brand", "image"], mime_types: ["image/svg+xml", "image/png", "image/webp", "image/jpeg"] };
const OG_ACCEPT = { kinds: ["image"], mime_types: ["image/png", "image/jpeg", "image/webp"] };
const SERP_RECOMMENDED = 160;

type Def = Omit<MockSettingRow, "value" | "media_id" | "translations">;
const def = (group: string, key: string, value_type: string, is_localized: boolean, required: boolean, sort_order: number, description: string, extra: Partial<Def> = {}): Def => ({
  group, key, value_type, is_localized, required, sort_order, description, ...extra,
});

const DEFS: Def[] = [
  def("brand", "name", "string", false, true, 10, "Brand name (mobile header, bottom bar)", { max_length: 80 }),
  def("brand", "logo_alt", "string", true, false, 20, "Alt text of the logo", { max_length: 250 }),
  def("brand", "emblem_alt", "string", true, false, 30, "Alt text of the emblem", { max_length: 250 }),
  def("brand", "statement", "text", true, true, 40, "Footer brand statement", { max_length: 300 }),
  def("brand", "logo_media_id", "media", false, false, 50, "Logo (white SVG)", { accept: IMAGE_ACCEPT }),
  def("brand", "emblem_media_id", "media", false, false, 60, "Emblem SVG", { accept: IMAGE_ACCEPT }),
  def("brand", "favicon_media_id", "media", false, false, 70, "Optional favicon override", { accept: IMAGE_ACCEPT }),
  def("footer", "copyright", "string", true, true, 10, "Footer copyright line", { max_length: 200 }),
  def("seo", "site_name", "string", false, true, 10, "Site name", { max_length: 80 }),
  def("seo", "title_template", "string", false, true, 20, "Page title template", { max_length: 100, pattern: "contains exactly one %s" }),
  def("seo", "default_description", "text", true, false, 30, "Default meta description", { max_length: 500 }),
  def("seo", "default_og_media_id", "media", false, false, 40, "Default Open Graph image", { accept: OG_ACCEPT }),
  def("site", "base_url", "url", false, true, 10, "Public site URL (canonical, sitemap) - placeholder", { max_length: 200 }),
  def("contact", "address", "text", true, false, 10, "Visit us", { max_length: 500 }),
  def("contact", "phone", "phone", false, false, 20, "Call us, E.164 (placeholder)", { pattern: "^\\+[1-9]\\d{6,14}$" }),
  def("contact", "phone_display", "string", false, false, 25, "Call us, display format", { max_length: 40 }),
  def("contact", "email", "email", false, false, 30, "Email us (placeholder)", { max_length: 254 }),
  def("contact", "hours", "string", true, false, 40, "Opening hours", { max_length: 200 }),
  def("contact", "map_url", "url", false, false, 45, "Optional map link", { max_length: 2000 }),
];

const EN = (v: string) => ({ la: v, en: v });

export function seedSettings(): MockSettingRow[] {
  const values: Record<string, Partial<Pick<MockSettingRow, "value" | "media_id" | "translations">>> = {
    "brand.name": { value: "MATERM" },
    "brand.logo_alt": { translations: EN("MATERM logo") },
    "brand.emblem_alt": { translations: EN("MATERM emblem") },
    "brand.statement": { translations: EN("Forging wild paths across the untamed earth. Led by expert survivalists and certified wilderness rescue guides.") },
    "brand.logo_media_id": { media_id: 23 },
    "brand.emblem_media_id": { media_id: 24 },
    "footer.copyright": { translations: EN("© 2026 Outdoor Avenger Ltd. All Wilderness Permits Reserved.") },
    "seo.site_name": { value: "Materm" },
    "seo.title_template": { value: "%s | Materm" },
    "seo.default_description": { translations: EN("Materm - treehouse and camping at Phou Khao Khouay, Laos.") },
    "site.base_url": { value: "https://materm.example" },
    "contact.address": { translations: EN("Phou Khao Khouay National Park, Vientiane Province, Lao PDR") },
    "contact.phone": { value: "+8562000000000" },
    "contact.phone_display": { value: "+856 20 0000 0000" },
    "contact.email": { value: "hello@materm.example" },
    "contact.hours": { translations: EN("Every day, 08:00 – 18:00") },
  };
  return DEFS.map((d) => {
    const v = values[`${d.group}.${d.key}`] ?? {};
    return { ...d, value: v.value ?? null, media_id: v.media_id ?? null, translations: v.translations ? { ...v.translations } : {} };
  });
}

export const SEED_SETTINGS_UPDATED: Record<string, { at: string; by: UserRef }> = {
  brand: { at: micros(Date.UTC(2026, 9, 20, 8, 10, 0), 600), by: { id: 6, name: "Noy Keomany" } },
};

// ---------------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------------
function rowsOf(db: MockDb, group: string): MockSettingRow[] {
  return db.settings.filter((r) => r.group === group).sort((a, b) => a.sort_order - b.sort_order);
}

function groupOrThrow(db: MockDb, group: string): MockSettingRow[] {
  if (group === "analytics") {
    throw fail(404, "NOT_FOUND", "The requested resource was not found.", { details: { reason: "group_not_enabled" } });
  }
  if (!(GROUPS as readonly string[]).includes(group)) throw notFound();
  return rowsOf(db, group);
}

export const settingsVersion = (db: MockDb, group: string): number =>
  (db.revisions[`settings/${group}`] ?? []).reduce((max, r) => Math.max(max, r.version), 0);

function fieldDef(r: MockSettingRow): SettingsFieldDef {
  return {
    key: r.key,
    value_type: r.value_type as SettingsFieldDef["value_type"],
    is_localized: r.is_localized,
    is_public: true,
    required: r.required,
    description: r.description,
    sort_order: r.sort_order,
    ...(r.max_length ? { max_length: r.max_length } : {}),
    ...(r.pattern ? { pattern: r.pattern } : {}),
    ...(r.accept ? { accept: r.accept } : {}),
  };
}

function valueOf(r: MockSettingRow): SettingsValue {
  if (r.value_type === "media") return r.media_id;
  if (r.is_localized) return { ...r.translations };
  return r.value;
}

function mediaRefs(db: MockDb, rows: MockSettingRow[]): Record<string, SettingsMediaRef> {
  const out: Record<string, SettingsMediaRef> = {};
  for (const r of rows) {
    if (r.media_id === null) continue;
    const asset = db.assets.find((a) => a.id === r.media_id);
    if (asset) {
      out[String(asset.id)] = {
        id: asset.id,
        status: asset.status,
        original_filename: asset.original_filename,
        mime_type: asset.mime_type,
        width: asset.width ?? null,
        height: asset.height ?? null,
        url: asset.url,
      };
    }
  }
  return out;
}

function groupOf(db: MockDb, group: string, warnings?: SaveLiveWarning[]): SettingsGroup {
  const rows = groupOrThrow(db, group);
  const version = settingsVersion(db, group);
  const updated = db.settingsUpdatedAt[group];
  return {
    group,
    permission_key: group === "seo" ? "cms.seo" : "cms.settings",
    version,
    etag: etagOf(String(version)),
    updated_at: updated?.at ?? null,
    updated_by: updated?.by ?? null,
    fields: rows.map(fieldDef),
    values: Object.fromEntries(rows.map((r) => [r.key, valueOf(r)])),
    media: mediaRefs(db, rows),
    ...(warnings ? { warnings } : {}),
  };
}

export function getSettingsGroup(db: MockDb, group: string) {
  const data = groupOf(db, group);
  return { data, etag: data.etag };
}

export function listSettingsGroups(db: MockDb) {
  return GROUPS.map((g) => groupOf(db, g));
}

// 05 11.7 item 3: `{ group_key, settings: [{ key, value, media_asset_id, translations: [{ locale_code, value }] }] }`.
export function settingsSnapshot(db: MockDb, group: string): Record<string, unknown> {
  return {
    group_key: group,
    settings: rowsOf(db, group).map((r) => ({
      key: r.key,
      value: r.value_type === "media" || r.is_localized ? null : r.value,
      media_asset_id: r.media_id,
      translations: Object.entries(r.translations).map(([locale_code, value]) => ({ locale_code, value })),
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Validation of a value
// ---------------------------------------------------------------------------------------------------------------
const E164 = /^\+[1-9]\d{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkString(r: MockSettingRow, raw: unknown, path: string, errors: ApiFieldError[], isDefault: boolean) {
  if (raw === null || raw === undefined || raw === "") {
    if (r.required && isDefault) errors.push({ in: "body", path, code: "required" });
    return;
  }
  if (typeof raw !== "string") {
    errors.push({ in: "body", path, code: "invalid_type" });
    return;
  }
  const value = raw.trim();
  if (r.max_length && [...value].length > r.max_length) {
    errors.push({ in: "body", path, code: "too_long", params: { max: r.max_length } });
    return;
  }
  switch (r.value_type) {
    case "phone":
      if (!E164.test(value)) errors.push({ in: "body", path, code: "pattern_mismatch" });
      break;
    case "email":
      if (!EMAIL.test(value)) errors.push({ in: "body", path, code: "invalid_format" });
      break;
    case "url":
      if (!/^https:\/\/\S+$/.test(value)) errors.push({ in: "body", path, code: "pattern_mismatch" });
      else if (r.key === "base_url" && /[?#]/.test(value)) errors.push({ in: "body", path, code: "pattern_mismatch" });
      break;
    default:
      break;
  }
  if (r.group === "seo" && r.key === "title_template" && value.split("%s").length !== 2) {
    errors.push({ in: "body", path, code: "pattern_mismatch" });
  }
  if (r.group === "footer" && r.key === "copyright") {
    const tokens = value.match(/\{[^}]*\}/g) ?? [];
    if (tokens.some((t) => t !== "{year}")) errors.push({ in: "body", path, code: "pattern_mismatch" });
  }
}

function normalise(r: MockSettingRow, value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return r.key === "base_url" ? trimmed.replace(/\/+$/, "") : trimmed;
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

// ---------------------------------------------------------------------------------------------------------------
// PUT /settings/{group}
// ---------------------------------------------------------------------------------------------------------------
export function putSettingsGroup(db: MockDb, group: string, body: unknown, ifMatch: string | null) {
  const rows = groupOrThrow(db, group);
  if (!isObject(body)) throw badRequest();
  const structural: ApiFieldError[] = Object.keys(body)
    .filter((k) => k !== "values" && k !== "change_note")
    .map((k) => ({ in: "body" as const, path: `/${k}`, code: "unknown_field" }));
  if (!isObject(body.values)) structural.push({ in: "body", path: "/values", code: body.values === undefined ? "required" : "invalid_type" });
  if (structural.length) throw validationFailed(structural);
  requireIfMatch(ifMatch, etagOf(String(settingsVersion(db, group))));

  const values = body.values as Record<string, unknown>;
  const changeNote = body.change_note;
  const errors: ApiFieldError[] = [];
  if (changeNote !== undefined && (typeof changeNote !== "string" || [...changeNote].length > 200)) {
    errors.push({ in: "body", path: "/change_note", code: "too_long", params: { max: 200 } });
  }
  const translateOnly = db.translateOnly.includes(group === "seo" ? "seo" : "settings");

  for (const key of Object.keys(values)) {
    if (!rows.some((r) => r.key === key)) errors.push({ in: "body", path: `/values/${key}`, code: "unknown_field" });
  }
  type Next = { value: string | null; media_id: number | null; translations: Record<string, string> };
  const next = new Map<string, Next>();
  for (const r of rows) {
    const path = `/values/${r.key}`;
    const given = values[r.key];
    // Translate-only writers may leave out the keys they can not edit (11.3).
    if (given === undefined) {
      if (translateOnly && !r.is_localized) {
        next.set(r.key, { value: r.value as string | null, media_id: r.media_id, translations: { ...r.translations } });
      } else {
        errors.push({ in: "body", path, code: "required" });
      }
      continue;
    }
    if (r.value_type === "media") {
      if (given !== null && (typeof given !== "number" || !Number.isInteger(given))) {
        errors.push({ in: "body", path, code: "invalid_type" });
        continue;
      }
      if (given !== null) {
        const asset = db.assets.find((a) => a.id === given && !a.deleted_at);
        if (!asset) errors.push({ in: "body", path, code: "unknown_reference" });
        else if (asset.status !== "ready") errors.push({ in: "body", path, code: "media_not_ready" });
        else if (r.accept && (!r.accept.kinds.includes(asset.kind) || !r.accept.mime_types.includes(asset.mime_type))) {
          errors.push({ in: "body", path, code: "invalid_format", params: { expected: r.accept.mime_types } });
        }
      }
      next.set(r.key, { value: null, media_id: given as number | null, translations: {} });
    } else if (r.is_localized) {
      if (!isObject(given)) {
        errors.push({ in: "body", path, code: "invalid_type" });
        continue;
      }
      const translations: Record<string, string> = {};
      for (const [code, v] of Object.entries(given)) {
        const p = `${path}/${code}`;
        if (!(MOCK_LOCALE_CODES as readonly string[]).includes(code)) {
          errors.push({ in: "body", path: p, code: "unknown_reference" });
          continue;
        }
        const before = errors.length;
        checkString(r, v, p, errors, false);
        const clean = errors.length === before ? normalise(r, v as string | null) : null;
        if (clean !== null) translations[code] = clean;
      }
      if (r.required && !translations[DEFAULT_LOCALE_CODE] && !errors.some((e) => e.path.startsWith(path))) {
        errors.push({ in: "body", path: `${path}/${DEFAULT_LOCALE_CODE}`, code: "required" });
      }
      next.set(r.key, { value: null, media_id: null, translations });
    } else {
      const before = errors.length;
      checkString(r, given, path, errors, true);
      next.set(r.key, { value: errors.length === before ? normalise(r, given as string | null) : null, media_id: null, translations: {} });
    }
  }
  if (errors.length) throw validationFailed(errors);

  // Translate-only: a non-localized value that differs from the stored one -> 403 (05 11.1.3).
  const changedKeys: string[] = [];
  for (const r of rows) {
    const n = next.get(r.key)!;
    const same = r.value_type === "media" ? n.media_id === r.media_id : r.is_localized ? JSON.stringify(sortObject(n.translations)) === JSON.stringify(sortObject(r.translations)) : n.value === r.value;
    if (!same) changedKeys.push(r.key);
  }
  if (translateOnly) {
    const bad = changedKeys.find((k) => !rows.find((r) => r.key === k)!.is_localized);
    if (bad) throw forbidden(`/values/${bad}`);
  }

  const warnings: SaveLiveWarning[] = [];
  const defaultDescription = next.get("default_description");
  if (group === "seo" && defaultDescription) {
    for (const [code, text] of Object.entries(defaultDescription.translations)) {
      if ([...text].length > SERP_RECOMMENDED) {
        warnings.push({ path: `/values/default_description/${code}`, code: "serp_description_long", message: "Longer than the 160 characters search engines usually show.", params: { length: [...text].length, recommended: SERP_RECOMMENDED } });
      }
    }
  }
  if (group === "site" && changedKeys.includes("base_url")) {
    warnings.push({ path: "/values/base_url", code: "base_url_changed", message: "Canonical URLs, the sitemap and links in e-mails change." });
  }

  if (changedKeys.length === 0) {
    return { data: groupOf(db, group, warnings), etag: etagOf(String(settingsVersion(db, group))) };
  }

  const before = settingsSnapshot(db, group);
  const at = tick(db);
  pushRevision(db, `settings`, group, "cms.site_settings", "history", before, typeof changeNote === "string" && changeNote ? changeNote : null, at, MOCK_USER, 1, rows[0] ? 100 + GROUPS.indexOf(group as (typeof GROUPS)[number]) : 0);
  for (const r of rows) {
    const n = next.get(r.key)!;
    r.value = n.value;
    r.media_id = n.media_id;
    r.translations = n.translations;
  }
  db.settingsUpdatedAt[group] = { at, by: MOCK_USER };
  return { data: groupOf(db, group, warnings), etag: etagOf(String(settingsVersion(db, group))) };
}

function sortObject(o: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

// ---------------------------------------------------------------------------------------------------------------
// Revisions (11.7)
// ---------------------------------------------------------------------------------------------------------------
type SnapshotRow = { key: string; value: string | null; media_asset_id: number | null; translations: Array<{ locale_code: string; value: string }> };

export function restoreSettings(db: MockDb, group: string, rev: { id: number; version: number; schema_version: number; snapshot: Record<string, unknown> }, note: string, ifMatch: string | null) {
  const rows = groupOrThrow(db, group);
  requireIfMatch(ifMatch, etagOf(String(settingsVersion(db, group))));
  if (rev.schema_version > 1) throw invalidState("snapshot_incompatible");
  const snapRows = ((rev.snapshot as { settings?: SnapshotRow[] }).settings ?? []) as SnapshotRow[];
  const errors: ApiFieldError[] = [];
  snapRows.forEach((s, i) => {
    if (!rows.some((r) => r.key === s.key)) errors.push({ in: "entity", path: `/settings/${i}/key`, code: "unknown_reference" });
    if (s.media_asset_id !== null) {
      const asset = db.assets.find((a) => a.id === s.media_asset_id && !a.deleted_at);
      if (!asset || asset.status !== "ready") errors.push({ in: "entity", path: `/settings/${i}/media_asset_id`, code: "unknown_reference" });
    }
    for (const t of s.translations) {
      if (!(MOCK_LOCALE_CODES as readonly string[]).includes(t.locale_code)) {
        errors.push({ in: "entity", path: `/settings/${i}/translations/${t.locale_code}`, code: "unknown_reference" });
      }
    }
  });
  if (errors.length) throw validationFailed(errors);

  const restoredFrom = { revision_id: rev.id, version: rev.version };
  const before = settingsSnapshot(db, group);
  const wanted = { group_key: group, settings: rows.map((r) => {
    const s = snapRows.find((x) => x.key === r.key);
    return {
      key: r.key,
      value: r.value_type === "media" || r.is_localized ? null : (s?.value ?? null),
      media_asset_id: r.value_type === "media" ? (s?.media_asset_id ?? null) : null,
      translations: r.is_localized ? (s?.translations ?? []) : [],
    };
  }) };
  if (JSON.stringify(wanted) === JSON.stringify(before)) {
    return { data: { ...groupOf(db, group), restored_from: restoredFrom }, etag: etagOf(String(settingsVersion(db, group))) };
  }
  const at = tick(db);
  pushRevision(db, "settings", group, "cms.site_settings", "restore", before, note, at, MOCK_USER, 1, 100 + GROUPS.indexOf(group as (typeof GROUPS)[number]));
  for (const r of rows) {
    const s = wanted.settings.find((x) => x.key === r.key)!;
    r.value = s.value;
    r.media_id = s.media_asset_id;
    r.translations = Object.fromEntries(s.translations.map((t) => [t.locale_code, t.value]));
  }
  db.settingsUpdatedAt[group] = { at, by: MOCK_USER };
  return { data: { ...groupOf(db, group), restored_from: restoredFrom }, etag: etagOf(String(settingsVersion(db, group))) };
}

// The brand group has two earlier versions (the state BEFORE two edits). INVENTED history: older tagline text, no
// logo / emblem yet in the first one, and the people.
export function seedSettingsRevisions(db: MockDb) {
  const base = Date.UTC(2026, 9, 20, 8, 0, 0);
  const current = settingsSnapshot(db, "brand") as { group_key: string; settings: SnapshotRow[] };
  const edit = (fn: (s: SnapshotRow) => SnapshotRow) => ({ group_key: "brand", settings: current.settings.map((s) => fn(structuredClone(s))) });
  const v1 = edit((s) => {
    if (s.key === "statement") return { ...s, translations: [{ locale_code: "la", value: "Wild paths." }, { locale_code: "en", value: "Wild paths." }] };
    if (s.key === "logo_media_id" || s.key === "emblem_media_id") return { ...s, media_asset_id: null };
    return s;
  });
  const v2 = edit((s) => {
    if (s.key === "statement") return { ...s, translations: s.translations.map((t) => ({ ...t, value: "Forging wild paths across the untamed earth." })) };
    return s;
  });
  pushRevision(db, "settings", "brand", "cms.site_settings", "history", v1, null, micros(base), { id: 4, name: "Somchai Vongsa" }, 1, 100);
  pushRevision(db, "settings", "brand", "cms.site_settings", "history", v2, "longer statement", micros(base + 600_000), { id: 6, name: "Noy Keomany" }, 1, 100);
}
