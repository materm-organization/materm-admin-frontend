import { ICON_RE, MAX_COLLECTION_DESCRIPTION, MAX_COLLECTION_NAME, MAX_SORT_ORDER, MAX_UI_SCHEMA_BYTES } from "@/lib/collections/constants";
import { checkCollectionSchema, jsonBytes, type SchemaIssue } from "@/lib/collections/schema-check";
import {
  builderSchemaIssues,
  canonicalJson,
  fieldProblems,
  generateSchemas,
  parseSchemas,
  type BuilderField,
  type GeneratedSchemas,
  type ParseResult,
} from "@/lib/collections/schema-builder";
import type { Collection, UpdateCollectionPayload } from "@/types/collections";

// The form model of the definition editor (SCR-40): the settings (name, description, ...) and the three schema documents, which are edited
// either through the field builder (`source: "builder"`, the documents are GENERATED from the fields) or as raw JSON text
// (`source: "json"`). Pure functions; the editor keeps one `DefinitionDraft` and `null` = untouched.

export type DefinitionSettings = {
  name: string;
  description: string;
  icon: string;
  is_active: boolean;
  sort_order: string;
  has_slug: boolean;
  title_field: string;
};
export type SchemaTexts = { json_schema: string; localized_schema: string; ui_schema: string };
export type SchemaDraft = { source: "builder"; fields: BuilderField[] } | { source: "json"; texts: SchemaTexts };
export type DefinitionDraft = { settings: DefinitionSettings; schema: SchemaDraft };

const pretty = (v: unknown) => JSON.stringify(v, null, 2);
export const textsOf = (g: GeneratedSchemas): SchemaTexts => ({ json_schema: pretty(g.json_schema), localized_schema: pretty(g.localized_schema), ui_schema: pretty(g.ui_schema) });

export function settingsOf(c: Collection): DefinitionSettings {
  return {
    name: c.name,
    description: c.description,
    icon: c.icon ?? "",
    is_active: c.is_active,
    sort_order: String(c.sort_order),
    has_slug: c.has_slug,
    title_field: c.title_field,
  };
}

// The starting point: the builder when the stored documents survive its round trip, else the raw JSON (the builder is then "locked").
export function draftFromCollection(c: Collection): DefinitionDraft {
  const parsed = parseSchemas(c);
  return {
    settings: settingsOf(c),
    schema: parsed.ok
      ? { source: "builder", fields: parsed.fields }
      : { source: "json", texts: { json_schema: pretty(c.json_schema), localized_schema: pretty(c.localized_schema), ui_schema: pretty(c.ui_schema) } },
  };
}

export type SchemaDocs = { json_schema: unknown; localized_schema: unknown; ui_schema: unknown };
export type SchemaDocsResult = { ok: true; docs: SchemaDocs } | { ok: false; document: keyof SchemaTexts; message: string };

// The three documents the draft stands for; raw text that is not JSON is reported with the parser's position.
export function schemaDocs(schema: SchemaDraft): SchemaDocsResult {
  if (schema.source === "builder") return { ok: true, docs: generateSchemas(schema.fields) };
  const out: Partial<SchemaDocs> = {};
  for (const key of ["json_schema", "localized_schema", "ui_schema"] as const) {
    try {
      out[key] = JSON.parse(schema.texts[key]);
    } catch (error) {
      return { ok: false, document: key, message: error instanceof Error ? error.message : String(error) };
    }
  }
  return { ok: true, docs: out as SchemaDocs };
}

// What the Fields tab shows for the draft: the builder's fields, or why it is locked.
export type BuilderView = { locked: false; fields: BuilderField[] } | { locked: true; reason: Exclude<ParseResult, { ok: true }> | { ok: false; reason: "invalid_json"; schema: keyof SchemaTexts; path: string } };
export function builderView(schema: SchemaDraft): BuilderView {
  if (schema.source === "builder") return { locked: false, fields: schema.fields };
  const docs = schemaDocs(schema);
  if (!docs.ok) return { locked: true, reason: { ok: false, reason: "invalid_json", schema: docs.document, path: "" } };
  const parsed = parseSchemas(docs.docs);
  return parsed.ok ? { locked: false, fields: parsed.fields } : { locked: true, reason: parsed };
}

export type DefinitionProblem = { key: string; code: string; params?: Record<string, number> };

// Client checks of the settings (same rules as the server, 05 17.3). Keys are field ids of the form: `name`, `description`, `icon`, `sort_order`.
export function validateSettings(s: DefinitionSettings): DefinitionProblem[] {
  const out: DefinitionProblem[] = [];
  const name = s.name.trim();
  if (name === "") out.push({ key: "name", code: "required" });
  else if ([...name].length > MAX_COLLECTION_NAME) out.push({ key: "name", code: "too_long", params: { max: MAX_COLLECTION_NAME } });
  if ([...s.description].length > MAX_COLLECTION_DESCRIPTION) out.push({ key: "description", code: "too_long", params: { max: MAX_COLLECTION_DESCRIPTION } });
  if (s.icon !== "" && !ICON_RE.test(s.icon)) out.push({ key: "icon", code: "pattern_mismatch" });
  const order = Number(s.sort_order);
  if (s.sort_order.trim() === "" || !Number.isInteger(order) || order < 0 || order > MAX_SORT_ORDER) out.push({ key: "sort_order", code: "out_of_range", params: { max: MAX_SORT_ORDER } });
  return out;
}

// Problems of the schema part that stop a save before any request: fields of the builder, the limits of the generated documents, bad JSON,
// and the same schema check the server runs on raw JSON. Returned as codes (the editor words them).
export type SchemaProblem =
  | { kind: "json"; document: keyof SchemaTexts; message: string }
  | { kind: "fields"; count: number }
  | { kind: "issue"; document: keyof SchemaTexts; issue: SchemaIssue };
export function schemaProblems(schema: SchemaDraft): SchemaProblem[] {
  if (schema.source === "builder") {
    const out: SchemaProblem[] = [];
    const count = Object.keys(fieldProblems(schema.fields)).length;
    if (count > 0) out.push({ kind: "fields", count });
    for (const i of builderSchemaIssues(schema.fields)) out.push({ kind: "issue", document: i.schema, issue: i });
    return out;
  }
  const docs = schemaDocs(schema);
  if (!docs.ok) return [{ kind: "json", document: docs.document, message: docs.message }];
  const out: SchemaProblem[] = [];
  for (const key of ["json_schema", "localized_schema"] as const) for (const issue of checkCollectionSchema(docs.docs[key])) out.push({ kind: "issue", document: key, issue });
  const ui = docs.docs.ui_schema;
  if (ui === null || typeof ui !== "object" || Array.isArray(ui)) out.push({ kind: "issue", document: "ui_schema", issue: { path: "", code: "invalid_type" } });
  else if (jsonBytes(ui) > MAX_UI_SCHEMA_BYTES) out.push({ kind: "issue", document: "ui_schema", issue: { path: "", code: "too_long" } });
  return out;
}

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

// PATCH body: only what differs from the stored definition; a schema is sent whole, only when it differs (a changed schema may be refused
// with 409 `schema_breaks_entries`, so an untouched one must not travel). `null` = nothing changed.
export function buildDefinitionPatch(base: Collection, draft: DefinitionDraft): UpdateCollectionPayload | null {
  const s = draft.settings;
  const patch: UpdateCollectionPayload = {};
  if (s.name.trim() !== base.name) patch.name = s.name.trim();
  if (s.description !== base.description) patch.description = s.description;
  if ((s.icon === "" ? null : s.icon) !== base.icon) patch.icon = s.icon === "" ? null : s.icon;
  if (s.is_active !== base.is_active) patch.is_active = s.is_active;
  if (Number(s.sort_order) !== base.sort_order) patch.sort_order = Number(s.sort_order);
  if (s.has_slug !== base.has_slug) patch.has_slug = s.has_slug;
  if (s.title_field !== base.title_field) patch.title_field = s.title_field;
  const docs = schemaDocs(draft.schema);
  if (docs.ok) {
    if (!same(docs.docs.json_schema, base.json_schema)) patch.json_schema = docs.docs.json_schema as Collection["json_schema"];
    if (!same(docs.docs.localized_schema, base.localized_schema)) patch.localized_schema = docs.docs.localized_schema as Collection["localized_schema"];
    if (!same(docs.docs.ui_schema, base.ui_schema)) patch.ui_schema = docs.docs.ui_schema as Collection["ui_schema"];
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

export const isDirty = (base: Collection, draft: DefinitionDraft) =>
  buildDefinitionPatch(base, draft) !== null || (draft.schema.source === "json" && !schemaDocs(draft.schema).ok);
