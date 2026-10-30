import { HASH_BY_TYPE, PRECOMPILED, type PrecompiledEntry } from "./validators.generated";

// Validators compiled at build time by scripts/generate-schema-validators.mjs (Ajv standalone code), so that the
// browser never needs `new Function` and the production CSP can stay free of 'unsafe-eval' (B7).
// Looked up by the `schema_hash` the server sends with the section type: a hash this build does not know (a
// schema newer than the build) simply has no entry and the caller falls back to its old behaviour.

export type { PrecompiledEntry };

export function findPrecompiled(schemaHash: string | null | undefined): PrecompiledEntry | undefined {
  if (!schemaHash) return undefined;
  return Object.hasOwn(PRECOMPILED, schemaHash) ? PRECOMPILED[schemaHash] : undefined;
}

// Key-order independent JSON; the same function as `canonicalJson` of the generator script.
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

// The `if` conditions of a schema (any depth), by canonical JSON.
export function collectIfConditions(node: unknown, out = new Map<string, object>()): Map<string, object> {
  if (Array.isArray(node)) node.forEach((n) => collectIfConditions(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "if" && v && typeof v === "object") out.set(canonicalJson(v), v);
      collectIfConditions(v, out);
    }
  }
  return out;
}

// The schema_hash of a bundled section type (what `GET /section-types/{key}` returns for it), for the dev playground.
export function bundledSchemaHash(key: string, version: number): string | undefined {
  return HASH_BY_TYPE[`${key}@${version}`];
}
