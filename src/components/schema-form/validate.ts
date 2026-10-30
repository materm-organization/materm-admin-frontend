import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";

import type { JsonSchema } from "@/types/cms";

import { LEGACY_LINK_URL_PATTERN, PORTABLE_LINK_URL_PATTERN, isSafeRichLinkHref } from "./link-rules";
import { canonicalJson, collectIfConditions, findPrecompiled, type PrecompiledEntry } from "./precompiled";
import { escapePointerSegment, joinPointer, parsePointer, pointerFromSegments } from "./pointer";
import { collectRichTextLinks, isRichTextEmpty } from "./richtext-doc";
import { isPlainObject, walkSchemaValue, type IfMatcher } from "./schema-walker";
import type { Issue, ValidationMode } from "./types";

// Client-side validation of a section's props (doc/07 section 4.5, doc/04 section 6.1, doc/10 R-015).
//
// It reproduces the backend validator (materm-admin-backend/pkg/contentschema; rules and the keyword -> code
// mapping in its testdata/README.md, the shared suite is fixtures/edge-cases.shared.json): ONE compiled Ajv
// validator per schema, the two modes differ only in what is done with its result:
//   draft   -> every keyword EXCEPT `required`, `minLength`, `minProperties` (a half-filled form saves)
//   publish -> everything, plus: every required x-localized leaf must be non-blank in the DEFAULT locale
// The schema is never edited to get draft mode (`$defs/link` has `not: {anyOf: [{required: [url]}]}` and
// `if: {required: [type]}`, where `required` is a condition). Ajv's synthetic `if` error is dropped.
// R-016: the legacy `link.url` pattern (accepts `//host`, `/\host`) is replaced by the portable one.

const DRAFT_SKIPPED_KEYWORDS = new Set(["required", "minLength", "minProperties"]);

export type ValidatorUnavailable = { reason: "csp"; message: string };

export type SchemaValidator = {
  // false when `ajv.compile` was refused (CSP without 'unsafe-eval'); then `validate` returns [] and the form
  // shows a notice - the server validates on save anyway.
  available: boolean;
  // true: the validators were compiled at build time (no `new Function`, works under the production CSP).
  precompiled?: boolean;
  unavailable?: ValidatorUnavailable;
  validate: (props: unknown, options: ValidateOptions) => Issue[];
};

export type MediaLookup = (mediaId: number) => { status?: string; alt?: Record<string, string> } | undefined;

export type ValidateOptions = {
  mode: ValidationMode;
  // Required for `publish`: the locale every required localized leaf must be filled in.
  defaultLocale?: string;
  // Optional (BR-14): the media library rows referenced by the props. Unknown ids are not checked.
  media?: MediaLookup;
};

function newAjv(): Ajv2020 {
  // Like the backend's reference runner: formats are annotations, unknown keywords are tolerated (the server
  // owns the schemas), `x-*` annotation keywords are known.
  // `logger: false`: Ajv would print the generated code to the console when the CSP refuses to evaluate it; the
  // validator reports that itself (see `createSchemaValidator`).
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false, logger: false });
  for (const keyword of ["x-localized", "x-multiline", "x-richtext", "x-ref"]) ajv.addKeyword({ keyword });
  return ajv;
}

// R-016 until doc/04 and the content schemas carry the fixed pattern.
function patchLinkPattern<T>(node: T): T {
  if (Array.isArray(node)) return node.map(patchLinkPattern) as T;
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = key === "pattern" && value === LEGACY_LINK_URL_PATTERN ? PORTABLE_LINK_URL_PATTERN : patchLinkPattern(value);
    }
    return out as T;
  }
  return node;
}

function isCspError(error: unknown): boolean {
  if (typeof EvalError !== "undefined" && error instanceof EvalError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /unsafe-eval|content security policy|code generation from strings/i.test(message);
}

function valueAt(root: unknown, instancePath: string): unknown {
  let node: unknown = root;
  for (const segment of parsePointer(instancePath)) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

function schemaAt(root: JsonSchema, schemaPath: string): unknown {
  return schemaPath
    .slice(2)
    .split("/")
    .filter(Boolean)
    .reduce<unknown>((node, token) => (node as Record<string, unknown> | undefined)?.[token.replaceAll("~1", "/").replaceAll("~0", "~")], root);
}

// A `not` that only lists properties (`not: {required: [..]}` / `not: {anyOf: [{required}, ...]}`): the names it forbids.
function presenceNames(not: unknown): string[] | null {
  const names: string[] = [];
  const onlyRequired = (s: unknown) => {
    if (!s || typeof s !== "object") return false;
    const keys = Object.keys(s);
    const required = (s as { required?: unknown }).required;
    if (keys.length !== 1 || !Array.isArray(required)) return false;
    names.push(...(required as string[]));
    return true;
  };
  if (!not || typeof not !== "object") return null;
  const anyOf = (not as { anyOf?: unknown }).anyOf;
  if (Object.keys(not).length === 1 && Array.isArray(anyOf)) return anyOf.every(onlyRequired) ? names : null;
  return onlyRequired(not) ? names : null;
}

// Ajv errors -> issues (same vocabulary as the server's `errors[]`, doc/05 section 1.5).
function mapErrors(errors: ErrorObject[], schema: JsonSchema, data: unknown): Issue[] {
  const out: Issue[] = [];
  const add = (path: string, code: string, keyword: string, params?: Issue["params"]) =>
    out.push({ path, code, keyword, params });
  for (const e of errors) {
    // Errors of the branches of anyOf / oneOf are noise next to the single `no_match` of their parent.
    if (/\/(anyOf|oneOf)\/\d+\//.test(e.schemaPath)) continue;
    // propertyNames: the nested error sits on the object and names the key in `propertyName`.
    const path = e.propertyName !== undefined ? joinPointer(e.instancePath, e.propertyName) : e.instancePath;
    const p = e.params as Record<string, unknown>;
    switch (e.keyword) {
      case "type":
        add(path, "invalid_type", e.keyword, { expected: Array.isArray(p.type) ? (p.type as string[]) : String(p.type) });
        break;
      case "required":
        add(joinPointer(path, String(p.missingProperty)), "required", e.keyword);
        break;
      case "enum":
      case "const":
        add(path, "not_in_enum", e.keyword);
        break;
      case "pattern":
        add(path, "pattern_mismatch", e.keyword);
        break;
      case "propertyNames":
        break; // the nested pattern error already carries the key
      case "maxLength":
      case "maxItems":
      case "maxProperties":
        add(path, "too_long", e.keyword, { max: Number(p.limit) });
        break;
      case "minLength":
      case "minItems":
      case "minProperties":
        add(path, "too_short", e.keyword, { min: Number(p.limit) });
        break;
      case "minimum":
      case "exclusiveMinimum":
        add(path, "out_of_range", e.keyword, { min: Number(p.limit) });
        break;
      case "maximum":
      case "exclusiveMaximum":
        add(path, "out_of_range", e.keyword, { max: Number(p.limit) });
        break;
      case "additionalProperties":
        add(joinPointer(path, String(p.additionalProperty)), "unknown_field", e.keyword);
        break;
      case "uniqueItems":
        add(joinPointer(path, Math.max(Number(p.i), Number(p.j))), "duplicate", e.keyword);
        break;
      case "anyOf":
      case "oneOf":
        add(path, "no_match", e.keyword);
        break;
      case "if":
        break; // Ajv's synthetic "must match then/else" error
      case "not": {
        const names = presenceNames(schemaAt(schema, e.schemaPath));
        const base = valueAt(data, e.instancePath);
        const present = names && base && typeof base === "object" ? names.filter((n) => n in (base as object)) : [];
        if (present.length > 0) present.forEach((n) => add(joinPointer(path, n), "unknown_field", e.keyword));
        else add(path, "forbidden", e.keyword);
        break;
      }
      default:
        add(path, "invalid_value", e.keyword);
    }
  }
  return out;
}

// What a node's `if` decides, exactly (the walker's own matcher only reads const / enum / required).
function ajvIfMatcher(rootSchema: JsonSchema): IfMatcher {
  const compiled = new WeakMap<object, ValidateFunction>();
  const ajv = newAjv();
  return (condition, value) => {
    let fn = compiled.get(condition);
    if (!fn) {
      fn = ajv.compile({ ...condition, $defs: rootSchema.$defs });
      compiled.set(condition, fn);
    }
    return fn(value) === true;
  };
}

// Rules the schema cannot express (publish, BR-13 / BR-14; rich-text hrefs, R-016).
function extraIssues(root: JsonSchema, props: unknown, options: ValidateOptions, matchIf: IfMatcher): Issue[] {
  const issues: Issue[] = [];
  const locale = options.defaultLocale;
  walkSchemaValue(
    root,
    root,
    props,
    ({ schema, defName, value, pointer, required }) => {
      // Rich-text link marks: https / mailto / tel / `/path` only (no `//host`, no `#anchor`).
      if (schema["x-richtext"] && isPlainObject(value)) {
        for (const [code, doc] of Object.entries(value)) {
          for (const link of collectRichTextLinks(doc)) {
            if (!isSafeRichLinkHref(link.href)) {
              issues.push({
                path: pointerFromSegments([...parsePointer(pointer), code, ...link.path, "attrs", "href"]),
                code: "pattern_mismatch",
                keyword: "rich_text_link",
              });
            }
          }
        }
      }

      if (options.mode !== "publish" || !locale) return;

      // A required localized leaf must be filled in the default locale. A leaf that is absent entirely is
      // already reported by the schema's `required` at the leaf, so only a PRESENT map is checked.
      if (schema["x-localized"] === true && required && isPlainObject(value)) {
        const entry = value[locale];
        const filled = schema["x-richtext"] ? !isRichTextEmpty(entry) : typeof entry === "string" && entry.trim() !== "";
        if (!filled) {
          issues.push({ path: joinPointer(pointer, locale), code: "required", keyword: "default_locale", params: { locale } });
        }
      }

      // BR-14: a placed image needs an alt in the default locale unless it is decorative, and the media row
      // must be ready. Only for media rows the caller could load.
      if (defName === "image" && isPlainObject(value) && typeof value.media_id === "number" && options.media) {
        const media = options.media(value.media_id);
        if (media) {
          if (media.status && media.status !== "ready") {
            issues.push({ path: joinPointer(pointer, "media_id"), code: "unknown_reference", keyword: "media_status" });
          }
          const alt = isPlainObject(value.alt) ? (value.alt[locale] as string | undefined) : undefined;
          if (value.decorative !== true && !alt?.trim() && !media.alt?.[locale]?.trim()) {
            issues.push({
              path: joinPointer(joinPointer(pointer, "alt"), escapePointerSegment(locale)),
              code: "required",
              keyword: "media_alt",
            });
          }
        }
      }
    },
    { matchIf }
  );
  return issues;
}

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.path}\u0000${issue.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// The build-time validators of this schema, when `schemaHash` is known to the build AND every `if` condition of the
// schema has its own precompiled validator (otherwise the entry is not for this schema: use the runtime path).
function usablePrecompiled(
  schema: JsonSchema,
  schemaHash: string | null | undefined,
  lookup: typeof findPrecompiled
): PrecompiledEntry | undefined {
  const entry = lookup(schemaHash);
  if (!entry) return undefined;
  for (const key of collectIfConditions(schema).keys()) if (!Object.hasOwn(entry.ifs, key)) return undefined;
  return entry;
}

// `schemaHash` = `schema_hash` of the section type from the server: with it a precompiled validator is used when
// this build carries one (it does not need `new Function`); without it, or when unknown, Ajv compiles at run time.
// `lookup` is for tests (a registry other than the committed one).
export function createSchemaValidator(
  schemaIn: JsonSchema,
  schemaHash?: string | null,
  lookup: typeof findPrecompiled = findPrecompiled
): SchemaValidator {
  const schema = patchLinkPattern(schemaIn);
  let compiled: ValidateFunction;
  let matchIf: IfMatcher | undefined;
  const pre = usablePrecompiled(schema, schemaHash, lookup);
  try {
    if (pre) {
      compiled = pre.root as unknown as ValidateFunction;
      matchIf = (condition, value) => pre.ifs[canonicalJson(condition)](value) === true;
    } else {
      compiled = newAjv().compile(schema);
      matchIf = ajvIfMatcher(schema);
    }
  } catch (error) {
    if (!isCspError(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (typeof console !== "undefined") {
      console.warn(
        "[schema-form] Ajv cannot compile schemas here (Content-Security-Policy without 'unsafe-eval'); " +
          "client-side validation is off, the server still validates on save."
      );
    }
    return { available: false, unavailable: { reason: "csp", message }, validate: () => [] };
  }
  return {
    available: true,
    precompiled: Boolean(pre),
    validate(props, options) {
      compiled(props);
      let errors = compiled.errors ?? [];
      if (options.mode === "draft") errors = errors.filter((e) => !DRAFT_SKIPPED_KEYWORDS.has(e.keyword));
      const issues = mapErrors(errors, schema, props);
      issues.push(...extraIssues(schema, props, options, matchIf as IfMatcher));
      return dedupe(issues);
    },
  };
}

const cache = new Map<string, SchemaValidator>();

// One validator per `key@version#schema_hash` (compile once; doc/07 section 4.1). Without a cache key the
// schema is compiled every time - pass one.
export function getSchemaValidator(schema: JsonSchema, cacheKey?: string, schemaHash?: string | null): SchemaValidator {
  if (!cacheKey) return createSchemaValidator(schema, schemaHash);
  let validator = cache.get(cacheKey);
  if (!validator) {
    validator = createSchemaValidator(schema, schemaHash);
    cache.set(cacheKey, validator);
  }
  return validator;
}

export function clearSchemaValidatorCache() {
  cache.clear();
}
