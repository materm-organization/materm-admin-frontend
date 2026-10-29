import { describe, expect, it } from "vitest";

import { hasProblems, newRow, rowsEqual, rowsFromRecipients, toPayload, validateRows } from "@/components/protected/forms/recipients-draft";

const TO = { id: 1, email: "hello@materm.example", kind: "to" as const, topic_value: null, is_active: true };

describe("recipients draft", () => {
  it("starts from the server's rows and is not dirty until something differs; ids and case of nothing matter", () => {
    const base = rowsFromRecipients([TO]);
    expect(rowsEqual(base, rowsFromRecipients([{ ...TO, id: 9 }]))).toBe(true);
    expect(rowsEqual(base, [{ ...base[0], email: "  hello@materm.example " }])).toBe(true);
    expect(rowsEqual(base, [{ ...base[0], is_active: false }])).toBe(false);
  });

  it("flags empty, malformed, too long and duplicate addresses (same address, type and topic)", () => {
    const a = newRow({ email: "" });
    const b = newRow({ email: "nope" });
    const c = newRow({ email: `${"x".repeat(250)}@a.example` });
    const d = newRow({ email: "dup@materm.example" });
    const e = newRow({ email: "DUP@materm.example" });
    const f = newRow({ email: "dup@materm.example", kind: "cc" });
    const p = validateRows([a, b, c, d, e, f], false);
    expect(p.rows).toEqual({ [a.id]: "required", [b.id]: "invalid_format", [c.id]: "too_long", [e.id]: "duplicate" });
    expect(hasProblems(p)).toBe(true);
  });

  it("BR-34: a published form (or one that does not keep messages) needs an active To for all topics", () => {
    const topicOnly = newRow({ email: "a@materm.example", topic_value: "events" });
    expect(validateRows([topicOnly], true).noCatchAll).toBe(true);
    expect(validateRows([topicOnly], false).noCatchAll).toBe(false);
    expect(validateRows([newRow({ email: "a@materm.example", is_active: false })], true).noCatchAll).toBe(true);
    expect(validateRows([newRow({ email: "a@materm.example", kind: "cc" })], true).noCatchAll).toBe(true);
    expect(validateRows([newRow({ email: "a@materm.example" })], true).noCatchAll).toBe(false);
    expect(hasProblems(validateRows([], true))).toBe(true);
  });

  it("more than 20 rows is too many; the payload is trimmed and carries no ids", () => {
    const rows = Array.from({ length: 21 }, (_, i) => newRow({ email: `p${i}@materm.example` }));
    expect(validateRows(rows, false).tooMany).toBe(true);
    expect(toPayload([newRow({ email: " a@materm.example ", kind: "bcc", topic_value: "events", is_active: false })])).toEqual([{ email: "a@materm.example", kind: "bcc", topic_value: "events", is_active: false }]);
  });
});
