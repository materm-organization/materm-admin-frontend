import { describe, expect, it } from "vitest";

import { buildFormPatch, draftFromForm, draftsEqual, formPointerTarget, messagesToMap, problemKeyOf, problemTab, validateDraft, type FormDraft } from "@/components/protected/forms/form-draft";
import { getMockDb, resetMockDb } from "@/mocks/mock-db";
import { formDetail, formsState } from "@/mocks/mock-forms";

const LOCALES = ["la", "en"];
const load = (id: number): FormDraft => {
  const db = getMockDb();
  const form = formsState(db).forms.find((f) => f.id === id)!;
  return draftFromForm(formDetail(db, form), LOCALES);
};
const clone = (d: FormDraft): FormDraft => structuredClone(d);
const ctx = (d: FormDraft, mode: "full" | "translate" = "full") => ({ defaultLocale: "la", fieldKeys: ["name", "email", "phone", "topic", "message"], mode, baseline: d });

describe("form draft", () => {
  it("derives the baseline from the form: every field has an entry per language, messages become rows", () => {
    resetMockDb();
    const d = load(1);
    expect(Object.keys(d.texts)).toEqual(["la", "en"]);
    expect(d.settings).toMatchObject({ name: "Contact form", retention_days: "365", honeypot_field: "company", store_submissions: true });
    expect(d.texts.en.messages.map((m) => m.code)).toContain("required");
    expect(Object.keys(d.fields.topic)).toEqual(["la", "en"]);
    expect(d.fields.topic.en.option_labels.events).toBe("Music nights & events");
  });

  it("nothing changed means no patch; row ids and blank entries do not count", () => {
    resetMockDb();
    const base = load(1);
    expect(buildFormPatch(base, clone(base), "la", "full")).toBeNull();
    expect(draftsEqual(base, load(1))).toBe(true);
    const edited = clone(base);
    edited.fields.email.en.help = "   ";
    expect(draftsEqual(base, edited)).toBe(true);
  });

  it("sends only the members that changed; a cleared nullable text is null", () => {
    resetMockDb();
    const base = load(1);
    const d = clone(base);
    d.texts.en.title = "  Say hello ";
    d.texts.en.description = "";
    expect(buildFormPatch(base, d, "la", "full")).toEqual({ translations: { en: { title: "Say hello", description: null } } });
  });

  it("messages are sent whole when they change and a blank row is how one is deleted", () => {
    resetMockDb();
    const base = load(1);
    const d = clone(base);
    const removed = d.texts.en.messages.find((m) => m.code === "summary")!;
    d.texts.en.messages = d.texts.en.messages.filter((m) => m !== removed);
    d.texts.en.messages.find((m) => m.code === "required")!.text = "Needed";
    const patch = buildFormPatch(base, d, "la", "full")!;
    const sent = patch.translations!.en!.messages!;
    expect(sent.required).toBe("Needed");
    expect(sent).not.toHaveProperty("summary");
    expect(Object.keys(sent)).toHaveLength(Object.keys(messagesToMap(base.texts.en.messages)).length - 1);
    // an untouched language sends nothing
    expect(patch.translations).not.toHaveProperty("la");
  });

  it("settings: numbers go as integers, only the changed ones; a translator never sends one", () => {
    resetMockDb();
    const base = load(1);
    const d = clone(base);
    d.settings.retention_days = "90";
    d.settings.honeypot_field = "";
    d.settings.notify_enabled = false;
    d.texts.en.title = "Hi";
    expect(buildFormPatch(base, d, "la", "full")).toEqual({ retention_days: 90, honeypot_field: null, notify_enabled: false, translations: { en: { title: "Hi" } } });
    expect(buildFormPatch(base, d, "la", "translate")).toEqual({ translations: { en: { title: "Hi" } } });
  });

  it("a language that is added needs its title and submit label and sends what it has; a removed one is null, never the default", () => {
    resetMockDb();
    const base = load(2);
    const d = clone(base);
    d.texts.en = { ...d.texts.la, title: "Stay in touch", submit_label: "Join", messages: [] };
    expect(buildFormPatch(base, d, "la", "full")).toEqual({ translations: { en: { title: "Stay in touch", submit_label: "Join" } } });
    const both = load(1);
    const removed = clone(both);
    delete removed.texts.en;
    delete removed.texts.la;
    expect(buildFormPatch(both, removed, "la", "full")).toEqual({ translations: { en: null } });
  });

  it("field texts: a changed label, the whole option map when it changed, a new language row, a removed one (null)", () => {
    resetMockDb();
    const base = load(1);
    const d = clone(base);
    d.fields.email.en.label = "E-mail";
    d.fields.topic.en.option_labels.events = "Events";
    const patch = buildFormPatch(base, d, "la", "full")!;
    expect(patch.field_translations!.email.en).toEqual({ label: "E-mail" });
    expect(patch.field_translations!.topic.en!.option_labels).toEqual({ booking: "Booking & stays", events: "Events", camping: "Camping & treks", other: "Something else" });
    expect(patch.field_translations!.topic.en).not.toHaveProperty("label");

    const added = load(2);
    const e = clone(added);
    e.fields.email.en = { label: "Email", placeholder: "you@x.example", help: "", option_labels: {} };
    expect(buildFormPatch(added, e, "la", "full")!.field_translations).toEqual({ email: { en: { label: "Email", placeholder: "you@x.example" } } });

    const gone = clone(base);
    gone.fields.phone.en = { label: "", placeholder: "", help: "", option_labels: {} };
    expect(buildFormPatch(base, gone, "la", "full")!.field_translations).toEqual({ phone: { en: null } });
    // the default language's texts cannot be removed: nothing is sent (validation names the label)
    const noDefault = clone(base);
    noDefault.fields.phone.la = { label: "", placeholder: "", help: "", option_labels: {} };
    expect(buildFormPatch(base, noDefault, "la", "full")).toBeNull();
    expect(validateDraft(noDefault, ctx(base))["fields.phone.la.label"]).toBe("required");
  });
});

describe("validation", () => {
  it("applies the limits and formats of the server", () => {
    resetMockDb();
    const base = load(1);
    const d = clone(base);
    d.settings.name = " ";
    d.settings.retention_days = "10";
    d.settings.rate_limit_max = "abc";
    d.settings.min_fill_seconds = "";
    d.settings.honeypot_field = "name";
    d.settings.success_redirect_url = "ftp://x";
    d.texts.en.title = "";
    d.texts.en.submit_label = "x".repeat(61);
    d.texts.en.messages = [{ id: "a", code: "1bad", text: "x" }, { id: "b", code: "ok", text: "x".repeat(301) }, { id: "c", code: "ok", text: "y" }];
    d.fields.email.en.label = "x".repeat(121);
    d.fields.topic.en.option_labels.events = "z".repeat(121);
    expect(validateDraft(d, ctx(base))).toEqual({
      name: "required",
      retention_days: "out_of_range",
      rate_limit_max: "invalid_format",
      min_fill_seconds: "required",
      honeypot_field: "duplicate",
      success_redirect_url: "pattern_mismatch",
      "texts.en.title": "required",
      "texts.en.submit_label": "too_long",
      "texts.en.messages.0.code": "pattern_mismatch",
      "texts.en.messages.1.text": "too_long",
      "texts.en.messages.2.code": "duplicate",
      "fields.email.en.label": "too_long",
      "fields.topic.en.option_labels.events": "too_long",
    });
  });

  it("a translator is not asked about settings", () => {
    resetMockDb();
    const base = load(1);
    const d = clone(base);
    d.settings.retention_days = "1";
    expect(validateDraft(d, ctx(base, "translate"))).toEqual({});
  });

  it("more than 30 messages is too many", () => {
    resetMockDb();
    const base = load(1);
    const d = clone(base);
    d.texts.en.messages = Array.from({ length: 31 }, (_, i) => ({ id: `m${i}`, code: `c${i}`, text: "x" }));
    expect(validateDraft(d, ctx(base))["texts.en.messages"]).toBe("too_many");
  });
});

describe("pointers", () => {
  it("maps a server path to a problem key and to a tab", () => {
    resetMockDb();
    const d = load(1);
    expect(problemKeyOf("/translations/en/title")).toBe("texts.en.title");
    expect(problemKeyOf("/translations/en/messages/summary", d)).toBe(`texts.en.messages.${d.texts.en.messages.findIndex((m) => m.code === "summary")}.text`);
    expect(problemKeyOf("/field_translations/topic/en/option_labels/events")).toBe("fields.topic.en.option_labels.events");
    expect(problemKeyOf("/retention_days")).toBe("retention_days");
    expect(problemTab("texts.en.title")).toEqual({ tab: "texts", locale: "en" });
    expect(problemTab("fields.topic.en.label")).toEqual({ tab: "fields", locale: "en" });
    expect(problemTab("name")).toEqual({ tab: "settings" });
  });

  it("maps the publish pointers of 13.6.5 to a tab, a language and the input to focus", () => {
    expect(formPointerTarget("/translations/la/title")).toEqual({ tab: "texts", locale: "la", id: "form-text-title-la" });
    expect(formPointerTarget("/field_translations/email/la/label")).toEqual({ tab: "fields", locale: "la", id: "form-field-email-label-la" });
    expect(formPointerTarget("/field_translations/topic/la/option_labels/events")).toEqual({ tab: "fields", locale: "la", id: "form-field-topic-option-events-la" });
    expect(formPointerTarget("/recipients")).toEqual({ tab: "recipients" });
    expect(formPointerTarget("/settings/honeypot_field")).toEqual({ tab: "settings", id: "form-setting-honeypot_field" });
  });
});
