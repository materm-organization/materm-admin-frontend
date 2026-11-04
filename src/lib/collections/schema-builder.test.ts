import { describe, expect, it } from "vitest";

import { ALLOWED_SCHEMA_KEYWORDS, MAX_ARRAY_ITEMS, MAX_PROPERTIES } from "./constants";
import { checkEntryData } from "./data-check";
import { checkCollectionSchema } from "./schema-check";
import { builderSchemaIssues, fieldProblems, generateSchemas, newField, parseSchemas, titleFieldOptions, withFieldKind, type BuilderField } from "./schema-builder";

const f = (partial: Partial<BuilderField>) => newField(partial);

// One field of every kind (the common cases of the builder), shared and localized.
function everyKind(): BuilderField[] {
  return [
    f({ name: "title_en", fieldKind: "string", kind: "string", label: "Short", maxLength: 80, minLength: 1, pattern: "^[A-Z]", required: true }),
    f({ name: "about", fieldKind: "text", kind: "text", maxLength: 2000, localized: true }),
    f({ name: "body", fieldKind: "richtext", localized: true, required: true, label: "Body" }),
    f({ name: "price", fieldKind: "number", kind: "number", minimum: 0, maximum: 99.5 }),
    f({ name: "year", fieldKind: "integer", kind: "integer", minimum: 1990, maximum: 2100, required: true }),
    f({ name: "active", fieldKind: "boolean", kind: "boolean" }),
    f({ name: "born", fieldKind: "date", kind: "date" }),
    f({ name: "starts", fieldKind: "datetime", kind: "datetime" }),
    f({ name: "level", fieldKind: "enum", kind: "enum", options: ["a", "b", "c"], localized: true }),
    f({ name: "photo", fieldKind: "media", kind: "media", required: true }),
    f({ name: "tags", fieldKind: "array", item: { kind: "string", maxLength: 30, options: [] }, minItems: 1, maxItems: 10, uniqueItems: true }),
    f({ name: "gallery", fieldKind: "array", item: { kind: "media", options: [] }, maxItems: 12 }),
    f({ name: "marks", fieldKind: "array", item: { kind: "enum", options: ["x", "y"] }, maxItems: 5, localized: true }),
  ];
}

describe("generateSchemas", () => {
  const g = generateSchemas(everyKind());
  it("splits shared and localized fields and keeps the order in ui:order", () => {
    expect(Object.keys(g.json_schema.properties!).sort()).toEqual(["active", "born", "gallery", "photo", "price", "starts", "tags", "title_en", "year"]);
    expect(Object.keys(g.localized_schema.properties!).sort()).toEqual(["about", "body", "level", "marks"]);
    expect(g.ui_schema["ui:order"]).toEqual(everyKind().map((x) => x.name));
    expect(g.json_schema.required).toEqual(["title_en", "year", "photo"]);
    expect(g.localized_schema.required).toEqual(["body"]);
  });
  it("only emits allowed keywords, objects with additionalProperties:false, arrays with items and maxItems", () => {
    const allowed = new Set(ALLOWED_SCHEMA_KEYWORDS);
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) return;
      const n = node as Record<string, unknown>;
      for (const k of Object.keys(n)) {
        if (k !== "properties") expect(allowed.has(k), `${path}/${k}`).toBe(true);
      }
      if (n.type === "object" && !("x-richtext" in n)) {
        expect(n.additionalProperties, path).toBe(false);
        expect(n.properties, path).toBeDefined();
      }
      if (n.type === "array") {
        expect(n.items, path).toBeDefined();
        expect(n.maxItems as number, path).toBeLessThanOrEqual(MAX_ARRAY_ITEMS);
      }
      for (const [k, v] of Object.entries((n.properties ?? {}) as object)) walk(v, `${path}/properties/${k}`);
      walk(n.items, `${path}/items`);
    };
    walk(g.json_schema, "");
    walk(g.localized_schema, "");
    expect(JSON.stringify(g)).not.toMatch(/x-localized|\$ref|\$defs/);
  });
  it("passes the mirror of the server's schema check", () => {
    expect(checkCollectionSchema(g.json_schema)).toEqual([]);
    expect(checkCollectionSchema(g.localized_schema)).toEqual([]);
    expect(builderSchemaIssues(everyKind())).toEqual([]);
  });
  it("declares media as an object whose only member is an integer media_id", () => {
    expect(g.json_schema.properties!.photo).toMatchObject({ type: "object", properties: { media_id: { type: "integer" } }, additionalProperties: false, required: ["media_id"] });
    expect(g.ui_schema.photo).toEqual({ "ui:widget": "media-picker" });
    expect(g.ui_schema.born).toEqual({ "ui:widget": "date" });
    expect(g.ui_schema.starts).toEqual({ "ui:widget": "date-time" });
  });
  it("an empty builder is the minimal valid pair", () => {
    const e = generateSchemas([]);
    expect(e.json_schema).toEqual({ type: "object", properties: {}, additionalProperties: false });
    expect(e.ui_schema).toEqual({});
    expect(checkCollectionSchema(e.json_schema)).toEqual([]);
  });
});

describe("round trip", () => {
  it("generate -> parse -> generate gives the same three documents", () => {
    const g = generateSchemas(everyKind());
    // jsonb does not keep key order: shuffle the keys of `properties` like the database would
    const shuffled = JSON.parse(JSON.stringify(g)) as typeof g;
    shuffled.json_schema.properties = Object.fromEntries(Object.entries(shuffled.json_schema.properties!).sort(([a], [b]) => a.length - b.length || a.localeCompare(b)));
    const parsed = parseSchemas(shuffled);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.fields.map((x) => x.name)).toEqual(everyKind().map((x) => x.name));
    expect(generateSchemas(parsed.fields)).toEqual(g);
    const strip = (list: BuilderField[]) => list.map((x) => ({ ...x, id: "" }));
    expect(strip(parsed.fields)).toEqual(strip(everyKind()));
  });
  it("locks a schema the builder can not represent, naming the place, and never drops anything", () => {
    const g = generateSchemas([f({ name: "a" })]);
    const withCombinator = structuredClone(g);
    (withCombinator.json_schema.properties!.a as Record<string, unknown>).anyOf = [{ type: "string" }];
    const r = parseSchemas(withCombinator);
    expect(r).toMatchObject({ ok: false, schema: "json_schema" });
    const nested = structuredClone(g);
    nested.json_schema.properties!.n = { type: "object", properties: { x: { type: "string" } }, additionalProperties: false };
    expect(parseSchemas(nested)).toMatchObject({ ok: false, reason: "unsupported" });
    const custom = structuredClone(g);
    custom.ui_schema.a = { "ui:widget": "textarea" };
    expect(parseSchemas(custom)).toMatchObject({ ok: false, schema: "ui_schema" });
    // a field typed into the JSON without a ui:order entry still opens in the builder (the order list is a hint, not content)
    const typed = structuredClone(g);
    typed.json_schema.properties!.b = { type: "string" };
    const reopened = parseSchemas(typed);
    expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(reopened.fields.map((x) => x.name)).toEqual(["a", "b"]);
    const dup = generateSchemas([f({ name: "a" })]);
    dup.localized_schema.properties = { a: { type: "string" } };
    expect(parseSchemas(dup)).toMatchObject({ ok: false, reason: "duplicate_name" });
    expect(parseSchemas({ json_schema: null, localized_schema: {}, ui_schema: {} })).toMatchObject({ ok: false, reason: "shape" });
  });
});

describe("fieldProblems", () => {
  const codes = (fields: BuilderField[]) => Object.values(fieldProblems(fields)).flat().map((p) => p.code);
  it("names, reserved names (any case), duplicates", () => {
    expect(codes([f({ name: "" })])).toContain("name_required");
    expect(codes([f({ name: "Bad-Name" })])).toContain("name_pattern");
    expect(codes([f({ name: "1abc" })])).toContain("name_pattern");
    for (const n of ["constructor", "prototype", "valueof", "tostring", "hasownproperty"]) expect(codes([f({ name: n })])).toContain("name_reserved");
    expect(codes([f({ name: "a" }), f({ name: "a", localized: true })])).toContain("name_duplicate");
    expect(codes([f({ name: "a".repeat(41) })])).toContain("name_pattern");
  });
  it("media_id must be an integer", () => {
    expect(codes([f({ name: "media_id", fieldKind: "string" })])).toContain("media_id_type");
    expect(codes([f({ name: "media_id", fieldKind: "integer", kind: "integer" })])).not.toContain("media_id_type");
  });
  it("enum, ranges, patterns and array sizes", () => {
    expect(codes([f({ name: "e", fieldKind: "enum", kind: "enum", options: [] })])).toContain("enum_empty");
    expect(codes([f({ name: "e", fieldKind: "enum", kind: "enum", options: ["a", "a"] })])).toContain("enum_duplicate");
    expect(codes([f({ name: "e", fieldKind: "enum", kind: "enum", options: Array.from({ length: 201 }, (_, i) => `o${i}`) })])).toContain("enum_too_many");
    expect(codes([f({ name: "s", minLength: 5, maxLength: 2 })])).toContain("length_range");
    expect(codes([f({ name: "n", fieldKind: "number", kind: "number", minimum: 9, maximum: 1 })])).toContain("number_range");
    expect(codes([f({ name: "s", pattern: "(" })])).toContain("pattern_invalid");
    expect(codes([f({ name: "s", pattern: "x".repeat(257), maxLength: 10 })])).toContain("pattern_length");
    expect(codes([f({ name: "s", pattern: "^a" })])).toContain("pattern_needs_max");
    expect(codes([f({ name: "s", pattern: "^a", maxLength: 10001 })])).toContain("pattern_max_too_long");
    expect(codes([f({ name: "s", pattern: "a{101}", maxLength: 500 })])).toContain("pattern_repeat");
    expect(codes([f({ name: "s", pattern: "^a{1,100}$", maxLength: 500 })])).not.toContain("pattern_repeat");
    expect(codes([f({ name: "l", fieldKind: "array", maxItems: 501 })])).toContain("max_items");
    expect(codes([f({ name: "l", fieldKind: "array", maxItems: 5, minItems: 6 })])).toContain("min_items");
  });
  it("more than 60 fields in one document", () => {
    const many = Array.from({ length: MAX_PROPERTIES + 1 }, (_, i) => f({ name: `f${i}` }));
    expect(codes(many)).toContain("too_many_fields");
    expect(builderSchemaIssues(many).map((i) => i.code)).toContain("limit_exceeded");
  });
});

describe("checkCollectionSchema (the mirror of the server)", () => {
  const root = (props: object) => ({ type: "object", additionalProperties: false, properties: props });
  it("rejects what the server rejects", () => {
    const codes = (s: unknown) => checkCollectionSchema(s).map((i) => `${i.path} ${i.code}`);
    expect(codes(root({ a: { $ref: "#/x" } }))).toContain("/properties/a/$ref unsupported_keyword");
    expect(codes(root({ a: { type: "string", "x-localized": true } }))).toContain("/properties/a/x-localized unsupported_keyword");
    expect(codes({ type: "object", properties: {} })).toContain("/additionalProperties missing_keyword");
    expect(codes(root({ a: { type: "array", items: { type: "string" } } }))).toContain("/properties/a/maxItems missing_keyword");
    expect(codes(root({ a: { type: "array", items: { type: "string" }, maxItems: 501 } }))).toContain("/properties/a/maxItems limit_exceeded");
    expect(codes(root({ Bad: { type: "string" } }))).toContain("/properties/Bad invalid_schema");
    expect(codes(root({ valueof: { type: "string" } }))).toContain("/properties/valueof reserved_name");
    expect(codes(root({ media_id: { type: "string" } }))).toContain("/properties/media_id/type invalid_schema");
    expect(codes(root({ a: { type: "string", format: "email" } }))).toContain("/properties/a/format invalid_schema");
    expect(codes({ type: "array" })).toContain("/type invalid_schema");
    expect(codes(root({ a: { type: "object", "x-richtext": "full" } }))).toContain("/properties/a/x-richtext invalid_schema");
    expect(codes(root({ a: { type: "string", enum: Array.from({ length: 201 }, (_, i) => String(i)) } }))).toContain("/properties/a/enum limit_exceeded");
    expect(codes(root({ a: { type: "string", pattern: "x".repeat(257) } }))).toContain("/properties/a/pattern limit_exceeded");
    // backend 0c541f6: a pattern needs a bounded maxLength and bounded repeats
    expect(codes(root({ a: { type: "string", pattern: "^a$" } }))).toContain("/properties/a/maxLength missing_keyword");
    expect(codes(root({ a: { type: "string", pattern: "^a$", maxLength: 10001 } }))).toContain("/properties/a/maxLength limit_exceeded");
    expect(codes(root({ a: { type: "string", pattern: "a{200}", maxLength: 50 } }))).toContain("/properties/a/pattern limit_exceeded");
    expect(codes(root({ a: { type: "string", pattern: "^a$", maxLength: 50 } }))).toEqual([]);
  });
  it("depth, node and size limits", () => {
    let deep: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < 9; i++) deep = { type: "object", additionalProperties: false, properties: { n: deep } };
    expect(checkCollectionSchema(deep).map((i) => i.code)).toContain("limit_exceeded");
    const wide = root(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`p${i}`, { type: "object", additionalProperties: false, properties: { a: { type: "string" }, b: { type: "string" }, c: { type: "string" }, d: { type: "string" }, e: { type: "string" }, f: { type: "string" }, g: { type: "string" } } }])));
    expect(checkCollectionSchema(wide).some((i) => i.params?.limit === "nodes")).toBe(true);
    expect(checkCollectionSchema(root({ a: { type: "string", description: "x".repeat(70_000) } }))[0].params).toMatchObject({ limit: "schema_bytes" });
  });
});

describe("titleFieldOptions", () => {
  it("offers title and the plain text fields", () => {
    expect(titleFieldOptions(everyKind())).toEqual(["title", "title_en", "about"]);
  });
});

describe("withFieldKind", () => {
  it("clears the limits that no longer apply", () => {
    const next = withFieldKind(f({ name: "a", maxLength: 10, pattern: "x" }), "integer");
    expect(next).toMatchObject({ fieldKind: "integer", kind: "integer", maxLength: undefined, pattern: undefined });
  });
});

describe("checkEntryData (the conservative checker, no Ajv)", () => {
  const g = generateSchemas(everyKind());
  const codes = (v: unknown, mode: "draft" | "publish" = "draft") => checkEntryData(g.json_schema, v, mode).map((i) => `${i.path} ${i.code}`);
  it("reports definite failures with the server's codes and paths", () => {
    expect(codes({ year: "x" })).toContain("/year invalid_type");
    expect(codes({ year: 1800 })).toContain("/year out_of_range");
    expect(codes({ year: 1.5 })).toContain("/year invalid_type");
    expect(codes({ title_en: "abc" })).toContain("/title_en pattern_mismatch");
    expect(codes({ born: "2026-02-30" })).toContain("/born invalid_format");
    expect(codes({ starts: "2026-02-01" })).toContain("/starts invalid_format");
    expect(codes({ starts: "2026-02-01T10:00:00+07:00" })).toEqual([]);
    expect(codes({ tags: ["a", "a"] })).toContain("/tags duplicate");
    expect(codes({ tags: Array.from({ length: 11 }, (_, i) => String(i)) })).toContain("/tags too_long");
    expect(codes({ nope: 1 })).toContain("/nope unknown_field");
    expect(codes({ photo: { media_id: "7" } })).toContain("/photo/media_id invalid_type");
  });
  it("required, minLength and minItems only count in publish mode", () => {
    expect(codes({})).toEqual([]);
    expect(codes({}, "publish")).toEqual(expect.arrayContaining(["/title_en required", "/year required", "/photo required"]));
    expect(codes({ title_en: "" }, "draft")).not.toContain("/title_en too_short");
    expect(codes({ title_en: "", year: 2000, photo: { media_id: 1 } }, "publish")).toContain("/title_en too_short");
  });
  it("skips combinators and an uncompilable pattern instead of guessing", () => {
    expect(checkEntryData({ type: "object", anyOf: [{ required: ["a"] }] }, {}, "publish")).toEqual([]);
    expect(checkEntryData({ type: "string", pattern: "(?i)abc" }, "zzz")).toEqual([]);
    expect(checkEntryData({ type: "string", pattern: "(" }, "zzz")).toEqual([]);
  });
});
