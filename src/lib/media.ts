// Small pure helpers of the media screens (doc/07 section 3.22).
import type { MediaAsset } from "@/types/media";

// 3126522 -> "3.0 MB". Binary units, one decimal from KB up.
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

// `object-position` for a focal point `{x, y}` (0..1): the crop keeps that point in view.
export function focalPosition(focal: { x: number; y: number } | null | undefined): string | undefined {
  if (!focal) return undefined;
  return `${Math.round(focal.x * 1000) / 10}% ${Math.round(focal.y * 1000) / 10}%`;
}

// Focal values are stored with at most 3 decimals (`numeric(4,3)`): 0.4219 -> 0.422, clamped to 0..1.
export function roundFocal(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 1000) / 1000));
}

// The sort fields of `GET /media/assets` (doc/05 11.6) as a UI list: [value, i18n key under media.sort].
export const MEDIA_SORT_OPTIONS = [
  ["-created_at", "newest"],
  ["created_at", "oldest"],
  ["original_filename", "nameAsc"],
  ["-original_filename", "nameDesc"],
  ["-bytes", "largest"],
  ["bytes", "smallest"],
  ["-updated_at", "recentlyEdited"],
] as const;

export const MEDIA_SORT_FIELDS = ["created_at", "original_filename", "bytes", "updated_at", "deleted_at"] as const;
export const MEDIA_KINDS = ["image", "brand", "video", "audio", "document", "other"] as const;

// "Missing alt" as the API defines it (doc/05 11.6 `missing_alt`): not decorative and the default language's
// alt text is empty.
export function isMissingAlt(
  asset: Pick<MediaAsset, "is_decorative" | "translations">,
  defaultLocale: string
): boolean {
  if (asset.is_decorative) return false;
  return !(asset.translations[defaultLocale]?.alt ?? "").trim();
}

// Where an editor of the owner of a usage lives (doc/07 section 2.1 routes). Unknown owner types get no link:
// the screens of pages / posts / albums come with later milestones, and a made-up route would 404.
export function usageHref(usage: { entity_type: string; id: number }): string | null {
  switch (usage.entity_type) {
    case "cms.page":
      return `/admin/pages/${usage.id}`;
    case "cms.post":
      return `/admin/blog/posts/${usage.id}`;
    case "cms.album":
      return `/admin/galleries/${usage.id}`;
    case "cms.faq":
      return `/admin/faq/${usage.id}`;
    case "cms.site_settings":
      return "/admin/settings";
    default:
      return null;
  }
}

export function asEtag(updatedAt: string): string {
  return `"${updatedAt}"`;
}
