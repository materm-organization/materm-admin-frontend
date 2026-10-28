// The editable state of one settings group and what leaves it (doc/05 section 11.3, doc/07 sections 3.8 / 3.9).
// The draft is the group's `values` with every text as a string ("" = empty) so inputs stay controlled; the PUT
// payload turns it back (empty -> null, a language with no text is left out = its translation row is deleted).
import { PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { ApiFieldError } from "@/types/api";
import type { SettingsFieldDef, SettingsGroup, SettingsValue } from "@/types/settings";

export type DraftValue = string | number | null | Record<string, string>;
export type SettingsDraft = Record<string, DraftValue>;

export const SERP_RECOMMENDED_LENGTH = 160;
const E164 = /^\+[1-9]\d{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const permissionKeyOfGroup = (group: string) => (group === "seo" ? PERMISSION_KEYS.CMS_SEO : PERMISSION_KEYS.CMS_SETTINGS);

export function draftFromGroup(group: SettingsGroup): SettingsDraft {
  const draft: SettingsDraft = {};
  for (const field of group.fields) {
    const raw = group.values[field.key] as SettingsValue | undefined;
    if (field.value_type === "media") draft[field.key] = typeof raw === "number" ? raw : null;
    else if (field.is_localized) {
      const map: Record<string, string> = {};
      if (raw && typeof raw === "object") for (const [code, text] of Object.entries(raw)) if (typeof text === "string") map[code] = text;
      draft[field.key] = map;
    } else draft[field.key] = typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
  }
  return draft;
}

const text = (v: DraftValue | undefined, locale: string): string =>
  v && typeof v === "object" ? (v[locale] ?? "") : typeof v === "string" ? v : "";

export function isDraftDirty(group: SettingsGroup, draft: SettingsDraft): boolean {
  return changedKeys(group, draft).length > 0;
}

// Keys whose value differs from the loaded group (a language set to "" counts as the row being absent).
export function changedKeys(group: SettingsGroup, draft: SettingsDraft): string[] {
  const base = draftFromGroup(group);
  const trimmed = (v: DraftValue): unknown => {
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, t]) => t.trim() !== "").sort(([a], [b]) => a.localeCompare(b)));
    return typeof v === "string" ? v.trim() : v;
  };
  return group.fields.filter((f) => JSON.stringify(trimmed(draft[f.key] ?? "")) !== JSON.stringify(trimmed(base[f.key] ?? ""))).map((f) => f.key);
}

export function toPayloadValue(field: SettingsFieldDef, value: DraftValue | undefined): SettingsValue {
  if (field.value_type === "media") return typeof value === "number" ? value : null;
  if (field.is_localized) {
    const out: Record<string, string> = {};
    if (value && typeof value === "object") for (const [code, t] of Object.entries(value)) if (t.trim() !== "") out[code] = t.trim();
    return out;
  }
  const t = typeof value === "string" ? value.trim() : "";
  return t === "" ? null : t;
}

// `translateOnly`: a writer who holds `translate` without `update` sends the translatable keys only (05 11.3: the
// others may be left out; if sent they must be unchanged).
export function buildPutPayload(group: SettingsGroup, draft: SettingsDraft, options: { translateOnly?: boolean; changeNote?: string } = {}) {
  const values: Record<string, SettingsValue> = {};
  for (const field of group.fields) {
    if (options.translateOnly && !field.is_localized) continue;
    values[field.key] = toPayloadValue(field, draft[field.key]);
  }
  return { values, ...(options.changeNote ? { change_note: options.changeNote } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------
// Client checks (the server decides for real; these only spare a round trip). Paths are the API's:
// `/values/<key>` or `/values/<key>/<locale>`.
// ---------------------------------------------------------------------------------------------------------------
export function validateDraft(group: SettingsGroup, draft: SettingsDraft, defaultLocale: string, options: { translateOnly?: boolean } = {}): ApiFieldError[] {
  const errors: ApiFieldError[] = [];
  const add = (path: string, code: string, params?: ApiFieldError["params"]) => errors.push({ in: "body", path, code, ...(params ? { params } : {}) });
  for (const field of group.fields) {
    if (options.translateOnly && !field.is_localized) continue;
    const base = `/values/${field.key}`;
    if (field.value_type === "media") continue;
    const check = (value: string, path: string) => {
      const v = value.trim();
      if (v === "") return;
      if (field.max_length && [...v].length > field.max_length) return add(path, "too_long", { max: field.max_length });
      switch (field.value_type) {
        case "phone":
          if (!E164.test(v)) add(path, "pattern_mismatch");
          break;
        case "email":
          if (!EMAIL.test(v)) add(path, "invalid_format");
          break;
        case "url":
          if (!/^https:\/\/\S+$/.test(v) || (field.key === "base_url" && /[?#]/.test(v))) add(path, "pattern_mismatch");
          break;
        default:
          break;
      }
      if (group.group === "seo" && field.key === "title_template" && v.split("%s").length !== 2) add(path, "pattern_mismatch");
      if (group.group === "footer" && field.key === "copyright" && (v.match(/\{[^}]*\}/g) ?? []).some((t) => t !== "{year}")) add(path, "pattern_mismatch");
    };
    if (field.is_localized) {
      const map = (draft[field.key] && typeof draft[field.key] === "object" ? draft[field.key] : {}) as Record<string, string>;
      for (const [code, t] of Object.entries(map)) check(t, `${base}/${code}`);
      if (field.required && !(map[defaultLocale] ?? "").trim()) add(`${base}/${defaultLocale}`, "required");
    } else {
      const v = text(draft[field.key], defaultLocale);
      if (field.required && v.trim() === "") add(base, "required");
      else check(v, base);
    }
  }
  return errors;
}

// Required localized keys that still have no text, per language (the badges of the language switch).
export function localeCompleteness(group: SettingsGroup, draft: SettingsDraft, locales: readonly string[]) {
  const required = group.fields.filter((f) => f.is_localized && f.required);
  const result: Record<string, { missing: number; total: number; status: "complete" | "partial" | "missing" }> = {};
  const all = group.fields.filter((f) => f.is_localized);
  for (const code of locales) {
    const missing = required.filter((f) => !text(draft[f.key], code).trim()).length;
    const filled = all.filter((f) => text(draft[f.key], code).trim()).length;
    result[code] = {
      missing,
      total: required.length,
      status: missing === 0 ? "complete" : filled === 0 ? "missing" : "partial",
    };
  }
  return result;
}

// The group in the shape of a revision snapshot (05 11.7 item 3), for `RevisionsTab`'s "compare with current".
export function groupSnapshot(group: SettingsGroup): Record<string, unknown> {
  return {
    group_key: group.group,
    settings: group.fields.map((f) => {
      const v = group.values[f.key];
      return {
        key: f.key,
        value: f.value_type === "media" || f.is_localized ? null : (v ?? null),
        media_asset_id: f.value_type === "media" ? (typeof v === "number" ? v : null) : null,
        translations: f.is_localized && v && typeof v === "object" ? Object.entries(v).map(([locale_code, value]) => ({ locale_code, value })) : [],
      };
    }),
  };
}

// Footer copyright with `{year}` filled in (the live example).
export const previewCopyright = (template: string, year = new Date().getFullYear()) => template.replaceAll("{year}", String(year));

// SERP title: the template with its single `%s` replaced; null while the template is not valid.
export function previewTitle(template: string, pageTitle: string): string | null {
  return template.split("%s").length === 2 ? template.replace("%s", pageTitle) : null;
}

export function truncateForSerp(description: string, max = SERP_RECOMMENDED_LENGTH): string {
  const chars = [...description];
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : description;
}
