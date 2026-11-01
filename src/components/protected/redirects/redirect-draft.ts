// Form state of a redirect and what leaves it (doc/05 section 14, doc/07 section 3.26, FR-SEO-05). Pure.
import type { ApiFieldError } from "@/types/api";
import type { CreateRedirectPayload, Redirect, RedirectCheckPayload, RedirectSnapshot, RedirectStatusCode, UpdateRedirectPayload } from "@/types/redirects";

export const STATUS_CODES: readonly RedirectStatusCode[] = [301, 302, 307, 308];
export const MAX_SOURCE = 500;
export const MAX_TARGET = 2000;
export const MAX_NOTE = 500;

export type RedirectDraft = {
  sourcePath: string;
  target: string;
  statusCode: RedirectStatusCode;
  // "" = every language.
  localeCode: string;
  isActive: boolean;
  note: string;
};

export const emptyRedirectDraft = (): RedirectDraft => ({ sourcePath: "", target: "", statusCode: 301, localeCode: "", isActive: true, note: "" });

export const draftFromRow = (row: Redirect): RedirectDraft => ({
  sourcePath: row.source_path,
  target: row.target,
  statusCode: row.status_code,
  localeCode: row.locale_code ?? "",
  isActive: row.is_active,
  note: row.note ?? "",
});

// FR-SEO-05 (doc/05 14.2): the server stores the source lower case, trimmed, without a trailing slash (`/` itself stays). It does NOT add
// a leading slash (that is the rule `must_start_with_slash`). Doing the same here makes the check see the value that will be stored.
export function normalizeSource(value: string): string {
  let v = value.trim().toLowerCase();
  while (v.length > 1 && v.endsWith("/")) v = v.slice(0, -1);
  return v;
}

export const normalizeTarget = (value: string): string => value.trim();

export const isInternalTarget = (target: string) => target.startsWith("/") && !target.startsWith("//");

const norm = (d: RedirectDraft) => ({
  sourcePath: normalizeSource(d.sourcePath),
  target: normalizeTarget(d.target),
  statusCode: d.statusCode,
  localeCode: d.localeCode,
  isActive: d.isActive,
  note: d.note.trim(),
});

export const isChanged = (saved: RedirectDraft, draft: RedirectDraft) => JSON.stringify(norm(saved)) !== JSON.stringify(norm(draft));

const WHITESPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/;
const err = (path: string, code: string, params?: ApiFieldError["params"]): ApiFieldError => ({ in: "body", path, code, ...(params ? { params } : {}) });

// The rule of `pattern_mismatch` a source path breaks first (doc/05 14.2), or null.
export function sourceRule(source: string): string | null {
  if (!source.startsWith("/")) return "must_start_with_slash";
  if (source.startsWith("//")) return "protocol_relative";
  if (/[?#]/.test(source)) return "no_query_or_fragment";
  if (source.includes("\\")) return "no_backslash";
  if (WHITESPACE_OR_CONTROL.test(source)) return "no_whitespace_or_control";
  const segments = source.slice(1).split("/");
  if (source.length > 1 && segments.some((s) => s === "")) return "empty_segment";
  if (segments.some((s) => s === "." || s === "..")) return "dot_segment";
  return null;
}

// The internal target in the form the server compares with the source of the same redirect (no query / fragment, lower case, no trailing /).
const comparable = (target: string) => normalizeSource(target.replace(/[?#].*$/, ""));

// The checks the form can do alone; the codes and params are the server's (doc/05 14.2). Anything it can not know (a loop, a chain,
// a taken address) comes back from the check / the write.
export function validate(draft: RedirectDraft): ApiFieldError[] {
  const d = norm(draft);
  const errors: ApiFieldError[] = [];
  if (d.sourcePath === "") errors.push(err("/source_path", "required"));
  else if ([...d.sourcePath].length > MAX_SOURCE) errors.push(err("/source_path", "too_long", { max: MAX_SOURCE }));
  else {
    const rule = sourceRule(d.sourcePath);
    if (rule) errors.push(err("/source_path", "pattern_mismatch", { rule }));
  }
  if (d.target === "") errors.push(err("/target", "required"));
  else if ([...d.target].length > MAX_TARGET) errors.push(err("/target", "too_long", { max: MAX_TARGET }));
  else if (WHITESPACE_OR_CONTROL.test(d.target)) errors.push(err("/target", "pattern_mismatch", { rule: "no_whitespace_or_control" }));
  else if (d.target.includes("\\")) errors.push(err("/target", "pattern_mismatch", { rule: "no_backslash" }));
  else if (d.target.startsWith("//")) errors.push(err("/target", "pattern_mismatch", { rule: "protocol_relative" }));
  else if (d.target.startsWith("/")) {
    if (sourceRule(d.sourcePath) === null && comparable(d.target) === d.sourcePath) errors.push(err("/target", "self_redirect", { path: d.sourcePath }));
  } else {
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(d.target)?.[1]?.toLowerCase();
    if (scheme === "https") {
      const authority = d.target.replace(/^https:\/\//i, "").split(/[/?#]/)[0];
      if (!/^https:\/\//i.test(d.target)) errors.push(err("/target", "path_or_https_url"));
      else if (authority.includes("@")) errors.push(err("/target", "userinfo_not_allowed"));
      else if (authority === "" || authority.startsWith(":")) errors.push(err("/target", "host_required"));
    } else if (scheme === "http") errors.push(err("/target", "https_only"));
    else if (scheme && ["javascript", "data", "vbscript", "file", "ftp"].includes(scheme)) errors.push(err("/target", "scheme_not_allowed"));
    else errors.push(err("/target", "path_or_https_url"));
  }
  if ([...d.note].length > MAX_NOTE) errors.push(err("/note", "too_long", { max: MAX_NOTE }));
  return errors;
}

export function buildCreatePayload(draft: RedirectDraft): CreateRedirectPayload {
  const d = norm(draft);
  return {
    source_path: d.sourcePath,
    target: d.target,
    status_code: d.statusCode,
    locale_code: d.localeCode === "" ? null : d.localeCode,
    is_active: d.isActive,
    note: d.note === "" ? null : d.note,
  };
}

// Only what changed (a PATCH with no change is not sent).
export function buildUpdatePayload(saved: RedirectDraft, draft: RedirectDraft): UpdateRedirectPayload {
  const a = norm(saved);
  const b = norm(draft);
  const out: UpdateRedirectPayload = {};
  if (a.sourcePath !== b.sourcePath) out.source_path = b.sourcePath;
  if (a.target !== b.target) out.target = b.target;
  if (a.statusCode !== b.statusCode) out.status_code = b.statusCode;
  if (a.localeCode !== b.localeCode) out.locale_code = b.localeCode === "" ? null : b.localeCode;
  if (a.isActive !== b.isActive) out.is_active = b.isActive;
  if (a.note !== b.note) out.note = b.note === "" ? null : b.note;
  return out;
}

// The state in the shape of a revision snapshot (doc/05 14.6): FLAT, no wrapper.
export function rowSnapshot(row: Redirect): RedirectSnapshot {
  return { source_path: row.source_path, locale_code: row.locale_code, target: row.target, status_code: row.status_code, is_active: row.is_active, note: row.note };
}

// `null` while the form still has an error of its own: nothing to ask the server yet.
export function checkPayload(draft: RedirectDraft, id?: number): RedirectCheckPayload | null {
  if (validate(draft).length > 0) return null;
  const d = norm(draft);
  return {
    source_path: d.sourcePath,
    target: d.target,
    status_code: d.statusCode,
    locale_code: d.localeCode === "" ? null : d.localeCode,
    is_active: d.isActive,
    ...(id !== undefined ? { id } : {}),
  };
}
