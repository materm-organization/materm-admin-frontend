import {
  ALLOWED_SCHEMA_KEYWORDS,
  MAX_ARRAY_ITEMS,
  MAX_BRANCHES,
  MAX_COMBINATOR_DEPTH,
  MAX_ENUM_VALUES,
  MAX_PATTERNED_LENGTH,
  MAX_PATTERNS,
  MAX_PATTERN_REPEAT,
  MAX_PATTERN_LENGTH,
  MAX_PROPERTIES,
  MAX_SCHEMA_BYTES,
  MAX_SCHEMA_DEPTH,
  MAX_SCHEMA_NODES,
  PROPERTY_NAME_RE,
  SCHEMA_DRAFT,
  isReservedPropertyName,
} from "./constants";

// Client mirror of `contentschema.CheckCollectionSchema` (doc/05 17.4): the allowed keywords, the shape rules and the limits, run on
// the schema BEFORE it is sent. It reports the same `code` / `params` / JSON-Pointer path the server would, relative to the schema
// (the caller prefixes `/json_schema` or `/localized_schema`). It does not compile patterns (RE2) and executes nothing: a schema is data.
// The server stays the authority; this exists so the field builder never sends a refused schema and so tests can assert what the builder emits.

export type SchemaIssue = { path: string; code: string; params?: Record<string, string | number | boolean> };

const ALLOWED = new Set(ALLOWED_SCHEMA_KEYWORDS);
const MAX_ISSUES = 100;

const escapePointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function typeList(t: unknown): string[] {
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((e): e is string => typeof e === "string");
  return [];
}
const typeIs = (t: unknown, name: string) => typeList(t).includes(name);
const isOnlyType = (t: unknown, name: string) => {
  const l = typeList(t);
  return l.length === 1 && l[0] === name;
};

class Checker {
  issues: SchemaIssue[] = [];
  nodes = 0;
  patterns = 0;
  private limitHit = new Set<string>();

  add(path: string, code: string, params?: SchemaIssue["params"]) {
    if (this.issues.length < MAX_ISSUES) this.issues.push({ path, code, params });
  }
  limit(path: string, name: string, max: number) {
    if (this.limitHit.has(name)) return;
    this.limitHit.add(name);
    this.add(path, "limit_exceeded", { limit: name, max });
  }

  node(m: Record<string, unknown>, p: string, depth: number, comb: number, root: boolean) {
    this.nodes += 1;
    if (this.nodes > MAX_SCHEMA_NODES) return this.limit(p, "nodes", MAX_SCHEMA_NODES);
    if (depth > MAX_SCHEMA_DEPTH) return this.limit(p, "depth", MAX_SCHEMA_DEPTH);
    for (const k of Object.keys(m).sort()) {
      if (!ALLOWED.has(k)) this.add(`${p}/${escapePointer(k)}`, "unsupported_keyword", { keyword: k });
    }
    if ("$schema" in m && (!root || m.$schema !== SCHEMA_DRAFT)) this.add(`${p}/$schema`, "unsupported_keyword", { keyword: "$schema" });
    const types = typeList(m.type);
    if ("type" in m) {
      const t = m.type;
      const isArr = Array.isArray(t);
      if ((typeof t !== "string" && !isArr) || types.length === 0 || (isArr && types.length !== t.length)) this.add(`${p}/type`, "invalid_schema", { reason: "type" });
    }
    let rich = false;
    if ("x-richtext" in m) {
      rich = true;
      if (m["x-richtext"] !== "lite" || !isOnlyType(m.type, "object")) this.add(`${p}/x-richtext`, "invalid_schema", { reason: "richtext" });
      if ("properties" in m) this.add(`${p}/properties`, "invalid_schema", { reason: "richtext" });
    }
    for (const k of ["x-multiline", "x-filterable", "deprecated", "readOnly", "writeOnly", "uniqueItems"]) {
      if (k in m && typeof m[k] !== "boolean") this.add(`${p}/${k}`, "invalid_schema", { reason: "type" });
    }
    if (typeIs(m.type, "object") && !rich) {
      if (!("properties" in m)) this.add(`${p}/properties`, "missing_keyword", { keyword: "properties" });
      if (!("additionalProperties" in m)) this.add(`${p}/additionalProperties`, "missing_keyword", { keyword: "additionalProperties" });
      else if (m.additionalProperties !== false) this.add(`${p}/additionalProperties`, "invalid_schema", { reason: "additional_properties" });
    } else if ("additionalProperties" in m && m.additionalProperties !== false) {
      this.add(`${p}/additionalProperties`, "invalid_schema", { reason: "additional_properties" });
    }
    if ("properties" in m) {
      const props = m.properties;
      if (!isObject(props)) this.add(`${p}/properties`, "invalid_schema", { reason: "type" });
      else {
        if (Object.keys(props).length > MAX_PROPERTIES) this.limit(`${p}/properties`, "properties", MAX_PROPERTIES);
        for (const name of Object.keys(props).sort()) this.property(name, props[name], `${p}/properties/${escapePointer(name)}`, depth, comb);
      }
    }
    if ("required" in m) {
      const req = m.required;
      if (!Array.isArray(req) || req.length > MAX_PROPERTIES || req.some((e) => typeof e !== "string")) this.add(`${p}/required`, "invalid_schema", { reason: "type" });
    }
    if (typeIs(m.type, "array")) {
      if (!("items" in m)) this.add(`${p}/items`, "missing_keyword", { keyword: "items" });
      if (!("maxItems" in m)) this.add(`${p}/maxItems`, "missing_keyword", { keyword: "maxItems" });
      else if (typeof m.maxItems !== "number" || !Number.isInteger(m.maxItems)) this.add(`${p}/maxItems`, "invalid_schema", { reason: "type" });
      else if (m.maxItems > MAX_ARRAY_ITEMS) this.limit(`${p}/maxItems`, "max_items", MAX_ARRAY_ITEMS);
    }
    if ("items" in m) this.child(m.items, `${p}/items`, depth, comb);
    if ("enum" in m) {
      const e = m.enum;
      if (!Array.isArray(e) || e.length === 0) this.add(`${p}/enum`, "invalid_schema", { reason: "type" });
      else if (e.length > MAX_ENUM_VALUES) this.limit(`${p}/enum`, "enum", MAX_ENUM_VALUES);
    }
    if ("pattern" in m) {
      const pat = m.pattern;
      if (typeof pat !== "string") this.add(`${p}/pattern`, "invalid_schema", { reason: "pattern" });
      else if ([...pat].length > MAX_PATTERN_LENGTH && pat.length > MAX_PATTERN_LENGTH) this.limit(`${p}/pattern`, "pattern_length", MAX_PATTERN_LENGTH);
      else {
        this.patterns += 1;
        if (this.patterns > MAX_PATTERNS) this.limit(`${p}/pattern`, "patterns", MAX_PATTERNS);
        // bounded work per match: a repeat count <= 100 and a maxLength <= 10000 on the same node
        for (const m of pat.matchAll(/\{(\d+)(?:,(\d*))?\}/g)) {
          if (Math.max(Number(m[1]), Number(m[2] || 0)) > MAX_PATTERN_REPEAT) this.limit(`${p}/pattern`, "pattern_repeat", MAX_PATTERN_REPEAT);
        }
        if (!("maxLength" in m)) this.add(`${p}/maxLength`, "missing_keyword", { keyword: "maxLength" });
        else if (typeof m.maxLength === "number" && m.maxLength > MAX_PATTERNED_LENGTH) this.limit(`${p}/maxLength`, "patterned_length", MAX_PATTERNED_LENGTH);
      }
    }
    if ("format" in m) {
      const f = m.format;
      if (typeof f !== "string" || (f !== "date" && f !== "date-time") || !isOnlyType(m.type, "string")) this.add(`${p}/format`, "invalid_schema", { reason: "format" });
    }
    for (const k of ["allOf", "anyOf", "oneOf"] as const) {
      if (!(k in m)) continue;
      const arr = m[k];
      if (!Array.isArray(arr) || arr.length === 0) {
        this.add(`${p}/${k}`, "invalid_schema", { reason: "type" });
        continue;
      }
      if (comb + 1 > MAX_COMBINATOR_DEPTH) {
        this.limit(`${p}/${k}`, "combinator_depth", MAX_COMBINATOR_DEPTH);
        continue;
      }
      if (arr.length > MAX_BRANCHES) {
        this.limit(`${p}/${k}`, "branches", MAX_BRANCHES);
        continue;
      }
      arr.forEach((e, i) => this.child(e, `${p}/${k}/${i}`, depth, comb + 1));
    }
    for (const k of ["not", "if", "then", "else"] as const) {
      if (!(k in m)) continue;
      if (comb + 1 > MAX_COMBINATOR_DEPTH) {
        this.limit(`${p}/${k}`, "combinator_depth", MAX_COMBINATOR_DEPTH);
        continue;
      }
      this.child(m[k], `${p}/${k}`, depth, comb + 1);
    }
  }

  child(raw: unknown, p: string, depth: number, comb: number) {
    if (!isObject(raw)) return this.add(p, "invalid_schema", { reason: "not_object" });
    this.node(raw, p, depth + 1, comb, false);
  }

  property(name: string, raw: unknown, p: string, depth: number, comb: number) {
    if (!PROPERTY_NAME_RE.test(name)) this.add(p, "invalid_schema", { reason: "property_name", pattern: PROPERTY_NAME_RE.source });
    else if (isReservedPropertyName(name)) this.add(p, "reserved_name", { name });
    this.child(raw, p, depth, comb);
    if (name !== "media_id") return;
    const m = isObject(raw) ? raw : {};
    const l = typeList(m.type);
    const okType = l.length > 0 && l.every((t) => t === "integer" || t === "null") && l.includes("integer");
    if (!okType) this.add(`${p}/type`, "invalid_schema", { reason: "media_id_type" });
  }
}

// `checkCollectionSchema(schema)`: [] when the schema passes. `prefix` is prepended to every path (`/json_schema`).
export function checkCollectionSchema(schema: unknown, prefix = ""): SchemaIssue[] {
  const text = JSON.stringify(schema ?? null);
  if (text.length > MAX_SCHEMA_BYTES && new TextEncoder().encode(text).length > MAX_SCHEMA_BYTES) {
    return [{ path: prefix, code: "limit_exceeded", params: { limit: "schema_bytes", max: MAX_SCHEMA_BYTES } }];
  }
  if (!isObject(schema)) return [{ path: prefix, code: "invalid_schema", params: { reason: "not_object" } }];
  const c = new Checker();
  if (!isOnlyType(schema.type, "object")) c.add("/type", "invalid_schema", { reason: "root_type" });
  c.node(schema, "", 1, 0, true);
  return c.issues.map((i) => ({ ...i, path: prefix + i.path }));
}

// Byte size of a JSON value as the server counts it.
export const jsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value ?? null)).length;
