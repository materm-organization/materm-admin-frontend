// Form state of a redirect and what leaves it (doc/05 section 6.10, doc/07 section 3.26, FR-SEO-05). Pure.
import type { ApiFieldError } from "@/types/api";
import type { CreateRedirectPayload, Redirect, RedirectCheckPayload, RedirectStatusCode, UpdateRedirectPayload } from "@/types/redirects";

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

// FR-SEO-05: a path that starts with `/`, lower case, without a trailing slash (`/` itself stays). The server does the same; doing it here too
// makes the check and the unique rule see the value that will be stored.
export function normalizeSource(value: string): string {
  let v = value.trim().toLowerCase();
  if (v === "") return "";
  if (!v.startsWith("/")) v = `/${v}`;
  while (v.length > 1 && v.endsWith("/")) v = v.slice(0, -1);
  return v;
}

export const normalizeTarget = (value: string): string => value.trim();

export const isInternalTarget = (target: string) => target.startsWith("/") && !target.startsWith("//");
export const isHttpsTarget = (target: string) => /^https:\/\/[^\s/]+/i.test(target);

const norm = (d: RedirectDraft) => ({
  sourcePath: normalizeSource(d.sourcePath),
  target: normalizeTarget(d.target),
  statusCode: d.statusCode,
  localeCode: d.localeCode,
  isActive: d.isActive,
  note: d.note.trim(),
});

export const isChanged = (saved: RedirectDraft, draft: RedirectDraft) => JSON.stringify(norm(saved)) !== JSON.stringify(norm(draft));

// The checks the form can do alone. Anything it can not know (a loop, a collision) comes back from the server.
export function validate(draft: RedirectDraft): ApiFieldError[] {
  const d = norm(draft);
  const errors: ApiFieldError[] = [];
  const raw = draft.sourcePath.trim();
  if (d.sourcePath === "") errors.push({ in: "body", path: "/source_path", code: "required" });
  else if (/[\s?#]|:\/\//.test(raw) || raw.startsWith("//")) errors.push({ in: "body", path: "/source_path", code: "pattern_mismatch" });
  else if ([...d.sourcePath].length > MAX_SOURCE) errors.push({ in: "body", path: "/source_path", code: "too_long", params: { max: MAX_SOURCE } });
  if (d.target === "") errors.push({ in: "body", path: "/target", code: "required" });
  else if (/\s/.test(d.target) || !(isInternalTarget(d.target) || isHttpsTarget(d.target))) errors.push({ in: "body", path: "/target", code: "pattern_mismatch" });
  else if ([...d.target].length > MAX_TARGET) errors.push({ in: "body", path: "/target", code: "too_long", params: { max: MAX_TARGET } });
  else if (d.sourcePath !== "" && d.target === d.sourcePath) errors.push({ in: "body", path: "/target", code: "target_equals_source" });
  if ([...d.note].length > MAX_NOTE) errors.push({ in: "body", path: "/note", code: "too_long", params: { max: MAX_NOTE } });
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

// The state in the shape of a revision snapshot (doc/05 11.7 item 3; PROVISIONAL: `{ redirect: {...} }`).
export function rowSnapshot(row: Redirect): Record<string, unknown> {
  return {
    redirect: { source_path: row.source_path, locale_code: row.locale_code, target: row.target, status_code: row.status_code, is_active: row.is_active, note: row.note },
  };
}

// `null` while the form still has an error of its own: nothing to ask the server yet.
export function checkPayload(draft: RedirectDraft, id?: number): RedirectCheckPayload | null {
  if (validate(draft).length > 0) return null;
  const d = norm(draft);
  return { source_path: d.sourcePath, target: d.target, status_code: d.statusCode, locale_code: d.localeCode === "" ? null : d.localeCode, ...(id !== undefined ? { id } : {}) };
}
