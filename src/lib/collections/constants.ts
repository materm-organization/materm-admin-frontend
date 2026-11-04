// Limits and rules of the collections API (doc/05 section 17.3 / 17.4). Mirrors `materm-admin-backend/pkg/contentschema/standalone.go`
// and `modules/cms/collections/models`; the server stays the authority, these only keep the UI from sending what is refused.

export const COLLECTION_KEY_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
export const MIN_COLLECTION_KEY = 3;
export const MAX_COLLECTION_KEY = 40;
export const MAX_COLLECTION_NAME = 120;
export const MAX_COLLECTION_DESCRIPTION = 500;
export const MAX_SORT_ORDER = 1_000_000;
export const ICON_RE = /^[a-z0-9_-]{1,40}$/;
export const MAX_ENTRY_TITLE = 200;
export const MAX_ENTRY_SLUG = 100;
export const ENTRY_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// The page of GET /collections and GET .../entries (allow-lists of the sort parameter).
export const COLLECTION_SORTS = ["sort_order", "key", "name", "updated_at", "deleted_at"] as const;
export const ENTRY_SORTS = ["sort_order", "title", "updated_at", "created_at", "published_at", "status", "deleted_at"] as const;

// ---- schema limits (05 17.4.3) -----------------------------------------------------------------------------------------------------
export const MAX_SCHEMA_BYTES = 64 << 10;
export const MAX_SCHEMA_NODES = 300;
export const MAX_SCHEMA_DEPTH = 8;
export const MAX_COMBINATOR_DEPTH = 3;
export const MAX_BRANCHES = 10;
export const MAX_PATTERN_LENGTH = 256;
export const MAX_PATTERNS = 50;
// A string node with a `pattern` must carry a maxLength <= MAX_PATTERNED_LENGTH, and a repeat count in the pattern is <= MAX_PATTERN_REPEAT
// (the work of one match is bounded; backend 0c541f6). The compiled-program limit (1000 instructions) is only checked by the server.
export const MAX_PATTERNED_LENGTH = 10000;
export const MAX_PATTERN_REPEAT = 100;
export const MAX_ENUM_VALUES = 200;
export const MAX_PROPERTIES = 60;
export const MAX_ARRAY_ITEMS = 500;
export const MAX_UI_SCHEMA_BYTES = 32 << 10;

export const PROPERTY_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;
// Compared lower-case (`pkg/contentschema` `reservedNames`).
export const RESERVED_PROPERTY_NAMES: readonly string[] = ["constructor", "prototype", "valueof", "tostring", "hasownproperty"];

// 05 17.4.1: the ONLY keywords a collection schema may use (`CollectionKeywords()` of the backend, sorted).
export const ALLOWED_SCHEMA_KEYWORDS: readonly string[] = [
  "$comment",
  "$schema",
  "additionalProperties",
  "allOf",
  "anyOf",
  "const",
  "default",
  "deprecated",
  "description",
  "else",
  "enum",
  "examples",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "if",
  "items",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "not",
  "oneOf",
  "pattern",
  "properties",
  "readOnly",
  "required",
  "then",
  "title",
  "type",
  "uniqueItems",
  "writeOnly",
  "x-filterable",
  "x-multiline",
  "x-richtext",
];

export const SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema";

export const isReservedPropertyName = (name: string) => RESERVED_PROPERTY_NAMES.includes(name.toLowerCase());

// A collection key must be 3-40 characters and match the key pattern (no trailing / doubled underscore: it becomes a cache tag).
export function collectionKeyProblem(key: string): "required" | "too_short" | "too_long" | "pattern_mismatch" | null {
  if (key === "") return "required";
  if (key.length < MIN_COLLECTION_KEY) return "too_short";
  if (key.length > MAX_COLLECTION_KEY) return "too_long";
  return COLLECTION_KEY_RE.test(key) ? null : "pattern_mismatch";
}

// "Team members" -> "team_members" (a suggestion for the key field).
export function suggestCollectionKey(name: string): string {
  const ascii = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const key = /^[a-z]/.test(ascii) ? ascii : ascii === "" ? "" : `c_${ascii}`;
  return key.slice(0, MAX_COLLECTION_KEY).replace(/_+$/g, "");
}
