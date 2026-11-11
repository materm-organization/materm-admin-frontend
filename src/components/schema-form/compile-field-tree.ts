import type { JsonSchema, UiSchemaNode } from "@/types/cms";

import type { EntityKind, FieldKind, FieldNode, FieldOptions } from "./types";

// json_schema + ui_schema -> FieldNode tree (doc/07 section 4.1 - 4.3). Pure; a node never points back to its
// parent. `$ref` (local `#/...` only) is resolved here and the def name remembered in `defName`.

const MAX_REF_DEPTH = 8;

export type ResolvedSchema = { schema: JsonSchema; defName?: string };

function lookupRef(root: JsonSchema, ref: string): JsonSchema | undefined {
  if (!ref.startsWith("#")) return undefined;
  const pointer = ref.slice(1);
  if (pointer === "") return root;
  let node: unknown = root;
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node && typeof node === "object" ? (node as JsonSchema) : undefined;
}

// Follows `$ref` chains; sibling keywords next to `$ref` (`title`, `description`) win over the target's.
export function resolveSchema(root: JsonSchema, schema: JsonSchema | undefined): ResolvedSchema {
  let current: JsonSchema = schema ?? {};
  let defName: string | undefined;
  for (let depth = 0; depth < MAX_REF_DEPTH && typeof current.$ref === "string"; depth++) {
    const { $ref, ...siblings } = current;
    const target = lookupRef(root, $ref as string);
    if (!target) break;
    const segments = ($ref as string).split("/");
    defName = segments[segments.length - 1] || defName;
    current = { ...target, ...siblings };
  }
  return { schema: current, defName };
}

export function schemaTypeOf(schema: JsonSchema): string | undefined {
  const t = schema.type;
  return Array.isArray(t) ? t.find((x) => x !== "null") : t;
}

// `{type: object, properties: {media_id: {x-ref: media_assets, x-media-kind: video}}}` and nothing else.
function isVideoPlacement(root: JsonSchema, schema: JsonSchema): boolean {
  const properties = schema.properties;
  if (!properties) return false;
  const names = Object.keys(properties);
  if (names.length !== 1 || names[0] !== "media_id") return false;
  const id = resolveSchema(root, properties.media_id).schema;
  return id["x-ref"] === "media_assets" && id["x-media-kind"] === "video";
}

const WIDGET_ENTITY: Record<string, EntityKind> = {
  "post-picker": "post",
  "album-picker": "album",
  "album-item-picker": "albumItem",
  "category-picker": "category",
  "faq-group-picker": "faqGroup",
  "form-picker": "form",
};

const TABLE_ENTITY: Record<string, EntityKind> = {
  cms_posts: "post",
  cms_albums: "album",
  cms_album_items: "albumItem",
  cms_categories: "category",
  cms_faq_groups: "faqGroup",
  forms_forms: "form",
};

function readOptions(ui: UiSchemaNode | undefined): FieldOptions {
  const raw = (ui?.["ui:options"] ?? {}) as Record<string, unknown>;
  return {
    orderable: raw.orderable !== false,
    addable: raw.addable !== false,
    removable: raw.removable !== false,
    rows: typeof raw.rows === "number" ? raw.rows : undefined,
    ratio: typeof raw.ratio === "string" ? raw.ratio : undefined,
    albumField: typeof raw.albumField === "string" ? raw.albumField : undefined,
  };
}

// `ui:order` first; a property it does not name stays next to the property that precedes it in the schema (so a field added to
// a schema after its `ui_schema` was written, like `background_video`, appears beside `background`); with no placed
// predecessor it goes to the end.
function orderedNames(properties: Record<string, JsonSchema>, ui: UiSchemaNode | undefined): string[] {
  const all = Object.keys(properties);
  const order = Array.isArray(ui?.["ui:order"]) ? (ui?.["ui:order"] as string[]) : [];
  const result = order.filter((name) => name in properties);
  all.forEach((name, index) => {
    if (result.includes(name)) return;
    const predecessor = all.slice(0, index).reverse().find((n) => result.includes(n));
    if (predecessor === undefined) result.push(name);
    else result.splice(result.indexOf(predecessor) + 1, 0, name);
  });
  return result;
}

type CompileContext = { root: JsonSchema; warnings: string[] };

function compileNode(
  ctx: CompileContext,
  raw: JsonSchema,
  name: string,
  schemaPointer: string,
  ui: UiSchemaNode | undefined,
  required: boolean
): FieldNode {
  const { schema, defName } = resolveSchema(ctx.root, raw);
  const widget = typeof ui?.["ui:widget"] === "string" ? (ui["ui:widget"] as string) : undefined;
  const type = schemaTypeOf(schema);
  const options = readOptions(ui);
  const showIf =
    ui?.["ui:showIf"] && typeof ui["ui:showIf"] === "object" ? (ui["ui:showIf"] as Record<string, unknown>) : undefined;

  const node: FieldNode = {
    schemaPointer,
    name,
    kind: "unknown",
    schema,
    ui,
    defName,
    title: typeof schema.title === "string" ? schema.title : undefined,
    description: typeof schema.description === "string" && !defName ? schema.description : undefined,
    required,
    multiline: schema["x-multiline"] === true,
    textarea: widget === "textarea",
    radio: widget === "radio",
    integer: type === "integer",
    defaultValue: schema.default,
    children: [],
    options,
    showIf,
    optionalGroup: false,
  };
  // A property's own description beats the def's generic one; a bare `$ref` keeps none.
  if (typeof raw.description === "string") node.description = raw.description;

  const setKind = (kind: FieldKind) => {
    node.kind = kind;
    return node;
  };

  // 1. locale maps (text or rich text)
  if (schema["x-localized"] === true) {
    const additional = typeof schema.additionalProperties === "object" ? schema.additionalProperties : undefined;
    const profile = schema["x-richtext"];
    if (profile === "lite" || profile === "full" || widget === "richtext-lite") {
      node.richtextProfile = profile === "full" ? "full" : "lite";
      return setKind("richtext");
    }
    node.maxLength = additional ? resolveSchema(ctx.root, additional).schema.maxLength : undefined;
    return setKind("localized-text");
  }

  // 1b. rich text that is not a locale map (collection schemas: `{type: object, x-richtext: "lite"}`, the value is the document)
  if (schema["x-richtext"] === "lite" && type === "object" && !schema.properties) {
    node.richtextProfile = "lite";
    node.plainRichtext = true;
    return setKind("richtext");
  }

  // 2. well-known defs (also when ui_schema does not say so)
  if (widget === "media-picker" || defName === "image") return setKind("image");
  if (widget === "link-picker" || defName === "link") return setKind("link");

  // 2b. an optional video placement `{media_id}` whose only property is a `media_assets` reference annotated `x-media-kind: video`
  // (generic: any object of that shape, not only `hero_brand.background_video`)
  if (isVideoPlacement(ctx.root, schema)) return setKind("media-video");

  // 3. references to other rows
  const entityKind = (widget && WIDGET_ENTITY[widget]) || TABLE_ENTITY[String(schema["x-ref"] ?? "")];
  if (entityKind) {
    node.entity = {
      kind: entityKind,
      table: typeof schema["x-ref"] === "string" ? (schema["x-ref"] as string) : undefined,
      valueType: type === "string" ? "string" : "number",
    };
    return setKind("entity");
  }

  // 4. containers
  if (type === "object" || schema.properties) {
    const properties = schema.properties ?? {};
    const requiredNames = new Set(schema.required ?? []);
    node.children = orderedNames(properties, ui).map((childName) =>
      compileNode(
        ctx,
        properties[childName],
        childName,
        `${schemaPointer}/${childName}`,
        (ui?.[childName] as UiSchemaNode | undefined) ?? undefined,
        requiredNames.has(childName)
      )
    );
    // An optional object that is not a plain "fieldset" the user can leave alone is added / removed as a whole.
    node.optionalGroup = !required && !node.showIf;
    return setKind("object");
  }

  if (type === "array") {
    node.minItems = schema.minItems;
    node.maxItems = schema.maxItems;
    const itemsRaw = schema.items ?? {};
    const itemUi = (ui?.items as UiSchemaNode | undefined) ?? undefined;
    const itemResolved = resolveSchema(ctx.root, itemsRaw);
    if (Array.isArray(itemResolved.schema.enum) && !itemUi?.["ui:widget"]) {
      node.enumValues = itemResolved.schema.enum;
      return setKind("enum-array");
    }
    node.item = compileNode(ctx, itemsRaw, "*", `${schemaPointer}/*`, itemUi, true);
    return setKind("array");
  }

  // 5. primitives
  if (Array.isArray(schema.enum) || schema.const !== undefined) {
    node.enumValues = Array.isArray(schema.enum) ? schema.enum : [schema.const];
    return setKind("enum");
  }
  if (type === "boolean") return setKind("boolean");
  if (type === "integer" || type === "number") {
    node.minimum = schema.minimum;
    node.maximum = schema.maximum;
    return setKind("number");
  }
  if (type === "string" && (widget === "date" || (schema.format === "date" && !widget))) return setKind("date");
  if (type === "string" && (widget === "date-time" || (schema.format === "date-time" && !widget))) return setKind("datetime");
  if (type === "string") {
    node.maxLength = schema.maxLength;
    node.minLength = schema.minLength;
    node.pattern = schema.pattern;
    return setKind("string");
  }

  ctx.warnings.push(`${schemaPointer}: no widget for this schema shape`);
  return setKind("unknown");
}

export type FieldTree = {
  root: FieldNode;
  // Compile-time notes (an unsupported shape became a JsonFallbackField). Logged in dev.
  warnings: string[];
};

export function compileFieldTree(jsonSchema: JsonSchema, uiSchema: UiSchemaNode | undefined): FieldTree {
  const ctx: CompileContext = { root: jsonSchema, warnings: [] };
  const root = compileNode(ctx, { ...jsonSchema, type: jsonSchema.type ?? "object" }, "", "", uiSchema, true);
  root.optionalGroup = false;
  return { root, warnings: ctx.warnings };
}

// ui:showIf: every listed sibling property must equal (or, for an array, be one of) the given value.
export function isShown(node: FieldNode, parentValue: unknown): boolean {
  if (!node.showIf) return true;
  const object = (parentValue !== null && typeof parentValue === "object" ? parentValue : {}) as Record<string, unknown>;
  return Object.entries(node.showIf).every(([key, expected]) => {
    const actual = object[key];
    return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  });
}

// Finds the node for a JSON-Pointer path inside the props (doc/07 section 4.6 step 2): numeric segments walk
// into array items; a locale code under a localized node resolves to that node and the locale.
export function findNodeByPointer(
  tree: FieldTree,
  segments: string[]
): { node: FieldNode; locale?: string; itemIndexes: Array<{ pointer: string; index: number }> } | undefined {
  let node = tree.root;
  let locale: string | undefined;
  const itemIndexes: Array<{ pointer: string; index: number }> = [];
  let pointer = "";
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    pointer += `/${segment.replace(/~/g, "~0").replace(/\//g, "~1")}`;
    if (node.kind === "array" && node.item && /^\d+$/.test(segment)) {
      itemIndexes.push({ pointer, index: Number(segment) });
      node = node.item;
    } else if (node.kind === "localized-text" || node.kind === "richtext") {
      locale = segment;
      return { node, locale, itemIndexes };
    } else if (node.kind === "object") {
      const child = node.children.find((c) => c.name === segment);
      if (!child) return undefined;
      node = child;
    } else if (node.kind === "image" || node.kind === "link") {
      // `/background/alt/la`, `/cta/link/url`: the deeper segments belong to the widget itself.
      if (segment === "alt" && segments[i + 1]) locale = segments[i + 1];
      return { node, locale, itemIndexes };
    } else {
      return { node, locale, itemIndexes };
    }
  }
  return { node, locale, itemIndexes };
}
