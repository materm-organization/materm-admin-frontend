// Precompiles the section-type schemas into static validator code (B7).
//
// Why: Ajv normally compiles a schema with `new Function`, which the production CSP (no 'unsafe-eval',
// src/lib/security/csp.ts) refuses. Ajv's standalone code generation emits the same validators as plain
// JavaScript at build time, so the browser never evaluates a string.
//
// Input : src/components/schema-form/fixtures/section-types/*.json (copies of doc/content-schemas; the shape of
//         `GET /section-types/{key}`).
// Output: src/components/schema-form/precompiled/validators.generated.js
//         - one entry per schema, keyed by its `schema_hash` (sha256 of the PostgreSQL jsonb text of the
//           json_schema, the same value the backend serves; the client looks a validator up by it, so a
//           schema that changed never gets an old validator);
//         - per entry: `root` (the whole schema) and `ifs`, the `if` conditions of the schema compiled on
//           their own (the form uses them to decide which `then`/`else` applies), keyed by canonical JSON.
//
// The options and the link pattern patch MUST equal src/components/schema-form/validate.ts (newAjv /
// patchLinkPattern); `validators.generated.test.ts` runs the shared edge-case suite on the output.
//
// Run: `npm run generate:validators` (also runs as `prebuild`). `--check` exits 1 when the committed file is stale.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TYPES_DIR = resolve(root, "src/components/schema-form/fixtures/section-types");
export const OUT_FILE = resolve(root, "src/components/schema-form/precompiled/validators.generated.js");

// Same constants as src/components/schema-form/link-rules.ts (read from there so there is one source).
function linkPatterns() {
  const src = readFileSync(resolve(root, "src/components/schema-form/link-rules.ts"), "utf8");
  const pick = (name) => {
    const m = src.match(new RegExp(`export const ${name} = ("(?:[^"\\\\]|\\\\.)*");`));
    if (!m) throw new Error(`${name} not found in link-rules.ts`);
    return JSON.parse(m[1]);
  };
  return { legacy: pick("LEGACY_LINK_URL_PATTERN"), portable: pick("PORTABLE_LINK_URL_PATTERN") };
}

// PostgreSQL jsonb::text, as materm-admin-backend/pkg/contentschema jsonbText: keys by length then bytewise,
// ": " and ", " separators, only quote/backslash/control characters escaped.
export function jsonbText(v) {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return jsonbString(v);
  if (Array.isArray(v)) return `[${v.map(jsonbText).join(", ")}]`;
  const keys = Object.keys(v).sort((a, b) => (a.length !== b.length ? a.length - b.length : Buffer.compare(Buffer.from(a), Buffer.from(b))));
  return `{${keys.map((k) => `${jsonbString(k)}: ${jsonbText(v[k])}`).join(", ")}}`;
}
function jsonbString(s) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20) out += `\\u${c.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return out + '"';
}
export const schemaHash = (schema) => createHash("sha256").update(jsonbText(schema), "utf8").digest("hex");

// Key order independent JSON (the runtime has the same function in precompiled/index.ts).
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

function patchLinkPattern(node, legacy, portable) {
  if (Array.isArray(node)) return node.map((n) => patchLinkPattern(n, legacy, portable));
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node).map(([k, v]) => [k, k === "pattern" && v === legacy ? portable : patchLinkPattern(v, legacy, portable)])
    );
  }
  return node;
}

// Every `if` condition of the schema (any depth).
function collectIfs(node, out) {
  if (Array.isArray(node)) node.forEach((n) => collectIfs(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "if" && v && typeof v === "object") out.set(canonicalJson(v), v);
      collectIfs(v, out);
    }
  }
}

// Same options as validate.ts newAjv().
export function newAjv(extra = {}) {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false, logger: false, ...extra });
  for (const keyword of ["x-localized", "x-multiline", "x-richtext", "x-ref"]) ajv.addKeyword({ keyword });
  return ajv;
}

export function loadSectionTypes() {
  return readdirSync(TYPES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(resolve(TYPES_DIR, f), "utf8")));
}

// The ESM module for a list of section-type-like items `{ key, version, json_schema }`: standalone validators of
// each schema (patched like validate.ts) and of each `if` condition, plus `PRECOMPILED` keyed by schema hash.
// Also used by the tests for the schemas of the shared edge cases that are not section types.
export function emitModule(items) {
  const { legacy, portable } = linkPatterns();
  const ajv = newAjv({ code: { source: true, esm: true, optimize: true } });
  const refs = {};
  const meta = [];
  for (const item of items) {
    const hash = schemaHash(item.json_schema);
    const schema = patchLinkPattern(item.json_schema, legacy, portable);
    const id = `t${meta.length}`;
    ajv.addSchema(schema, `${id}_root`);
    refs[`${id}_root`] = `${id}_root`;
    const ifs = new Map();
    collectIfs(schema, ifs);
    const ifIds = [];
    for (const [canon, cond] of [...ifs].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const ifId = `${id}_if${ifIds.length}`;
      // Like validate.ts ajvIfMatcher: `$defs` travel with the condition (only needed when it has a `$ref`).
      ajv.addSchema(JSON.stringify(cond).includes('"$ref"') ? { ...cond, $defs: schema.$defs } : cond, ifId);
      refs[ifId] = ifId;
      ifIds.push([canon, ifId]);
    }
    meta.push({ key: item.key, version: item.version, hash, rootId: `${id}_root`, ifIds });
  }
  let code = standaloneCode(ajv, refs);
  // Ajv's ESM output still says `require("ajv/dist/runtime/...").default` for two helpers; turn them into imports
  // (a namespace import + interop, because the helpers are CommonJS and Node / bundlers expose `default` differently).
  const helpers = [];
  code = code.replace(/const (func\d+) = require\("([^"]+)"\)\.default;/g, (_m, name, mod) => {
    helpers.push(`import * as ${name}_ns from "${mod}.js";`);
    return `const ${name} = interop(${name}_ns);`;
  });
  if (code.includes("require(")) throw new Error("standalone code still contains require()");
  code = code.replace(/^"use strict";/, "").replace(/;(const schema\d+ =|function validate\d+\()/g, ";\n$1");
  const lines = [
    "// GENERATED by scripts/generate-schema-validators.mjs (npm run generate:validators). Do not edit.",
    "// Precompiled Ajv validators of the section types, keyed by schema_hash. See that script.",
    "/* eslint-disable */",
    "// @ts-nocheck",
    ...[...new Set(helpers)],
    'const interop = (ns) => (typeof ns.default === "function" ? ns.default : ns.default.default);',
    code,
    "",
    "export const PRECOMPILED = {",
  ];
  for (const m of meta) {
    lines.push(
      `  ${JSON.stringify(m.hash)}: { key: ${JSON.stringify(m.key)}, version: ${m.version}, root: ${m.rootId}, ifs: { ${m.ifIds
        .map(([canon, id]) => `${JSON.stringify(canon)}: ${id}`)
        .join(", ")} } },`
    );
  }
  lines.push("};", "", "// `key@version` -> schema_hash, for fixtures / dev tools that have no server to ask.", "export const HASH_BY_TYPE = {");
  for (const m of meta) lines.push(`  ${JSON.stringify(`${m.key}@${m.version}`)}: ${JSON.stringify(m.hash)},`);
  lines.push("};", "");
  return lines.join("\n");
}

export const generate = () => emitModule(loadSectionTypes());

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const next = generate();
  if (process.argv.includes("--check")) {
    const cur = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, "utf8") : "";
    if (cur !== next) {
      console.error("validators.generated.js is stale: run `npm run generate:validators`");
      process.exit(1);
    }
  } else {
    writeFileSync(OUT_FILE, next);
    console.log(`wrote ${OUT_FILE}`);
  }
}
