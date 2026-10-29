import { beforeEach, describe, expect, it } from "vitest";

import { MockHttpError, getMockDb, resetMockDb } from "@/mocks/mock-db";
import {
  discardFormDraft,
  getForm,
  getFormRevision,
  listFormRevisions,
  listForms,
  patchForm,
  publishForm,
  recipientsEtag,
  replaceRecipients,
  restoreFormRevision,
  setFormsRole,
  unpublishForm,
} from "@/mocks/mock-forms";

// The forms part of the mock API (doc/05 section 13.6): the contract the forms screens are written against.
const fails = (fn: () => unknown, status: number, code?: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(MockHttpError);
    expect((error as MockHttpError).status).toBe(status);
    if (code) expect((error as MockHttpError).body.code).toBe(code);
    return error as MockHttpError;
  }
  throw new Error("expected the call to fail");
};
const errorsOf = (e: MockHttpError) => e.body.errors as Array<{ path: string; code: string; in: string; params?: Record<string, unknown> }>;
const q = (s = "") => new URLSearchParams(s);
const get = (id: number) => getForm(getMockDb(), String(id));
const patch = (id: number, body: unknown, ifMatch: string | null = get(id).etag) => patchForm(getMockDb(), String(id), body, ifMatch);
const put = (id: number, recipients: unknown[], ifMatch: string | null = get(id).data.recipients_etag) => replaceRecipients(getMockDb(), String(id), { recipients }, ifMatch);
const TO = { email: "hello@materm.example", kind: "to", topic_value: null, is_active: true };

beforeEach(() => resetMockDb());

describe("GET /forms", () => {
  it("lists the seeded forms with the lifecycle block, the active recipient count and the draft", () => {
    const { data, meta } = listForms(getMockDb(), q());
    expect(meta.total).toBe(3);
    expect(data.map((f) => f.slug)).toEqual(["contact", "newsletter", "trek-booking"]);
    expect(data[0]).toMatchObject({ id: 1, name: "Contact form", is_system: true, status: "published", recipient_count: 0, has_unpublished_changes: false, draft: null, lock_version: 1 });
    expect(data[2]).toMatchObject({ status: "published", recipient_count: 3, has_unpublished_changes: true, name: "Trek booking (2027 season)" });
    expect(data[2].draft).not.toBeNull();
  });

  it("filters and sorts; an unknown parameter or a bad value is a 422", () => {
    const db = getMockDb();
    expect(listForms(db, q("status=draft")).data.map((f) => f.id)).toEqual([2]);
    expect(listForms(db, q("has_unpublished_changes=true")).data.map((f) => f.id)).toEqual([3]);
    expect(listForms(db, q("keyword=TREK")).data.map((f) => f.id)).toEqual([3]);
    expect(listForms(db, q("sort=-slug")).data.map((f) => f.id)).toEqual([3, 2, 1]);
    expect(errorsOf(fails(() => listForms(db, q("trashed=true")), 422, "VALIDATION_FAILED"))[0]).toMatchObject({ in: "query", path: "/trashed", code: "unknown_field" });
    expect(errorsOf(fails(() => listForms(db, q("sort=id")), 422))[0].path).toBe("/sort");
    // what the form picker of the page editor sends
    expect(listForms(db, q("limit=20&keyword=contact")).data.map((f) => ({ slug: f.slug, name: f.name }))).toEqual([{ slug: "contact", name: "Contact form" }]);
  });
});

describe("GET /forms/{id}", () => {
  it("answers the working copy with fields, topics, texts, recipients and the two validators", () => {
    const { data, etag } = get(1);
    expect(etag).toBe('"1"');
    expect(data.fields.map((f) => f.key)).toEqual(["name", "email", "phone", "topic", "message"]);
    expect(data.fields.find((f) => f.key === "email")).toMatchObject({ type: "email", required: true, pii: true });
    expect(data.topics.map((t) => t.value)).toEqual(["booking", "events", "camping", "other"]);
    expect(data.topics[0].labels).toEqual({ la: "Booking & stays", en: "Booking & stays" });
    expect(data.translations.en.messages.required).toBe("This field is required");
    expect(data.field_translations.topic.en.option_labels.events).toBe("Music nights & events");
    expect(data.settings).toMatchObject({ store_submissions: true, retention_days: 365, honeypot_field: "company", retention_mode: "anonymize" });
    expect(data.recipients).toEqual([]);
    expect(data.recipients_etag).toMatch(/^"[0-9a-f]+"$/);
    expect(data.missing_locales).toEqual([]);
    expect(get(2).data.missing_locales).toEqual(["en"]);
    // the topics of the trek form carry the addresses bound to them
    expect(get(3).data.topics.find((t) => t.value === "trek")!.notify_override).toEqual(["treks@materm.example"]);
    expect(() => getForm(getMockDb(), "99")).toThrow(MockHttpError);
  });
});

describe("PATCH /forms/{id}", () => {
  it("needs If-Match (428) and refuses a stale one (409)", () => {
    fails(() => patch(1, { name: "X" }, null), 428);
    fails(() => patch(1, { name: "X" }, '"7"'), 409, "CONFLICT_LOCK_VERSION");
  });

  it("refuses unknown members, the field schema (not_applicable), slug / status (immutable), recipients and an empty body", () => {
    const e = errorsOf(fails(() => patch(1, { json_schema: {}, field_order: [], schema_version: 2, retention_mode: "x", slug: "x", status: "draft", recipients: [], extra: 1 }), 422));
    const byPath = Object.fromEntries(e.map((x) => [x.path, x.code]));
    expect(byPath).toMatchObject({ "/json_schema": "not_applicable", "/field_order": "not_applicable", "/schema_version": "not_applicable", "/retention_mode": "not_applicable", "/slug": "immutable", "/status": "immutable", "/recipients": "unknown_field", "/extra": "unknown_field" });
    fails(() => patch(1, {}), 422);
  });

  it("validates the settings with the codes of 13.6.3", () => {
    const e = errorsOf(
      fails(() => patch(1, { name: "", retention_days: 10, honeypot_field: "name", rate_limit_max: 5000, min_fill_seconds: -1, success_redirect_url: "ftp://x" }), 422)
    );
    const byPath = Object.fromEntries(e.map((x) => [x.path, x]));
    expect(byPath["/name"].code).toBe("required");
    expect(byPath["/retention_days"].code).toBe("out_of_range");
    expect(byPath["/honeypot_field"]).toMatchObject({ code: "duplicate", params: { reason: "field" } });
    expect(byPath["/rate_limit_max"].code).toBe("out_of_range");
    expect(byPath["/min_fill_seconds"].code).toBe("out_of_range");
    expect(byPath["/success_redirect_url"].code).toBe("pattern_mismatch");
  });

  it("store_submissions=false without an active recipient is recipients_required (BR-34)", () => {
    expect(errorsOf(fails(() => patch(1, { store_submissions: false }), 422))[0]).toMatchObject({ path: "/store_submissions", code: "recipients_required" });
    expect(patch(3, { store_submissions: false }).data.settings.store_submissions).toBe(false);
  });

  it("edits the texts of a language: a merge, messages replace the whole map, null clears a nullable text", () => {
    const r = patch(2, { translations: { la: { title: "Hello", description: "A line", messages: { required: "Needed" } } } });
    expect(r.etag).toBe('"2"');
    expect(r.data.translations.la).toMatchObject({ title: "Hello", description: "A line", submit_label: "Subscribe", messages: { required: "Needed" } });
    const r2 = patch(2, { translations: { la: { description: null } } });
    expect(r2.data.translations.la.description).toBeNull();
    expect(r2.data.translations.la.title).toBe("Hello");
  });

  it("adds a language only with a title and a submit label, deletes a non-default one, never the default", () => {
    const e = errorsOf(fails(() => patch(2, { translations: { en: { description: "x" } } }), 422));
    expect(e.map((x) => x.path).sort()).toEqual(["/translations/en/submit_label", "/translations/en/title"]);
    const added = patch(2, { translations: { en: { title: "Stay in touch", submit_label: "Subscribe" } } });
    expect(added.data.missing_locales).toEqual([]);
    expect(patch(2, { translations: { en: null } }).data.missing_locales).toEqual(["en"]);
    expect(errorsOf(fails(() => patch(2, { translations: { la: null } }), 422))[0]).toMatchObject({ path: "/translations/la", code: "required" });
    expect(errorsOf(fails(() => patch(2, { translations: { fr: { title: "x", submit_label: "y" } } }), 422))[0]).toMatchObject({ path: "/translations/fr", code: "unknown_reference" });
    expect(errorsOf(fails(() => patch(2, { translations: { la: { title: "x".repeat(121) } } }), 422))[0]).toMatchObject({ path: "/translations/la/title", code: "too_long" });
    expect(errorsOf(fails(() => patch(2, { translations: { la: { messages: { "1bad": "x" } } } }), 422))[0]).toMatchObject({ path: "/translations/la/messages/1bad", code: "pattern_mismatch" });
  });

  it("field texts: the field must exist, option label keys must be options, a new language needs a label", () => {
    const ok = patch(1, { field_translations: { topic: { en: { option_labels: { booking: "Stays", events: "Events", camping: "Camping", other: "Other" } } } } });
    expect(ok.data.field_translations.topic.en.option_labels.booking).toBe("Stays");
    expect(errorsOf(fails(() => patch(1, { field_translations: { nope: { en: { label: "x" } } } }), 422))[0]).toMatchObject({ path: "/field_translations/nope", code: "unknown_reference" });
    const e = errorsOf(fails(() => patch(1, { field_translations: { topic: { en: { option_labels: { bogus: "x" } } } } }), 422))[0];
    expect(e).toMatchObject({ path: "/field_translations/topic/en/option_labels/bogus", code: "not_in_enum" });
    expect(errorsOf(fails(() => patch(2, { field_translations: { email: { en: { placeholder: "x" } } } }), 422))[0]).toMatchObject({ path: "/field_translations/email/en/label", code: "required" });
  });

  it("an edit that changes nothing is a 200 with the same ETag", () => {
    const before = get(1);
    const r = patch(1, { name: "Contact form" });
    expect(r.etag).toBe(before.etag);
  });

  it("on a published form an edit goes to the draft: the live copy stays, the lifecycle says pending changes", () => {
    const r = patch(1, { name: "Contact us" });
    expect(r.data).toMatchObject({ status: "published", has_unpublished_changes: true, name: "Contact us" });
    expect(r.data.aggregate).toMatchObject({ entity_type: "forms.forms", lock_version: 2, has_unpublished_changes: true });
    expect(getMockDb().revisions["forms/1"].filter((x) => x.kind === "draft")).toHaveLength(1);
    expect(getMockDb().revisions["forms/1"].find((x) => x.kind === "published")!.snapshot).toMatchObject({ form: { name: "Contact form" } });
  });

  it("a translator can change the texts of any language (the default too) but not the settings; a reader nothing", () => {
    setFormsRole(getMockDb(), "translator");
    expect(patch(1, { translations: { la: { title: "Salut" } } }).data.translations.la.title).toBe("Salut");
    fails(() => patch(1, { name: "Other" }), 403);
    // the same value as now is no change at all
    expect(patch(1, { name: "Contact form" }).data.name).toBe("Contact form");
    setFormsRole(getMockDb(), "reader");
    fails(() => patch(1, { translations: { la: { title: "x" } } }), 403);
  });
});

describe("PUT /forms/{id}/recipients", () => {
  it("replaces the whole set with the recipients_etag as If-Match and does NOT move the form's ETag", () => {
    const before = get(2);
    const r = put(2, [TO, { email: "ops@materm.example", kind: "cc", topic_value: null, is_active: false }]);
    expect(r.data.recipients.map((x) => x.email)).toEqual(["hello@materm.example", "ops@materm.example"]);
    expect(r.data.recipients[0].id).toBeGreaterThan(0);
    expect(r.etag).toBe(r.data.recipients_etag);
    expect(r.etag).not.toBe(before.data.recipients_etag);
    const after = get(2);
    expect(after.etag).toBe(before.etag);
    expect(after.data.lock_version).toBe(before.data.lock_version);
    expect(after.data.recipient_count).toBe(1); // only the active one counts
  });

  it("428 without If-Match, 409 with a stale recipients_etag (also after someone else changed the set)", () => {
    fails(() => put(2, [TO], null), 428);
    fails(() => put(2, [TO], get(2).etag), 409, "CONFLICT_LOCK_VERSION"); // the FORM's ETag is not the recipients' one
    put(2, [TO]);
    fails(() => put(2, [TO], '"deadbeef00000000"'), 409);
  });

  it("validates the elements and the set: email, kind, topic, duplicates, 20 at most", () => {
    const e = errorsOf(fails(() => put(3, [{ email: "nope", kind: "to" }, { email: "a@b.example", kind: "x" }, { email: "a@b.example", topic_value: "zzz" }, { email: "ok@b.example", extra: 1 }]), 422));
    const byPath = Object.fromEntries(e.map((x) => [x.path, x]));
    expect(byPath["/recipients/0/email"].code).toBe("invalid_format");
    expect(byPath["/recipients/1/kind"].code).toBe("not_in_enum");
    expect(byPath["/recipients/2/topic_value"]).toMatchObject({ code: "not_in_enum", params: { expected: ["trek", "camp"] } });
    expect(byPath["/recipients/3/extra"].code).toBe("unknown_field");
    const dup = errorsOf(fails(() => put(3, [TO, { ...TO, email: "HELLO@materm.example" }]), 422));
    expect(dup[0]).toMatchObject({ path: "/recipients/1", code: "duplicate" });
    const many = Array.from({ length: 21 }, (_, i) => ({ email: `p${i}@materm.example`, kind: "to", topic_value: null, is_active: true }));
    expect(errorsOf(fails(() => put(3, many), 422))[0]).toMatchObject({ path: "/recipients", code: "limit_exceeded", params: { max: 20 } });
  });

  it("BR-34: a published form needs an active catch-all `to`; a draft one may be empty", () => {
    expect(errorsOf(fails(() => put(1, []), 422))[0]).toMatchObject({ path: "/recipients", code: "recipients_required" });
    expect(errorsOf(fails(() => put(1, [{ ...TO, topic_value: "booking" }]), 422))[0].code).toBe("recipients_required");
    expect(errorsOf(fails(() => put(1, [{ ...TO, is_active: false }]), 422))[0].code).toBe("recipients_required");
    expect(put(1, [TO]).data.recipients).toHaveLength(1);
    expect(put(2, []).data.recipients).toEqual([]);
  });

  it("the same set again is a 200 with the same validator", () => {
    const first = put(2, [TO]);
    expect(put(2, [TO]).etag).toBe(first.etag);
  });

  it("recipientsEtag does not depend on the order or the case of the address", () => {
    const a = { email: "A@x.example", kind: "to" as const, topic_value: null, is_active: true };
    const b = { email: "b@x.example", kind: "cc" as const, topic_value: null, is_active: true };
    expect(recipientsEtag([a, b])).toBe(recipientsEtag([b, { ...a, email: "a@x.example" }]));
  });

  it("only an editor may replace them", () => {
    setFormsRole(getMockDb(), "translator");
    fails(() => put(2, [TO]), 403);
  });
});

describe("publish engine (13.6.5)", () => {
  const publish = (id: number, params = "", body: unknown = undefined, ifMatch: string | null = get(id).etag) => publishForm(getMockDb(), String(id), q(params), body, ifMatch);

  it("a dry run lists the blockers with JSON pointers: default texts, field labels, option labels, recipients", () => {
    const e = fails(() => publish(2, "dry_run=true"), 422, "PUBLISH_BLOCKED");
    const paths = errorsOf(e).map((x) => x.path);
    expect(paths).toContain("/recipients");
    expect(errorsOf(e).every((x) => x.in === "entity")).toBe(true);
    // newsletter has Lao texts for everything; its only blocker is the missing recipient
    expect(paths).toEqual(["/recipients"]);
    // a blank title never gets into the draft: the save refuses it first
    expect(errorsOf(fails(() => patch(2, { translations: { la: { title: "  " } } }), 422))[0]).toMatchObject({ path: "/translations/la/title", code: "required" });
  });

  it("the contact form (published, no recipients) cannot be re-published until a catch-all exists", () => {
    patch(1, { name: "Contact us" });
    expect(errorsOf(fails(() => publish(1, "dry_run=true"), 422, "PUBLISH_BLOCKED")).map((x) => x.path)).toEqual(["/recipients"]);
    put(1, [TO]);
    const dry = publish(1, "dry_run=true");
    expect(dry.data).toMatchObject({ publishable: true });
    expect(dry.etag).toBeUndefined();
    expect((dry.data as { warnings: Array<{ code: string }> }).warnings).toEqual([]);
  });

  it("publishes a draft form, keeps first_published_at, and a second publish has nothing to publish", () => {
    put(2, [TO]);
    patch(2, { translations: { en: { title: "Stay in touch", submit_label: "Join" } }, field_translations: { email: { en: { label: "Email" } }, consent: { en: { label: "I agree" } } } });
    const done = publish(2, "", { change_note: "first" });
    expect(done.data).toMatchObject({ status: "published", has_unpublished_changes: false });
    expect((done.data as { published_revision: { version: number } }).published_revision.version).toBeGreaterThan(0);
    expect(done.etag).toBe(get(2).etag);
    expect(listFormRevisions(getMockDb(), "2", q()).data.find((r) => r.is_live)).toMatchObject({ kind: "published", change_note: "first" });
    fails(() => publish(2), 409, "INVALID_STATE");
  });

  it("warns (not blocks) about a language that is incomplete", () => {
    put(2, [TO]);
    const dry = publish(2, "dry_run=true");
    expect((dry.data as { warnings: Array<{ code: string; params: { locale: string } }> }).warnings[0]).toMatchObject({ code: "translation_incomplete", params: { locale: "en" } });
  });

  it("publishes the pending draft of a published form: the draft becomes the live copy", () => {
    const done = publish(3);
    expect(done.data).toMatchObject({ has_unpublished_changes: false, name: "Trek booking (2027 season)" });
    expect(getMockDb().revisions["forms/3"].some((r) => r.kind === "draft")).toBe(false);
  });

  it("unpublish is blocked by the contact page that shows the form (ENTITY_REFERENCED) until confirm_references=true", () => {
    const e = fails(() => unpublishForm(getMockDb(), "1", q(), get(1).etag), 409, "ENTITY_REFERENCED");
    expect((e.body.details as { references: Array<{ entity_type: string; kind: string }> }).references[0]).toMatchObject({ entity_type: "cms.pages", kind: "section_props" });
    const done = unpublishForm(getMockDb(), "1", q("confirm_references=true"), get(1).etag);
    expect(done.data).toMatchObject({ status: "archived" });
    expect(done.data.warnings.map((w) => w.code)).toContain("form_referenced");
    fails(() => unpublishForm(getMockDb(), "1", q(), get(1).etag), 409, "INVALID_STATE");
  });

  it("unpublish keeps a pending draft as history; a form nobody links to needs no confirmation", () => {
    const done = unpublishForm(getMockDb(), "3", q(), get(3).etag);
    expect(done.data.warnings.map((w) => w.code)).toEqual(["draft_kept_as_history"]);
    expect(done.data.has_unpublished_changes).toBe(false);
  });

  it("discard turns the draft into a history row; no draft is a 409", () => {
    const r = discardFormDraft(getMockDb(), "3", get(3).etag);
    expect(r.data).toMatchObject({ has_unpublished_changes: false, name: "Trek booking" });
    fails(() => discardFormDraft(getMockDb(), "3", get(3).etag), 409, "INVALID_STATE");
  });

  it("only an editor publishes", () => {
    setFormsRole(getMockDb(), "translator");
    fails(() => publish(3), 403);
  });
});

describe("revisions", () => {
  it("lists draft / published / history rows, marks the live one, and restores as the working draft", () => {
    const list = listFormRevisions(getMockDb(), "3", q());
    expect(list.data.map((r) => r.kind).sort()).toEqual(["draft", "history", "published"]);
    expect(list.data.find((r) => r.is_live)!.kind).toBe("published");
    const history = list.data.find((r) => r.kind === "history")!;
    const restored = restoreFormRevision(getMockDb(), "3", String(history.id), {}, get(3).etag);
    expect(restored.data).toMatchObject({ has_unpublished_changes: true, restored_from: { revision_id: history.id } });
    expect(getFormRevision(getMockDb(), "3", String(history.id)).entity).toMatchObject({ type: "forms.forms", id: 3 });
  });

  it("refuses a snapshot written by a newer schema", () => {
    const future = listFormRevisions(getMockDb(), "1", q()).data.find((r) => r.schema_version > 1)!;
    fails(() => restoreFormRevision(getMockDb(), "1", String(future.id), {}, get(1).etag), 409, "INVALID_STATE");
  });
});
