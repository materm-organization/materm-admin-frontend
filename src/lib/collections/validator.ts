import type { SchemaValidator } from "@/components/schema-form/validate";
import type { JsonSchema } from "@/types/cms";

import { checkEntryData } from "./data-check";

// The `SchemaValidator` of a collection entry's form: the hand-written conservative checker, never Ajv (no `new Function`, so it works
// under the production CSP). Draft = no `required` / `minLength` / `minItems`, like the server's draft mode.
export function createCollectionValidator(schema: JsonSchema): SchemaValidator {
  return {
    available: true,
    precompiled: true,
    validate: (props, options) => checkEntryData(schema, props, options.mode).map((i) => ({ ...i, keyword: "" })),
  };
}
