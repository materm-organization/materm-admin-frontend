import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import type { JsonSchema } from "@/types/cms";

import { emitModule, generate, OUT_FILE, schemaHash } from "../../../../scripts/generate-schema-validators.mjs";
import shared from "../fixtures/edge-cases.shared.json";
import { SECTION_TYPE_FIXTURES, SECTION_TYPE_KEYS } from "../fixtures";
import type { Issue, ValidationMode } from "../types";
import { createSchemaValidator } from "../validate";
import { findPrecompiled, type PrecompiledEntry } from "./index";

// B7: validators compiled at build time (Ajv standalone) must behave exactly like the runtime Ajv ones, so the
// production CSP (no 'unsafe-eval') can keep client-side validation. The shared edge-case suite (the file the Go
// validator runs) is executed on both.
type EdgeCase = {
  id: string;
  section_type?: string;
  schema?: JsonSchema;
  mode: ValidationMode;
  default_locale?: string;
  props: unknown;
  expect: Array<{ path: string; code: string }>;
  go_only?: boolean;
};
const cases = (shared as unknown as { cases: EdgeCase[] }).cases.filter((c) => !c.go_only || c.id.startsWith("richtext-link-"));
const key = (i: { path: string; code: string }) => `${i.path} ${i.code}`;
const keys = (issues: Issue[]) => [...new Set(issues.map(key))].sort();

describe("generated validators are current", () => {
  it("validators.generated.js equals a fresh generation (run `npm run generate:validators`)", () => {
    expect(readFileSync(OUT_FILE, "utf8") === generate()).toBe(true);
  });

  it("has an entry for each of the 12 section types, keyed by the backend's schema_hash", () => {
    for (const k of SECTION_TYPE_KEYS) {
      const entry = findPrecompiled(schemaHash(SECTION_TYPE_FIXTURES[k].json_schema));
      expect(entry?.key, k).toBe(k);
    }
    // sha256(jsonb text) as computed by materm-admin-backend/pkg/contentschema (Registry.SchemaHash), pinned.
    expect(schemaHash(SECTION_TYPE_FIXTURES.about_blocks.json_schema)).toBe("67f38a1f0769fe3a8ad789de72b2b58d219f8f811274b14a70c838b8ffe4cd2c");
    expect(schemaHash(SECTION_TYPE_FIXTURES.faq.json_schema)).toBe("ac369a71481de651ffe1a0fdc8c96f50beb22bc5d09fc93cef6aa1ce7c3c3d20");
  });

  it("does not evaluate strings (no new Function / eval / require)", () => {
    const src = readFileSync(OUT_FILE, "utf8");
    expect(src).not.toMatch(/new Function|\beval\(|require\(/);
  });

  it("an unknown schema_hash gets no precompiled validator (runtime fallback)", () => {
    const schema = SECTION_TYPE_FIXTURES.faq.json_schema;
    expect(createSchemaValidator(schema, "0".repeat(64)).precompiled).toBe(false);
    expect(createSchemaValidator(schema).precompiled).toBe(false);
    expect(createSchemaValidator(schema, schemaHash(schema)).precompiled).toBe(true);
  });

  it("a hash whose entry does not cover the schema's `if` conditions is not used", () => {
    const schema = SECTION_TYPE_FIXTURES.faq.json_schema;
    const empty = (): PrecompiledEntry => ({ key: "x", version: 1, root: (() => true) as never, ifs: {} });
    const v = createSchemaValidator(schema, "h", () => empty());
    expect(v.precompiled).toBe(false);
  });
});

describe("shared edge cases on the precompiled section-type validators", () => {
  const typed = cases.filter((c) => c.section_type);
  it("covers the section-type cases", () => expect(typed.length).toBeGreaterThan(100));
  for (const c of typed) {
    it(c.id, () => {
      const schema = SECTION_TYPE_FIXTURES[c.section_type as string].json_schema;
      const pre = createSchemaValidator(schema, schemaHash(schema));
      expect(pre.precompiled).toBe(true);
      const opts = { mode: c.mode, defaultLocale: c.default_locale };
      const issues = pre.validate(c.props, opts);
      expect(keys(issues)).toEqual(keys(c.expect.map((e) => ({ ...e, keyword: "" }) as Issue)));
      // ... and identical to the runtime Ajv validator, issue for issue.
      expect(issues).toEqual(createSchemaValidator(schema).validate(c.props, opts));
    });
  }
});

describe("shared edge cases with inline schemas, standalone-compiled", () => {
  const inline = cases.filter((c) => c.schema);
  const dir = resolve(process.cwd(), "node_modules/.cache/schema-validators-test");
  mkdirSync(dir, { recursive: true });
  const items = inline.map((c, i) => ({ key: `inline-${i}`, version: 1, json_schema: c.schema as JsonSchema }));
  const file = resolve(dir, "inline.generated.mjs");
  writeFileSync(file, emitModule(items));
  const registry = import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<{ PRECOMPILED: Record<string, PrecompiledEntry> }>;

  it("has inline cases", () => expect(inline.length).toBeGreaterThan(10));
  for (const c of inline) {
    it(c.id, async () => {
      const { PRECOMPILED } = await registry;
      const schema = c.schema as JsonSchema;
      const pre = createSchemaValidator(schema, schemaHash(schema), (h) => (h ? PRECOMPILED[h] : undefined));
      expect(pre.precompiled).toBe(true);
      const opts = { mode: c.mode, defaultLocale: c.default_locale };
      const issues = pre.validate(c.props, opts);
      expect(keys(issues)).toEqual(keys(c.expect.map((e) => ({ ...e, keyword: "" }) as Issue)));
      expect(issues).toEqual(createSchemaValidator(schema).validate(c.props, opts));
    });
  }
});
