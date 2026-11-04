import type { ApiFieldError } from "@/types/api";

// The 422 `errors[]` of a definition write that point INTO a schema (`/json_schema/properties/age/pattern`): which document, which field
// (the property name right after `properties`) and the rest of the path, so the screen can say "Field age: pattern" and mark the row.
export type SchemaTarget = "json_schema" | "localized_schema" | "ui_schema";
export type LocatedSchemaError = {
  error: ApiFieldError;
  schema: SchemaTarget;
  // The top-level property the error is inside; undefined for the document itself (`/json_schema`, `/json_schema/type`).
  field?: string;
  // Path after the field: `["items", "maxItems"]`.
  rest: string[];
};

const unescape = (s: string) => s.replace(/~1/g, "/").replace(/~0/g, "~");

export function locateSchemaError(error: ApiFieldError): LocatedSchemaError | null {
  const segments = error.path.split("/").slice(1).map(unescape);
  const schema = segments[0];
  if (schema !== "json_schema" && schema !== "localized_schema" && schema !== "ui_schema") return null;
  const tail = segments.slice(1);
  if (tail[0] === "properties" && tail[1] !== undefined) return { error, schema, field: tail[1], rest: tail.slice(2) };
  return { error, schema, rest: tail };
}

export const isSchemaError = (error: ApiFieldError) => locateSchemaError(error) !== null;

// Names of the fields that have an error (to mark their rows).
export function fieldsWithErrors(errors: ApiFieldError[]): Set<string> {
  const out = new Set<string>();
  for (const e of errors) {
    const located = locateSchemaError(e);
    if (located?.field) out.add(located.field);
  }
  return out;
}
