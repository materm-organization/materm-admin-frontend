// The editable state of the form editor (doc/05 13.6.3), pure (no React): the baseline is derived from the form the server sent, the
// draft is what the person typed, `buildFormPatch` turns the difference into a PATCH body that carries ONLY what changed.
//
// Rules the builder follows (they come from the backend, not from taste):
//  - a nullable text that is cleared is sent as `null`; a required one cleared is a problem, not a request;
//  - `messages` and `option_labels` REPLACE the whole map of their language, so they are sent whole whenever they changed (and
//    only then); a blank entry is dropped, which is also how one message is deleted;
//  - a language that is new needs a title and a submit label (a field text needs a label); a language the person removed is sent as
//    `null`, and the default language can never be removed;
//  - the settings are numbers in the inputs (text), sent as integers; only the ones that differ from the baseline are sent.
import {
  HONEYPOT_RE,
  MAX_FIELD_LABEL,
  MAX_FORM_DESCRIPTION,
  MAX_FORM_NAME,
  MAX_FORM_TITLE,
  MAX_HELP,
  MAX_MESSAGES,
  MAX_MESSAGE_TEXT,
  MAX_OPTION_LABEL,
  MAX_PLACEHOLDER,
  MAX_REDIRECT_URL,
  MAX_SENDING_LABEL,
  MAX_SUBMIT_LABEL,
  MAX_SUCCESS_AGAIN,
  MAX_SUCCESS_DESCRIPTION,
  MAX_SUCCESS_TITLE,
  MESSAGE_KEY_RE,
  REDIRECT_RE,
  SETTING_RANGES,
} from "@/lib/forms";
import type { FormDetail, FormFieldTranslation, FormFieldTranslationPatch, FormTranslation, FormTranslationPatch, UpdateFormPayload } from "@/types/forms";

// What the person may change: everything (`update`), only texts and labels in any language (`translate`), nothing.
export type FormEditMode = "full" | "translate" | "none";

export type MessageRow = { id: string; code: string; text: string };

// A language of the form texts. Nullable members are "" while edited.
export type TextDraft = {
  title: string;
  description: string;
  submit_label: string;
  sending_label: string;
  success_title: string;
  success_description: string;
  success_again_label: string;
  messages: MessageRow[];
};

export type FieldTextDraft = { label: string; placeholder: string; help: string; option_labels: Record<string, string> };

export type SettingsDraft = {
  name: string;
  store_submissions: boolean;
  retention_days: string;
  honeypot_field: string;
  rate_limit_max: string;
  rate_limit_window_s: string;
  rate_limit_daily_max: string;
  min_fill_seconds: string;
  notify_enabled: boolean;
  success_redirect_url: string;
};

export type FormDraft = {
  settings: SettingsDraft;
  // Only the languages that have a row (adding one is an action of the person).
  texts: Record<string, TextDraft>;
  // `[field key][locale]`, one entry per field and per active language; a blank entry means "no row".
  fields: Record<string, Record<string, FieldTextDraft>>;
};

export type FormProblemCode = "required" | "too_long" | "out_of_range" | "invalid_format" | "pattern_mismatch" | "duplicate" | "too_many" | "invalid_email";
export type FormProblems = Record<string, FormProblemCode>;

let seq = 0;
const rowId = () => `m${(seq += 1)}`;

const orEmpty = (v: string | null | undefined) => v ?? "";

export function textDraftFrom(t: FormTranslation | undefined): TextDraft {
  return {
    title: orEmpty(t?.title),
    description: orEmpty(t?.description),
    submit_label: orEmpty(t?.submit_label),
    sending_label: orEmpty(t?.sending_label),
    success_title: orEmpty(t?.success_title),
    success_description: orEmpty(t?.success_description),
    success_again_label: orEmpty(t?.success_again_label),
    messages: Object.entries(t?.messages ?? {}).map(([code, text]) => ({ id: rowId(), code, text })),
  };
}

const fieldDraftFrom = (t: FormFieldTranslation | undefined): FieldTextDraft => ({
  label: orEmpty(t?.label),
  placeholder: orEmpty(t?.placeholder),
  help: orEmpty(t?.help),
  option_labels: { ...(t?.option_labels ?? {}) },
});

export function draftFromForm(form: FormDetail, localeCodes: readonly string[]): FormDraft {
  const s = form.settings;
  const settings: SettingsDraft = {
    name: form.name,
    store_submissions: s.store_submissions,
    retention_days: String(s.retention_days),
    honeypot_field: orEmpty(s.honeypot_field),
    rate_limit_max: String(s.rate_limit_max),
    rate_limit_window_s: String(s.rate_limit_window_s),
    rate_limit_daily_max: String(s.rate_limit_daily_max),
    min_fill_seconds: String(s.min_fill_seconds),
    notify_enabled: s.notify_enabled,
    success_redirect_url: orEmpty(s.success_redirect_url),
  };
  // A language the form has a row for but that is not active any more is still shown (its text is kept).
  const codes = [...new Set([...localeCodes, ...Object.keys(form.translations)])];
  const texts: Record<string, TextDraft> = {};
  for (const code of Object.keys(form.translations)) texts[code] = textDraftFrom(form.translations[code]);
  const fields: Record<string, Record<string, FieldTextDraft>> = {};
  for (const f of form.fields) {
    fields[f.key] = {};
    for (const code of codes) fields[f.key][code] = fieldDraftFrom(form.field_translations[f.key]?.[code]);
  }
  return { settings, texts, fields };
}

const blank = (v: string) => v.trim() === "";
const isBlankField = (f: FieldTextDraft | undefined) => !f || (blank(f.label) && blank(f.placeholder) && blank(f.help) && Object.values(f.option_labels).every(blank));

// The messages as the map the server stores: blank code AND blank text rows are dropped; the text is not trimmed.
export const messagesToMap = (rows: MessageRow[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const r of rows) if (!(blank(r.code) && blank(r.text))) out[r.code.trim()] = r.text;
  return out;
};
const optionMap = (m: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(m).filter(([, v]) => !blank(v)).map(([k, v]) => [k, v.trim()]));
const sameMap = (a: Record<string, string>, b: Record<string, string>) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

// Equal "as sent": row ids and blank entries do not count and neither does the white space around a text (the PATCH trims it).
const trimmed = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])) as T;
function canonical(d: FormDraft) {
  return {
    settings: trimmed(d.settings),
    texts: Object.fromEntries(Object.entries(d.texts).map(([k, t]) => [k, { ...trimmed(t), messages: Object.entries(messagesToMap(t.messages)).sort() }])),
    fields: Object.fromEntries(
      Object.entries(d.fields).map(([key, byLocale]) => [
        key,
        Object.fromEntries(
          Object.entries(byLocale)
            .filter(([, f]) => !isBlankField(f))
            .map(([code, f]) => [code, { ...trimmed(f), option_labels: Object.entries(optionMap(f.option_labels)).sort() }])
        ),
      ])
    ),
  };
}
export const draftsEqual = (a: FormDraft, b: FormDraft) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// ---- validation (the same rules and limits as the server; the server decides for real) --------------------------------------------
export function validateDraft(draft: FormDraft, ctx: { defaultLocale: string; fieldKeys: string[]; mode: FormEditMode; baseline: FormDraft }): FormProblems {
  const p: FormProblems = {};
  const len = (v: string) => [...v.trim()].length;
  const text = (key: string, v: string, max: number, required: boolean) => {
    if (required && blank(v)) p[key] = "required";
    else if (len(v) > max) p[key] = "too_long";
  };
  if (ctx.mode === "full") {
    const s = draft.settings;
    text("name", s.name, MAX_FORM_NAME, true);
    (Object.keys(SETTING_RANGES) as Array<keyof typeof SETTING_RANGES>).forEach((k) => {
      const raw = s[k].trim();
      const [min, max] = SETTING_RANGES[k];
      if (raw === "") p[k] = "required";
      else if (!/^\d{1,9}$/.test(raw)) p[k] = "invalid_format";
      else if (Number(raw) < min || Number(raw) > max) p[k] = "out_of_range";
    });
    if (!blank(s.honeypot_field)) {
      if (!HONEYPOT_RE.test(s.honeypot_field.trim())) p.honeypot_field = "pattern_mismatch";
      else if (ctx.fieldKeys.includes(s.honeypot_field.trim())) p.honeypot_field = "duplicate";
    }
    if (!blank(s.success_redirect_url)) {
      if (len(s.success_redirect_url) > MAX_REDIRECT_URL) p.success_redirect_url = "too_long";
      else if (!REDIRECT_RE.test(s.success_redirect_url.trim())) p.success_redirect_url = "pattern_mismatch";
    }
  }
  for (const [code, t] of Object.entries(draft.texts)) {
    text(`texts.${code}.title`, t.title, MAX_FORM_TITLE, true);
    text(`texts.${code}.submit_label`, t.submit_label, MAX_SUBMIT_LABEL, true);
    text(`texts.${code}.description`, t.description, MAX_FORM_DESCRIPTION, false);
    text(`texts.${code}.sending_label`, t.sending_label, MAX_SENDING_LABEL, false);
    text(`texts.${code}.success_title`, t.success_title, MAX_SUCCESS_TITLE, false);
    text(`texts.${code}.success_description`, t.success_description, MAX_SUCCESS_DESCRIPTION, false);
    text(`texts.${code}.success_again_label`, t.success_again_label, MAX_SUCCESS_AGAIN, false);
    const seen = new Set<string>();
    t.messages.forEach((row, i) => {
      if (blank(row.code) && blank(row.text)) return;
      const key = `texts.${code}.messages.${i}`;
      if (!MESSAGE_KEY_RE.test(row.code.trim())) p[`${key}.code`] = blank(row.code) ? "required" : "pattern_mismatch";
      else if (seen.has(row.code.trim())) p[`${key}.code`] = "duplicate";
      seen.add(row.code.trim());
      if ([...row.text].length > MAX_MESSAGE_TEXT) p[`${key}.text`] = "too_long";
    });
    if (Object.keys(messagesToMap(t.messages)).length > MAX_MESSAGES) p[`texts.${code}.messages`] = "too_many";
  }
  for (const [key, byLocale] of Object.entries(draft.fields)) {
    for (const [code, f] of Object.entries(byLocale)) {
      const base = `fields.${key}.${code}`;
      if (isBlankField(f)) {
        // The default language's text of a field cannot be removed: clearing a label that was there is a problem, not a silent skip.
        if (code === ctx.defaultLocale && !isBlankField(ctx.baseline.fields[key]?.[code])) p[`${base}.label`] = "required";
        continue;
      }
      text(`${base}.label`, f.label, MAX_FIELD_LABEL, true);
      text(`${base}.placeholder`, f.placeholder, MAX_PLACEHOLDER, false);
      text(`${base}.help`, f.help, MAX_HELP, false);
      for (const [option, label] of Object.entries(f.option_labels)) if (len(label) > MAX_OPTION_LABEL) p[`${base}.option_labels.${option}`] = "too_long";
    }
  }
  return p;
}

// ---- the PATCH body --------------------------------------------------------------------------------------------------------------
const nullable = (v: string): string | null => (blank(v) ? null : v.trim());

function textPatch(base: TextDraft | undefined, now: TextDraft): FormTranslationPatch {
  const isNew = base === undefined;
  const patch: FormTranslationPatch = {};
  const same = (k: keyof Omit<TextDraft, "messages">) => !isNew && base[k].trim() === now[k].trim();
  if (!same("title")) patch.title = now.title.trim();
  if (!same("submit_label")) patch.submit_label = now.submit_label.trim();
  for (const k of ["description", "sending_label", "success_title", "success_description", "success_again_label"] as const) {
    // A new language sends only what has a value; an old one sends a cleared text as null.
    if (!same(k) && !(isNew && blank(now[k]))) patch[k] = nullable(now[k]);
  }
  const nowMessages = messagesToMap(now.messages);
  if (isNew ? Object.keys(nowMessages).length > 0 : !sameMap(messagesToMap(base.messages), nowMessages)) patch.messages = nowMessages;
  return patch;
}

function fieldPatch(base: FieldTextDraft | undefined, now: FieldTextDraft): FormFieldTranslationPatch {
  const patch: FormFieldTranslationPatch = {};
  if (!base || base.label.trim() !== now.label.trim()) patch.label = now.label.trim();
  if ((!base && !blank(now.placeholder)) || (base && base.placeholder.trim() !== now.placeholder.trim())) patch.placeholder = nullable(now.placeholder);
  if ((!base && !blank(now.help)) || (base && base.help.trim() !== now.help.trim())) patch.help = nullable(now.help);
  const nowOptions = optionMap(now.option_labels);
  if (base ? !sameMap(optionMap(base.option_labels), nowOptions) : Object.keys(nowOptions).length > 0) patch.option_labels = nowOptions;
  return patch;
}

// `null` when nothing changed. `mode === "translate"` never carries a setting (the server would answer 403).
export function buildFormPatch(baseline: FormDraft, draft: FormDraft, defaultLocale: string, mode: FormEditMode): UpdateFormPayload | null {
  const out: UpdateFormPayload = {};
  if (mode === "full") {
    const a = baseline.settings;
    const b = draft.settings;
    if (a.name.trim() !== b.name.trim()) out.name = b.name.trim();
    for (const k of ["store_submissions", "notify_enabled"] as const) if (a[k] !== b[k]) out[k] = b[k];
    for (const k of ["retention_days", "rate_limit_max", "rate_limit_window_s", "rate_limit_daily_max", "min_fill_seconds"] as const) if (a[k].trim() !== b[k].trim()) out[k] = Number(b[k]);
    if (a.honeypot_field.trim() !== b.honeypot_field.trim()) out.honeypot_field = nullable(b.honeypot_field);
    if (a.success_redirect_url.trim() !== b.success_redirect_url.trim()) out.success_redirect_url = nullable(b.success_redirect_url);
  }
  const translations: NonNullable<UpdateFormPayload["translations"]> = {};
  for (const code of new Set([...Object.keys(baseline.texts), ...Object.keys(draft.texts)])) {
    const base = baseline.texts[code];
    const now = draft.texts[code];
    if (base && !now) {
      if (code !== defaultLocale) translations[code] = null;
    } else if (now) {
      const patch = textPatch(base, now);
      if (Object.keys(patch).length > 0) translations[code] = patch;
    }
  }
  if (Object.keys(translations).length > 0) out.translations = translations;

  const fieldTranslations: NonNullable<UpdateFormPayload["field_translations"]> = {};
  for (const [key, byLocale] of Object.entries(draft.fields)) {
    for (const [code, now] of Object.entries(byLocale)) {
      const base = baseline.fields[key]?.[code];
      const had = !isBlankField(base);
      const has = !isBlankField(now);
      if (!had && !has) continue;
      if (had && !has) {
        // Blanking a language's texts removes the row - except the default language's, which must keep its label (kept as it was).
        if (code !== defaultLocale) (fieldTranslations[key] ??= {})[code] = null;
        continue;
      }
      const patch = fieldPatch(had ? base : undefined, now);
      if (Object.keys(patch).length > 0) (fieldTranslations[key] ??= {})[code] = patch;
    }
  }
  if (Object.keys(fieldTranslations).length > 0) out.field_translations = fieldTranslations;
  return Object.keys(out).length > 0 ? out : null;
}

// ---- where a server error belongs -------------------------------------------------------------------------------------------------
// `/translations/la/title` -> `texts.la.title`; `/translations/la/messages/required` -> `texts.la.messages.<row>.text`-ish (the
// row with that code); `/field_translations/email/la/label` -> `fields.email.la.label`; `/name` -> `name`.
export function problemKeyOf(path: string, draft?: FormDraft): string {
  const t = /^\/translations\/([^/]+)\/([a-z_]+)(?:\/(.+))?$/.exec(path);
  if (t) {
    if (t[2] === "messages" && t[3] && draft) {
      const index = draft.texts[t[1]]?.messages.findIndex((m) => m.code === t[3]);
      if (index !== undefined && index >= 0) return `texts.${t[1]}.messages.${index}.text`;
    }
    return `texts.${t[1]}.${t[2]}`;
  }
  const f = /^\/field_translations\/([^/]+)\/([^/]+)\/([a-z_]+)(?:\/(.+))?$/.exec(path);
  if (f) return `fields.${f[1]}.${f[2]}.${f[3]}${f[4] ? `.${f[4]}` : ""}`;
  return path.replace(/^\//, "").replace(/\//g, ".") || "form";
}

// Which tab shows a problem key, and (for a text) which language.
export function problemTab(key: string): { tab: "texts" | "fields" | "settings"; locale?: string } {
  const [head, a, b] = key.split(".");
  if (head === "texts") return { tab: "texts", locale: a };
  if (head === "fields") return { tab: "fields", locale: b };
  return { tab: "settings" };
}

// The PublishBar's pointer (`/translations/la/title`, `/field_translations/email/la/label`, `/recipients`, `/settings/...`) -> tab, language, element id.
export function formPointerTarget(pointer: string): { tab: "texts" | "fields" | "recipients" | "settings"; locale?: string; id?: string } {
  const t = /^\/translations\/([^/]+)\/([a-z_]+)/.exec(pointer);
  if (t) return { tab: "texts", locale: t[1], id: `form-text-${t[2]}-${t[1]}` };
  const f = /^\/field_translations\/([^/]+)\/([^/]+)\/([a-z_]+)(?:\/(.+))?/.exec(pointer);
  if (f) return { tab: "fields", locale: f[2], id: f[3] === "option_labels" && f[4] ? `form-field-${f[1]}-option-${f[4]}-${f[2]}` : `form-field-${f[1]}-${f[3]}-${f[2]}` };
  if (pointer.startsWith("/recipients")) return { tab: "recipients" };
  const s = /^\/settings\/([a-z_]+)/.exec(pointer);
  if (s) return { tab: "settings", id: `form-setting-${s[1]}` };
  return { tab: "texts" };
}

