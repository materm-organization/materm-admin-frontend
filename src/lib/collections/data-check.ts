import type { JsonSchema } from "@/types/cms";

// A small, hand-written, CONSERVATIVE checker of an entry's `data` against a collection schema (doc/05 17.4 subset). It never uses Ajv
// (Ajv compiles with `new Function`, which the production CSP forbids) and never evaluates the schema as code: the schema is walked as data.
//
// Conservative = it reports only definite failures, with the server's codes and paths:
//   type, enum / const, minimum / maximum (+ exclusive), minLength / maxLength (code points), pattern (only when JavaScript can compile it),
//   format date / date-time, items / minItems / maxItems / uniqueItems, additionalProperties:false, and `required` / `minLength` /
//   `minItems` only in `publish` mode (the server skips them for a draft). Combinators (allOf / anyOf / oneOf / not / if) and the deep
//   rich text check are left to the server. The server stays the authority.

export type DataIssue = { path: string; code: string; params?: Record<string, string | number | boolean | string[]> };
export type DataMode = "draft" | "publish";

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const codePoints = (s: string) => [...s].length;

export function isValidDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export function isValidDateTime(value: string): boolean {
  const m = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!m || !isValidDate(m[1])) return false;
  if (Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4]) > 60) return false;
  return m[7] === undefined || (Number(m[7]) <= 23 && Number(m[8]) <= 59);
}

function typeMatches(type: string, v: unknown): boolean {
  switch (type) {
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "boolean":
      return typeof v === "boolean";
    case "null":
      return v === null;
    case "object":
      return isObject(v);
    case "array":
      return Array.isArray(v);
    default:
      return true;
  }
}

const esc = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

function compile(pattern: string): RegExp | null {
  for (const flags of ["u", ""]) {
    try {
      return new RegExp(pattern, flags);
    } catch {
      /* try the next flag set */
    }
  }
  return null;
}

function walk(schema: JsonSchema, value: unknown, path: string, mode: DataMode, out: DataIssue[]) {
  if (out.length >= 100) return;
  const add = (code: string, params?: DataIssue["params"]) => out.push({ path, code, params });
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length > 0 && !types.some((t) => typeMatches(t, value))) {
    add("invalid_type", { expected: types });
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) add("not_in_enum");
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) add("not_in_enum");
  if (typeof value === "string") {
    const len = codePoints(value);
    if (typeof schema.maxLength === "number" && len > schema.maxLength) add("too_long", { max: schema.maxLength });
    if (mode === "publish" && typeof schema.minLength === "number" && len < schema.minLength) add("too_short", { min: schema.minLength });
    if (typeof schema.pattern === "string") {
      const re = compile(schema.pattern);
      if (re && !re.test(value)) add("pattern_mismatch");
    }
    if (schema.format === "date" && !isValidDate(value)) add("invalid_format", { format: "date" });
    if (schema.format === "date-time" && !isValidDateTime(value)) add("invalid_format", { format: "date-time" });
  }
  if (typeof value === "number") {
    const s = schema as Record<string, unknown>;
    if (typeof s.minimum === "number" && value < s.minimum) add("out_of_range", { min: s.minimum });
    if (typeof s.maximum === "number" && value > s.maximum) add("out_of_range", { max: s.maximum });
    if (typeof s.exclusiveMinimum === "number" && value <= s.exclusiveMinimum) add("out_of_range", { min: s.exclusiveMinimum });
    if (typeof s.exclusiveMaximum === "number" && value >= s.exclusiveMaximum) add("out_of_range", { max: s.exclusiveMaximum });
  }
  if (Array.isArray(value)) {
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) add("too_long", { max: schema.maxItems });
    if (mode === "publish" && typeof schema.minItems === "number" && value.length < schema.minItems) add("too_short", { min: schema.minItems });
    if (schema.uniqueItems === true) {
      const seen = new Set(value.map((v) => JSON.stringify(v)));
      if (seen.size !== value.length) add("duplicate");
    }
    if (isObject(schema.items)) value.forEach((v, i) => walk(schema.items as JsonSchema, v, `${path}/${i}`, mode, out));
  }
  if (isObject(value) && schema["x-richtext"] === undefined) {
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    if (mode === "publish") {
      for (const name of schema.required ?? []) {
        if (value[name] === undefined || value[name] === null) out.push({ path: `${path}/${esc(name)}`, code: "required" });
      }
    }
    for (const [name, v] of Object.entries(value)) {
      if (props[name]) walk(props[name], v, `${path}/${esc(name)}`, mode, out);
      else if (schema.additionalProperties === false) out.push({ path: `${path}/${esc(name)}`, code: "unknown_field" });
    }
  }
}

export function checkEntryData(schema: JsonSchema, value: unknown, mode: DataMode = "draft"): DataIssue[] {
  const out: DataIssue[] = [];
  walk(schema, value, "", mode, out);
  return out;
}
