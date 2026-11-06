import type { JsonSchema, UiSchemaNode } from "@/types/cms";

import {
  MAX_ARRAY_ITEMS,
  MAX_ENUM_VALUES,
  MAX_PATTERNED_LENGTH,
  MAX_PATTERN_LENGTH,
  MAX_PATTERN_REPEAT,
  MAX_PROPERTIES,
  PROPERTY_NAME_RE,
  isReservedPropertyName,
} from "./constants";
import { checkCollectionSchema, type SchemaIssue } from "./schema-check";

// The guided field builder of the collection schema editor (SCR-40). A flat, ordered list of fields (`BuilderField`) is turned into the
// THREE documents the API stores: `json_schema` (the shared `data`), `localized_schema` (the `data` of each language) and `ui_schema`.
//
//   - Only the allowed keyword subset of doc/05 17.4 is generated (`schema-check.ts` / `ALLOWED_SCHEMA_KEYWORDS`): no `$ref`, no `x-localized`,
//     every object has `properties` + `additionalProperties: false`, every array has `items` + `maxItems`.
//   - The order of the fields lives in `ui_schema["ui:order"]` (the database stores the schemas as jsonb, which does not keep key order).
//   - `parseSchemas` is the exact inverse: it reads the three documents back into fields, REGENERATES them and compares. A schema that does
//     not survive that round trip (a combinator, a nested object, a keyword the builder does not know, a hand-made `ui_schema`) is "locked":
//     the builder is not offered, the Advanced JSON tab is. Nothing is ever dropped silently.

export const SCALAR_KINDS = ["string", "text", "number", "integer", "boolean", "date", "datetime", "enum", "media"] as const;
export type ScalarKind = (typeof SCALAR_KINDS)[number];
export const FIELD_KINDS = [...SCALAR_KINDS, "richtext", "array"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];
export const ITEM_KINDS = SCALAR_KINDS;

// The limits a scalar can carry (a field has its own copy; an array's item has one).
export type ScalarSpec = {
  kind: ScalarKind;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  options: string[];
};

export type BuilderField = ScalarSpec & {
  // React key only; never sent.
  id: string;
  // Property name (`^[a-z][a-z0-9_]{0,39}$`).
  name: string;
  fieldKind: FieldKind;
  label: string;
  description: string;
  required: boolean;
  // true: in `localized_schema` (one value per language); false: in `json_schema` (shared by every language).
  localized: boolean;
  // fieldKind === "array"
  item: ScalarSpec;
  minItems?: number;
  maxItems: number;
  uniqueItems: boolean;
};

export type GeneratedSchemas = { json_schema: JsonSchema; localized_schema: JsonSchema; ui_schema: UiSchemaNode };

export const DEFAULT_MAX_ITEMS = 20;

let counter = 0;
export const newFieldId = () => `f${(counter += 1)}`;

const emptySpec = (kind: ScalarKind): ScalarSpec => ({ kind, options: [] });

export function newField(partial: Partial<BuilderField> = {}): BuilderField {
  return {
    id: newFieldId(),
    name: "",
    fieldKind: "string",
    kind: "string",
    label: "",
    description: "",
    required: false,
    localized: false,
    options: [],
    item: emptySpec("string"),
    maxItems: DEFAULT_MAX_ITEMS,
    uniqueItems: false,
    ...partial,
  };
}

// Changing the kind of a field keeps the name, label, flags and clears limits that do not apply to the new kind.
export function withFieldKind(field: BuilderField, fieldKind: FieldKind): BuilderField {
  const kind: ScalarKind = fieldKind === "array" || fieldKind === "richtext" ? field.kind : (fieldKind as ScalarKind);
  return {
    ...field,
    fieldKind,
    kind,
    minLength: undefined,
    maxLength: undefined,
    pattern: undefined,
    minimum: undefined,
    maximum: undefined,
    options: fieldKind === "enum" ? field.options : [],
    item: fieldKind === "array" ? field.item : emptySpec("string"),
  };
}

// ---- generation -------------------------------------------------------------------------------------------------------------------

const set = <T extends object>(target: T, key: string, value: unknown) => {
  if (value !== undefined && value !== null && value !== "") (target as Record<string, unknown>)[key] = value;
};

function scalarSchema(spec: ScalarSpec, withPattern: boolean, mediaRequired: boolean): JsonSchema {
  switch (spec.kind) {
    case "string":
    case "text": {
      const s: JsonSchema = { type: "string" };
      if (spec.kind === "text") s["x-multiline"] = true;
      set(s, "minLength", spec.minLength);
      set(s, "maxLength", spec.maxLength);
      if (withPattern) set(s, "pattern", spec.pattern);
      return s;
    }
    case "number":
    case "integer": {
      const s: JsonSchema = { type: spec.kind };
      set(s, "minimum", spec.minimum);
      set(s, "maximum", spec.maximum);
      return s;
    }
    case "boolean":
      return { type: "boolean" };
    case "date":
      return { type: "string", format: "date" };
    case "datetime":
      return { type: "string", format: "date-time" };
    case "enum":
      return { type: "string", enum: [...spec.options] };
    case "media": {
      // Only a property literally named `media_id` is tracked by the database (where-used, the media must exist): it is declared an integer.
      const s: JsonSchema = { type: "object", properties: { media_id: { type: "integer" } }, additionalProperties: false };
      if (mediaRequired) s.required = ["media_id"];
      return s;
    }
  }
}

function uiOfSpec(spec: ScalarSpec): UiSchemaNode | undefined {
  if (spec.kind === "date") return { "ui:widget": "date" };
  if (spec.kind === "datetime") return { "ui:widget": "date-time" };
  if (spec.kind === "media") return { "ui:widget": "media-picker" };
  return undefined;
}

function fieldSchema(f: BuilderField): JsonSchema {
  let s: JsonSchema;
  if (f.fieldKind === "richtext") s = { type: "object", "x-richtext": "lite" };
  else if (f.fieldKind === "array") {
    s = { type: "array", items: scalarSchema(f.item, true, true), maxItems: f.maxItems };
    set(s, "minItems", f.minItems);
    if (f.uniqueItems) s.uniqueItems = true;
  } else s = scalarSchema(f, true, f.required);
  set(s, "title", f.label.trim());
  set(s, "description", f.description.trim());
  return s;
}

function fieldUi(f: BuilderField): UiSchemaNode | undefined {
  if (f.fieldKind === "array") {
    const item = uiOfSpec(f.item);
    return item ? { items: item } : undefined;
  }
  if (f.fieldKind === "richtext") return undefined;
  return uiOfSpec(f);
}

const emptyObject = (): JsonSchema => ({ type: "object", properties: {}, additionalProperties: false });

export function generateSchemas(fields: BuilderField[]): GeneratedSchemas {
  const json = emptyObject();
  const localized = emptyObject();
  const ui: UiSchemaNode = {};
  const order: string[] = [];
  for (const f of fields) {
    const target = f.localized ? localized : json;
    Object.defineProperty(target.properties, f.name, { value: fieldSchema(f), enumerable: true, writable: true, configurable: true });
    if (f.required) (target.required ??= []).push(f.name);
    const u = fieldUi(f);
    if (u) ui[f.name] = u;
    order.push(f.name);
  }
  if (order.length > 0) ui["ui:order"] = order;
  return { json_schema: json, localized_schema: localized, ui_schema: ui };
}

// ---- parsing (the inverse) --------------------------------------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function parseScalar(s: unknown): ScalarSpec | null {
  if (!isObject(s)) return null;
  const type = s.type;
  if (type === "string") {
    if (s.format === "date") return emptySpec("date");
    if (s.format === "date-time") return emptySpec("datetime");
    if (Array.isArray(s.enum)) {
      return s.enum.every((e) => typeof e === "string") ? { kind: "enum", options: s.enum as string[] } : null;
    }
    return {
      kind: s["x-multiline"] === true ? "text" : "string",
      minLength: num(s.minLength),
      maxLength: num(s.maxLength),
      pattern: typeof s.pattern === "string" ? s.pattern : undefined,
      options: [],
    };
  }
  if (type === "number" || type === "integer") return { kind: type, minimum: num(s.minimum), maximum: num(s.maximum), options: [] };
  if (type === "boolean") return emptySpec("boolean");
  if (type === "object" && isObject(s.properties) && "media_id" in s.properties) return emptySpec("media");
  return null;
}

function parseProperty(name: string, s: unknown, required: boolean, localized: boolean): BuilderField | null {
  if (!isObject(s)) return null;
  const base = {
    name,
    label: typeof s.title === "string" ? s.title : "",
    description: typeof s.description === "string" ? s.description : "",
    required,
    localized,
  };
  if (s["x-richtext"] === "lite" && s.type === "object") return newField({ ...base, fieldKind: "richtext", kind: "string" });
  if (s.type === "array") {
    const item = parseScalar(s.items);
    if (!item) return null;
    return newField({
      ...base,
      fieldKind: "array",
      kind: "string",
      item,
      minItems: num(s.minItems),
      maxItems: num(s.maxItems) ?? DEFAULT_MAX_ITEMS,
      uniqueItems: s.uniqueItems === true,
    });
  }
  const spec = parseScalar(s);
  if (!spec) return null;
  return newField({ ...base, ...spec, fieldKind: spec.kind });
}

// Canonical text of a JSON value: object keys sorted, arrays in order (their order is meaningful: `required`, `enum`, `ui:order`).
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

// JSON Pointer of the first place where two JSON values differ ("" = at the root, or the shapes differ there).
export function firstDifference(a: unknown, b: unknown, path = ""): string | null {
  if (canonicalJson(a) === canonicalJson(b)) return null;
  if (isObject(a) && isObject(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const d = firstDifference(a[k], b[k], `${path}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`);
      if (d !== null) return d;
    }
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = firstDifference(a[i], b[i], `${path}/${i}`);
      if (d !== null) return d;
    }
  }
  return path;
}

export type ParseResult =
  | { ok: true; fields: BuilderField[] }
  // `schema`: which document, `path`: where the builder gave up (a JSON Pointer inside it).
  | { ok: false; reason: "shape" | "unsupported" | "duplicate_name"; schema: keyof GeneratedSchemas; path: string };

export function parseSchemas(input: { json_schema: unknown; localized_schema: unknown; ui_schema: unknown }): ParseResult {
  const ui = isObject(input.ui_schema) ? input.ui_schema : {};
  const order = Array.isArray(ui["ui:order"]) ? (ui["ui:order"] as unknown[]).filter((n): n is string => typeof n === "string") : [];
  const fields: BuilderField[] = [];
  const seen = new Set<string>();
  for (const [key, localized] of [["json_schema", false], ["localized_schema", true]] as const) {
    const schema = input[key];
    if (!isObject(schema) || !isObject(schema.properties)) return { ok: false, reason: "shape", schema: key, path: "" };
    const required = new Set(Array.isArray(schema.required) ? (schema.required as unknown[]) : []);
    for (const name of Object.keys(schema.properties)) {
      const f = parseProperty(name, schema.properties[name], required.has(name), localized);
      if (!f) return { ok: false, reason: "unsupported", schema: key, path: `/properties/${name}` };
      if (seen.has(name)) return { ok: false, reason: "duplicate_name", schema: key, path: `/properties/${name}` };
      seen.add(name);
      fields.push(f);
    }
  }
  const rank = (name: string) => {
    const i = order.indexOf(name);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  fields.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  const again = generateSchemas(fields);
  // `ui:order` is only the order of the fields: a list that misses a field (typed in by hand in the JSON) or names one that is gone is not custom
  // content, so it does not lock the builder (the next save writes the full order). Everything else in `ui_schema` must round-trip.
  const withoutOrder = (ui: unknown) => (isObject(ui) ? Object.fromEntries(Object.entries(ui).filter(([k]) => k !== "ui:order")) : ui);
  for (const key of ["json_schema", "localized_schema", "ui_schema"] as const) {
    const where = key === "ui_schema" ? firstDifference(withoutOrder(input[key]), withoutOrder(again[key])) : firstDifference(input[key], again[key]);
    if (where !== null) return { ok: false, reason: "unsupported", schema: key, path: where };
  }
  return { ok: true, fields };
}

// ---- problems the builder can see before saving --------------------------------------------------------------------------------------

export type FieldProblem = { code: string; params?: Record<string, string | number> };

// Per field (by `id`): what is wrong with the field itself. The aggregate limits (nodes, depth, bytes, 60 properties) come from
// `checkCollectionSchema` of the generated documents (`builderSchemaIssues`).
export function fieldProblems(fields: BuilderField[]): Record<string, FieldProblem[]> {
  const out: Record<string, FieldProblem[]> = {};
  const add = (id: string, p: FieldProblem) => (out[id] ??= []).push(p);
  const names = new Map<string, number>();
  for (const f of fields) names.set(f.name, (names.get(f.name) ?? 0) + 1);
  for (const f of fields) {
    if (f.name === "") add(f.id, { code: "name_required" });
    else if (!PROPERTY_NAME_RE.test(f.name)) add(f.id, { code: "name_pattern" });
    else if (isReservedPropertyName(f.name)) add(f.id, { code: "name_reserved" });
    else if ((names.get(f.name) ?? 0) > 1) add(f.id, { code: "name_duplicate" });
    if (f.name === "media_id" && f.fieldKind !== "integer") add(f.id, { code: "media_id_type" });
    const spec: ScalarSpec | null = f.fieldKind === "array" ? f.item : f.fieldKind === "richtext" ? null : f;
    if (spec) {
      if (spec.kind === "enum") {
        const options = spec.options;
        if (options.length === 0) add(f.id, { code: "enum_empty" });
        if (options.some((o) => o.trim() === "")) add(f.id, { code: "enum_blank" });
        if (new Set(options).size !== options.length) add(f.id, { code: "enum_duplicate" });
        if (options.length > MAX_ENUM_VALUES) add(f.id, { code: "enum_too_many", params: { max: MAX_ENUM_VALUES } });
      }
      if (spec.minLength !== undefined && spec.maxLength !== undefined && spec.minLength > spec.maxLength) add(f.id, { code: "length_range" });
      if (spec.minLength !== undefined && (spec.minLength < 0 || !Number.isInteger(spec.minLength))) add(f.id, { code: "length_invalid" });
      if (spec.maxLength !== undefined && (spec.maxLength < 1 || !Number.isInteger(spec.maxLength))) add(f.id, { code: "length_invalid" });
      if (spec.minimum !== undefined && spec.maximum !== undefined && spec.minimum > spec.maximum) add(f.id, { code: "number_range" });
      if (spec.kind === "integer" && [spec.minimum, spec.maximum].some((n) => n !== undefined && !Number.isInteger(n))) add(f.id, { code: "integer_bounds" });
      if (spec.pattern !== undefined && spec.pattern.length > MAX_PATTERN_LENGTH) add(f.id, { code: "pattern_length", params: { max: MAX_PATTERN_LENGTH } });
      if (spec.pattern) {
        // 0c541f6: a pattern needs a maxLength (<= 10000) on its field and counted repeats of at most 100
        if (spec.maxLength === undefined) add(f.id, { code: "pattern_needs_max" });
        else if (spec.maxLength > MAX_PATTERNED_LENGTH) add(f.id, { code: "pattern_max_too_long", params: { max: MAX_PATTERNED_LENGTH } });
        for (const m of spec.pattern.matchAll(/\{(\d+)(?:,(\d*))?\}/g)) {
          if (Math.max(Number(m[1]), Number(m[2] || 0)) > MAX_PATTERN_REPEAT) add(f.id, { code: "pattern_repeat", params: { max: MAX_PATTERN_REPEAT } });
        }
        // No JavaScript compile check: the server validates RE2, whose syntax JavaScript refuses in places ((?i), (?P<n>x), \z).
      }
    }
    if (f.fieldKind === "array") {
      if (!Number.isInteger(f.maxItems) || f.maxItems < 1 || f.maxItems > MAX_ARRAY_ITEMS) add(f.id, { code: "max_items", params: { max: MAX_ARRAY_ITEMS } });
      if (f.minItems !== undefined && (f.minItems < 0 || !Number.isInteger(f.minItems) || f.minItems > f.maxItems)) add(f.id, { code: "min_items" });
    }
  }
  const perGroup = (localized: boolean) => fields.filter((f) => f.localized === localized).length;
  for (const localized of [false, true]) {
    if (perGroup(localized) > MAX_PROPERTIES) {
      for (const f of fields.filter((x) => x.localized === localized).slice(MAX_PROPERTIES)) add(f.id, { code: "too_many_fields", params: { max: MAX_PROPERTIES } });
    }
  }
  return out;
}

// What the SERVER's schema check would say about the generated documents (limits and shape), by document.
export function builderSchemaIssues(fields: BuilderField[]): Array<SchemaIssue & { schema: "json_schema" | "localized_schema" }> {
  const g = generateSchemas(fields);
  return [
    ...checkCollectionSchema(g.json_schema).map((i) => ({ ...i, schema: "json_schema" as const })),
    ...checkCollectionSchema(g.localized_schema).map((i) => ({ ...i, schema: "localized_schema" as const })),
  ];
}

// The `title_field` choices: the title of the language rows or a top-level text property (05 17.3: a hint for the UI only).
export function titleFieldOptions(fields: BuilderField[]): string[] {
  return ["title", ...fields.filter((f) => f.fieldKind !== "array" && (f.kind === "string" || f.kind === "text") && f.fieldKind !== "richtext" && PROPERTY_NAME_RE.test(f.name)).map((f) => f.name)];
}
