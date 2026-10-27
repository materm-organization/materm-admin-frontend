import type { JsonSchema } from "@/types/cms";

import { resolveSchema } from "./compile-field-tree";
import { joinPointer } from "./pointer";

// Schema-guided walk over a props value. It is the one walker behind the publish pre-check, the per-locale
// completeness and the rich-text link rule (doc/07 section 4.4: "the same walker as the publish check").

export type WalkVisit = {
  pointer: string;
  schema: JsonSchema;
  defName?: string;
  value: unknown;
  // Required by the object it sits in: the `required` of every schema that applies to that object - the
  // schema itself, its `allOf` members and the `then` / `else` branch whose `if` matches (04 section 4.4 counts
  // "required leaves").
  required: boolean;
};

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Decides an `if`. The default reads what the 12 content schemas use (property `const` / `enum` and
// `required`), which needs no code generation and so works under a CSP without 'unsafe-eval'; the validator
// passes an exact Ajv-based one when it can compile.
export type IfMatcher = (condition: JsonSchema, value: Record<string, unknown>) => boolean;

export const simpleIfMatcher: IfMatcher = (condition, object) => {
  for (const name of condition.required ?? []) if (!(name in object)) return false;
  for (const [name, sub] of Object.entries(condition.properties ?? {})) {
    if (!(name in object)) return false;
    const actual = object[name];
    if ("const" in sub && actual !== sub.const) return false;
    if (Array.isArray(sub.enum) && !sub.enum.includes(actual)) return false;
  }
  return true;
};

// The schemas that apply to one object instance: itself, its allOf members and the matching then / else.
export function appliedSchemas(
  root: JsonSchema,
  schema: JsonSchema,
  value: Record<string, unknown>,
  matchIf: IfMatcher
): JsonSchema[] {
  const applied: JsonSchema[] = [schema];
  const branch = (s: JsonSchema) => {
    if (!s.if) return;
    const chosen = matchIf(s.if, value) ? s.then : s.else;
    if (chosen) applied.push(resolveSchema(root, chosen).schema);
  };
  for (const member of schema.allOf ?? []) {
    const resolved = resolveSchema(root, member).schema;
    applied.push(resolved);
    branch(resolved);
  }
  branch(schema);
  return applied;
}

export function effectiveRequired(
  root: JsonSchema,
  schema: JsonSchema,
  object: Record<string, unknown>,
  matchIf: IfMatcher = simpleIfMatcher
): Set<string> {
  return new Set(appliedSchemas(root, schema, object, matchIf).flatMap((s) => s.required ?? []));
}

export function walkSchemaValue(
  root: JsonSchema,
  schema: JsonSchema,
  value: unknown,
  visit: (visit: WalkVisit) => void,
  options: { matchIf?: IfMatcher; pointer?: string; required?: boolean; depth?: number } = {}
): void {
  const { matchIf = simpleIfMatcher, pointer = "", required = true, depth = 0 } = options;
  if (depth > 24) return;
  const resolved = resolveSchema(root, schema);
  const current = resolved.schema;
  visit({ pointer, schema: current, defName: resolved.defName, value, required });

  // A locale map is a leaf for every consumer.
  if (current["x-localized"] === true) return;

  if (Array.isArray(value)) {
    if (current.items) {
      value.forEach((entry, index) => {
        walkSchemaValue(root, current.items as JsonSchema, entry, visit, {
          matchIf,
          pointer: joinPointer(pointer, index),
          required: true,
          depth: depth + 1,
        });
      });
    }
    return;
  }

  if (isPlainObject(value) || (value === undefined && required)) {
    const object = isPlainObject(value) ? value : {};
    const applied = appliedSchemas(root, current, object, matchIf);
    const requiredNames = new Set(applied.flatMap((s) => s.required ?? []));
    const properties: Record<string, JsonSchema> = Object.assign({}, ...applied.map((s) => s.properties ?? {}));
    for (const [name, sub] of Object.entries(properties)) {
      const present = name in object;
      // An absent OPTIONAL branch has nothing to check; an absent required one is a missing leaf.
      if (!present && !requiredNames.has(name)) continue;
      walkSchemaValue(root, sub, object[name], visit, {
        matchIf,
        pointer: joinPointer(pointer, name),
        required: requiredNames.has(name),
        depth: depth + 1,
      });
    }
  }
}
