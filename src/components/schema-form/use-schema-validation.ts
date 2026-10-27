"use client";

import { useMemo } from "react";

import type { SectionType } from "@/types/cms";

import { computeCompleteness, type CompletenessOptions, type LocaleCompleteness } from "./completeness";
import { getSchemaValidator, type MediaLookup } from "./validate";
import type { Issue, ValidationMode } from "./types";
import { useDebouncedValue } from "./widgets/use-debounced";

export type SchemaFormValidation = {
  issues: Issue[];
  completeness: Record<string, LocaleCompleteness>;
  // false: Ajv could not compile here (CSP without 'unsafe-eval'); `issues` is then empty and the server decides.
  validatorAvailable: boolean;
};

export type UseSchemaValidationOptions = {
  mode: ValidationMode;
  defaultLocale: string;
  localeCodes: string[];
  // Debounce after typing (doc/07 section 4.1: 300 ms). 0 validates on every render.
  delayMs?: number;
  media?: MediaLookup;
  mediaAlt?: CompletenessOptions["media"];
};

export function schemaCacheKey(type: Pick<SectionType, "key" | "version" | "schema_hash">): string {
  return `${type.key}@${type.version}#${type.schema_hash ?? ""}`;
}

// Draft / publish validation + per-locale completeness of one section's props, shared by `SchemaForm` and by
// the page editor (publish bar, section list badges). The mode switches immediately; edits are debounced.
export function useSchemaValidation(
  type: Pick<SectionType, "key" | "version" | "schema_hash" | "json_schema">,
  props: unknown,
  { mode, defaultLocale, localeCodes, delayMs = 300, media, mediaAlt }: UseSchemaValidationOptions
): SchemaFormValidation {
  const settled = useDebouncedValue(props, delayMs);
  const schema = type.json_schema;
  const cacheKey = schemaCacheKey(type);
  const validator = useMemo(() => getSchemaValidator(schema, cacheKey), [schema, cacheKey]);
  const issues = useMemo(
    () => validator.validate(settled, { mode, defaultLocale, media }),
    [validator, settled, mode, defaultLocale, media]
  );
  const codesKey = localeCodes.join(",");
  const completeness = useMemo(
    () => computeCompleteness(schema, settled, codesKey ? codesKey.split(",") : [], { media: mediaAlt }),
    [schema, settled, codesKey, mediaAlt]
  );
  // Stable identity while nothing changed: callers hand it to effects (`onValidationChange`).
  return useMemo(() => ({ issues, completeness, validatorAvailable: validator.available }), [issues, completeness, validator]);
}
