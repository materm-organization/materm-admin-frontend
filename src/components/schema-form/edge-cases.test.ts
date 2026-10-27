import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import shared from "./fixtures/edge-cases.shared.json";
import { SECTION_TYPE_FIXTURES } from "./fixtures";
import type { JsonSchema } from "@/types/cms";
import type { ValidationMode } from "./types";
import { createSchemaValidator } from "./validate";

// The shared edge-case suite of the props validator (doc/10 R-015): the SAME file the Go validator runs
// (materm-admin-backend/pkg/contentschema/testdata/edge-cases.json; format and rules in its README.md). The copy
// in fixtures/ keeps this test running where the backend repo is not checked out; the drift test compares the
// two when it is.
type EdgeCase = {
  id: string;
  section_type?: string;
  schema?: JsonSchema;
  mode: ValidationMode;
  default_locale?: string;
  props: unknown;
  expect: Array<{ path: string; code: string }>;
  go_only?: boolean;
  requires?: string[];
};

const cases = (shared as unknown as { cases: EdgeCase[] }).cases;
const key = (i: { path: string; code: string }) => `${i.path} ${i.code}`;

// `go_only` = depends on something Go does and the browser should not (the full rich-text allow-list, known
// locale codes, numbers beyond a double). The `richtext-link-*` cases are the exception: the browser checks the
// same link rule, so they run here too.
const runsHere = (c: EdgeCase) => !c.go_only || c.id.startsWith("richtext-link-");

const validators = new Map<string, ReturnType<typeof createSchemaValidator>>();
function validatorFor(c: EdgeCase) {
  const id = c.section_type ?? c.id;
  let v = validators.get(id);
  if (!v) {
    const schema = c.schema ?? SECTION_TYPE_FIXTURES[c.section_type as string].json_schema;
    v = createSchemaValidator(schema);
    validators.set(id, v);
  }
  return v;
}

describe("shared edge cases (R-015, R-016)", () => {
  it("is the documented suite", () => {
    expect((shared as { format: number }).format).toBe(1);
    expect(cases.length).toBeGreaterThan(100);
    expect(cases.filter(runsHere).length).toBeGreaterThan(100);
  });

  for (const c of cases.filter(runsHere)) {
    it(c.id, () => {
      const issues = validatorFor(c).validate(c.props, { mode: c.mode, defaultLocale: c.default_locale });
      expect([...new Set(issues.map(key))].sort()).toEqual([...new Set(c.expect.map(key))].sort());
    });
  }
});

// Vitest runs from the repo root (see vitest.config.mts).
const backendFile = resolve(process.cwd(), "../materm-admin-backend/pkg/contentschema/testdata/edge-cases.json");
describe.skipIf(!existsSync(backendFile))("shared edge cases: the copy in fixtures/ is current", () => {
  it("equals the backend file", () => {
    expect(JSON.parse(readFileSync(backendFile, "utf8"))).toEqual(shared);
  });
});
