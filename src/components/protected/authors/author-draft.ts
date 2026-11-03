// Form state of an author and what leaves it (doc/05 section 15.2 / 15.3, doc/07 section 3.16). Pure.
import type { ApiFieldError } from "@/types/api";
import type { Author, AuthorSnapshot, AuthorTranslationInput, AuthorUserRef, CreateAuthorPayload, UpdateAuthorPayload } from "@/types/authors";

export const MAX_DISPLAY_NAME = 120;
export const MAX_BIO = 2000;
export const MAX_JOB_TITLE = 120;

export type AuthorLocaleDraft = { bio: string; jobTitle: string };
export type AuthorDraft = {
  displayName: string;
  userId: number | null;
  // Only to show who is linked (the draft sends `userId`).
  user: AuthorUserRef | null;
  avatarId: number | null;
  isActive: boolean;
  translations: Record<string, AuthorLocaleDraft>;
};

export const emptyAuthorDraft = (locales: readonly string[]): AuthorDraft => ({
  displayName: "",
  userId: null,
  user: null,
  avatarId: null,
  isActive: true,
  translations: Object.fromEntries(locales.map((c) => [c, { bio: "", jobTitle: "" }])),
});

export function draftFromAuthor(row: Author, locales: readonly string[]): AuthorDraft {
  const codes = [...new Set([...locales, ...Object.keys(row.translations)])];
  return {
    displayName: row.display_name,
    userId: row.user_id,
    user: row.user,
    avatarId: row.avatar_media_id,
    isActive: row.is_active,
    translations: Object.fromEntries(codes.map((c) => [c, { bio: row.translations[c]?.bio ?? "", jobTitle: row.translations[c]?.job_title ?? "" }])),
  };
}

const norm = (t: AuthorLocaleDraft | undefined) => ({ bio: (t?.bio ?? "").trim(), jobTitle: (t?.jobTitle ?? "").trim() });
const orNull = (v: string) => (v === "" ? null : v);
const changedLocales = (saved: AuthorDraft, draft: AuthorDraft) =>
  Object.keys(draft.translations).filter((c) => JSON.stringify(norm(draft.translations[c])) !== JSON.stringify(norm(saved.translations[c])));

export const isChanged = (saved: AuthorDraft, draft: AuthorDraft) =>
  saved.displayName.trim() !== draft.displayName.trim() ||
  saved.userId !== draft.userId ||
  saved.avatarId !== draft.avatarId ||
  saved.isActive !== draft.isActive ||
  changedLocales(saved, draft).length > 0;

export function validate(draft: AuthorDraft): ApiFieldError[] {
  const errors: ApiFieldError[] = [];
  const add = (path: string, code: string, params?: ApiFieldError["params"]) => errors.push({ in: "body", path, code, ...(params ? { params } : {}) });
  const name = [...draft.displayName.trim()];
  if (name.length === 0) add("/display_name", "required");
  else if (name.length > MAX_DISPLAY_NAME) add("/display_name", "too_long", { max: MAX_DISPLAY_NAME });
  for (const [code, t] of Object.entries(draft.translations)) {
    if ([...t.bio.trim()].length > MAX_BIO) add(`/translations/${code}/bio`, "too_long", { max: MAX_BIO });
    if ([...t.jobTitle.trim()].length > MAX_JOB_TITLE) add(`/translations/${code}/job_title`, "too_long", { max: MAX_JOB_TITLE });
  }
  return errors;
}

export function buildCreatePayload(draft: AuthorDraft): CreateAuthorPayload {
  const translations: Record<string, AuthorTranslationInput> = {};
  for (const [code, t] of Object.entries(draft.translations)) {
    const n = norm(t);
    if (n.bio || n.jobTitle) translations[code] = { bio: orNull(n.bio), job_title: orNull(n.jobTitle) };
  }
  return {
    display_name: draft.displayName.trim(),
    ...(draft.userId !== null ? { user_id: draft.userId } : {}),
    ...(draft.avatarId !== null ? { avatar_media_id: draft.avatarId } : {}),
    is_active: draft.isActive,
    ...(Object.keys(translations).length ? { translations } : {}),
  };
}

// PATCH: only what changed. A translate-only caller (05 15.3) sends the bio / job title of the languages that are not the default one
// and never deletes a language (a whole language is never `null`; a cleared member is).
export function buildUpdatePayload(saved: AuthorDraft, draft: AuthorDraft, defaultLocale: string, options: { translateOnly?: boolean } = {}): UpdateAuthorPayload {
  const out: UpdateAuthorPayload = {};
  if (!options.translateOnly) {
    if (saved.displayName.trim() !== draft.displayName.trim()) out.display_name = draft.displayName.trim();
    if (saved.userId !== draft.userId) out.user_id = draft.userId;
    if (saved.avatarId !== draft.avatarId) out.avatar_media_id = draft.avatarId;
    if (saved.isActive !== draft.isActive) out.is_active = draft.isActive;
  }
  const translations: Record<string, AuthorTranslationInput> = {};
  for (const code of changedLocales(saved, draft)) {
    if (options.translateOnly && code === defaultLocale) continue;
    const was = norm(saved.translations[code]);
    const now = norm(draft.translations[code]);
    const diff: AuthorTranslationInput = {};
    if (now.bio !== was.bio) diff.bio = orNull(now.bio);
    if (now.jobTitle !== was.jobTitle) diff.job_title = orNull(now.jobTitle);
    if (Object.keys(diff).length) translations[code] = diff;
  }
  if (Object.keys(translations).length) out.translations = translations;
  return out;
}

// The row in the shape of a revision snapshot (doc/05 15.4), for the "current state" column of the history.
export function rowSnapshot(row: Author): AuthorSnapshot {
  return {
    author: { display_name: row.display_name, user_id: row.user_id, avatar_media_id: row.avatar_media_id, is_active: row.is_active },
    translations: Object.entries(row.translations).map(([locale_code, t]) => ({ locale_code, bio: t.bio ?? null, job_title: t.job_title ?? null })),
  };
}
