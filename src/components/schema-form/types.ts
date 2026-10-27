import type { JsonSchema, UiSchemaNode } from "@/types/cms";

// Kinds of `x-ref` target the pickers know (doc/07 section 4.3). `value` is what goes into props.
export type EntityKind = "post" | "album" | "albumItem" | "category" | "faqGroup" | "form";

export type FieldKind =
  | "localized-text"
  | "richtext"
  | "image"
  | "link"
  | "entity"
  | "object"
  | "array"
  | "enum"
  | "enum-array"
  | "string"
  | "number"
  | "boolean"
  | "unknown";

export type FieldOptions = {
  orderable: boolean;
  addable: boolean;
  removable: boolean;
  rows?: number;
  // MediaField crop preview: "hero" or "430:562".
  ratio?: string;
  // album-item-picker: JSON Pointer (from the section root) of the album field.
  albumField?: string;
};

// The node tree compiled from `json_schema` + `ui_schema` (doc/07 section 4.1). Immutable once built.
export type FieldNode = {
  // JSON-Pointer-like id of the schema position: array items are "*" (`/items/*/title`).
  schemaPointer: string;
  // Property name; "*" for an array item.
  name: string;
  kind: FieldKind;
  schema: JsonSchema;
  ui: UiSchemaNode | undefined;
  // Name of the `$defs` entry this node came from (`image`, `link`, `cta`, ...), kept to choose a widget.
  defName?: string;
  title?: string;
  description?: string;
  // In the parent's `required` (the schema's, not the conditional ones).
  required: boolean;
  multiline: boolean;
  textarea: boolean;
  richtextProfile?: "lite" | "full";
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  enumValues?: unknown[];
  radio: boolean;
  minimum?: number;
  maximum?: number;
  integer: boolean;
  defaultValue?: unknown;
  entity?: { kind: EntityKind; table?: string; valueType: "number" | "string" };
  children: FieldNode[];
  item?: FieldNode;
  minItems?: number;
  maxItems?: number;
  options: FieldOptions;
  showIf?: Record<string, unknown>;
  // True for an optional object that is added / removed as a whole (a CTA button, a caption).
  optionalGroup: boolean;
};

// One validation problem. `path` is a JSON Pointer inside the props object ("" = the whole object) and `code`
// a field code of doc/05 section 1.5 (`required`, `too_long`, `pattern_mismatch`, ...), so client and server
// issues are interchangeable.
export type Issue = {
  path: string;
  code: string;
  params?: Record<string, string | number | boolean | string[]>;
  // Ajv keyword the issue came from ("" for rules that are not in the schema).
  keyword?: string;
  // Text the server sent; a client issue never has one.
  message?: string;
};

export type ValidationMode = "draft" | "publish";
