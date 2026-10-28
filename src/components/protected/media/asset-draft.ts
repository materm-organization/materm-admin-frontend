// The edit state of the asset detail sheet and the PATCH body made from it (doc/05 section 11.6): only what
// changed is sent, a cleared caption / credit is `null`, focal values are 3 decimals, a language the form does
// not offer (inactive) is never touched.
import { roundFocal } from "@/lib/media";
import type { MediaAsset, MediaAssetTranslation, MediaFocal, UpdateMediaAssetPayload } from "@/types/media";

export type TranslationDraft = { alt: string; caption: string; credit: string };

export type AssetDraft = {
  folder_id: number | null;
  is_decorative: boolean;
  focal: MediaFocal;
  translations: Record<string, TranslationDraft>;
};

export const MAX_ALT = 250;
export const MAX_CAPTION = 500;
export const MAX_CREDIT = 200;

const emptyTranslation = (): TranslationDraft => ({ alt: "", caption: "", credit: "" });

export function draftFromAsset(asset: MediaAsset, localeCodes: readonly string[]): AssetDraft {
  const translations: Record<string, TranslationDraft> = {};
  for (const code of localeCodes) {
    const t: MediaAssetTranslation | undefined = asset.translations[code];
    translations[code] = { alt: t?.alt ?? "", caption: t?.caption ?? "", credit: t?.credit ?? "" };
  }
  return { folder_id: asset.folder_id, is_decorative: asset.is_decorative, focal: asset.focal, translations };
}

export function sameFocal(a: MediaFocal, b: MediaFocal): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y;
}

export type ChangedField = { key: string; localeCode?: string; field: "folder_id" | "is_decorative" | "focal" | "alt" | "caption" | "credit" };

// The fields of `draft` that differ from `asset`.
export function changedFields(asset: MediaAsset, draft: AssetDraft): ChangedField[] {
  const out: ChangedField[] = [];
  if (draft.folder_id !== asset.folder_id) out.push({ key: "folder_id", field: "folder_id" });
  if (draft.is_decorative !== asset.is_decorative) out.push({ key: "is_decorative", field: "is_decorative" });
  if (!sameFocal(draft.focal, asset.focal)) out.push({ key: "focal", field: "focal" });
  for (const [code, d] of Object.entries(draft.translations)) {
    const before = asset.translations[code];
    const beforeAlt = before?.alt ?? "";
    const beforeCaption = before?.caption ?? "";
    const beforeCredit = before?.credit ?? "";
    if (d.alt !== beforeAlt) out.push({ key: `${code}.alt`, localeCode: code, field: "alt" });
    if (d.caption !== beforeCaption) out.push({ key: `${code}.caption`, localeCode: code, field: "caption" });
    if (d.credit !== beforeCredit) out.push({ key: `${code}.credit`, localeCode: code, field: "credit" });
  }
  return out;
}

export function buildPayload(asset: MediaAsset, draft: AssetDraft): UpdateMediaAssetPayload {
  const payload: UpdateMediaAssetPayload = {};
  const changes = changedFields(asset, draft);
  if (changes.some((c) => c.field === "folder_id")) payload.folder_id = draft.folder_id;
  if (changes.some((c) => c.field === "is_decorative")) payload.is_decorative = draft.is_decorative;
  if (changes.some((c) => c.field === "focal")) {
    payload.focal = draft.focal ? { x: roundFocal(draft.focal.x), y: roundFocal(draft.focal.y) } : null;
  }
  for (const change of changes) {
    if (!change.localeCode) continue;
    const d = draft.translations[change.localeCode] ?? emptyTranslation();
    const translations = (payload.translations ??= {});
    const entry = (translations[change.localeCode] ??= {});
    if (change.field === "alt") entry.alt = d.alt.trim();
    // An emptied caption / credit clears the value (`null`).
    else if (change.field === "caption") entry.caption = d.caption.trim() === "" ? null : d.caption;
    else if (change.field === "credit") entry.credit = d.credit.trim() === "" ? null : d.credit;
  }
  return payload;
}
