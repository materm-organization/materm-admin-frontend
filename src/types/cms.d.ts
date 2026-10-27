// CMS wire types shared by the section editor and its form engine (doc/05-api-spec.md section 10.6, doc/04).

// A JSON Schema (draft 2020-12) fragment as served by `GET /section-types/{key}`. Deliberately loose: the
// engine reads the keywords it understands and ignores the rest.
export type JsonSchema = {
  $schema?: string;
  $id?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  propertyNames?: JsonSchema;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  not?: JsonSchema;
  if?: JsonSchema;
  then?: JsonSchema;
  else?: JsonSchema;
  "x-localized"?: boolean;
  "x-multiline"?: boolean;
  "x-richtext"?: "lite" | "full";
  "x-ref"?: string;
  [keyword: string]: unknown;
};

// RJSF-style hints (`ui:order`, `ui:widget`, `ui:options`, `ui:showIf`, `ui:variant`); nested by property name,
// array items under `items`.
export type UiSchemaNode = {
  "ui:order"?: string[];
  "ui:widget"?: string;
  "ui:options"?: Record<string, unknown>;
  "ui:showIf"?: Record<string, unknown>;
  "ui:variant"?: Record<string, string>;
  items?: UiSchemaNode;
  [key: string]: unknown;
};

export type SectionPlacement = {
  template: string;
  required: boolean;
  max_per_page: number | null;
  position: "first" | "after_hero" | "any";
  group: string | null;
};

// `GET /section-types/{key}` (detail). The list (`GET /section-types`) carries the same minus the heavy
// `json_schema` / `ui_schema` / `default_props` / `limits` unless `include=schema`.
export type SectionType = {
  id?: number;
  public_id?: string;
  key: string;
  version: number;
  name: string;
  description: string;
  variants: string[];
  allowed_scopes?: string[];
  is_current?: boolean;
  is_active?: boolean;
  deprecated_at?: string | null;
  schema_hash?: string | null;
  usage?: { sections: number; shared_sections: number };
  placement?: SectionPlacement[];
  code_registered?: boolean;
  limits?: { max_props_bytes: number };
  json_schema: JsonSchema;
  ui_schema: UiSchemaNode;
  default_props: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type SectionTypeSummary = Omit<SectionType, "json_schema" | "ui_schema" | "default_props" | "limits"> &
  Partial<Pick<SectionType, "json_schema" | "ui_schema" | "default_props" | "limits">>;

// A picked row of an `x-ref` entity (or the media library), as the pickers need it.
export type EntityStatus = "draft" | "published" | "scheduled" | "archived" | string;

export type EntityOption = {
  // What goes into props: the numeric id, or the string key / slug (`faqGroup`, `form`).
  value: number | string;
  label: string;
  // Secondary text (slug, key, path).
  hint?: string;
  status?: EntityStatus;
};

export type MediaAssetOption = {
  id: number;
  filename: string;
  url?: string | null;
  thumbnail_url?: string | null;
  mime_type?: string;
  status?: "ready" | "processing" | "failed" | string;
  width?: number | null;
  height?: number | null;
  // Alt text per locale code (`media_asset_translations.alt`).
  alt?: Record<string, string>;
};
