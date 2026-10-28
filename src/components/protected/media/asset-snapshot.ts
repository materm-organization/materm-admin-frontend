// The state of a media asset in the SHAPE of a revision snapshot (doc/05 section 11.7 item 3, "media asset"):
// `{ asset: { folder_id, is_decorative, focal_x, focal_y }, translations: [{ locale_code, alt, caption, credit }] }`.
// `RevisionsTab` compares a version with this to show what a restore would change. (`focal` of the API is
// `{x, y}`; the snapshot stores the two columns.)
import type { MediaAsset } from "@/types/media";

export function assetSnapshot(asset: Pick<MediaAsset, "folder_id" | "is_decorative" | "focal" | "translations">): Record<string, unknown> {
  return {
    asset: {
      folder_id: asset.folder_id,
      is_decorative: asset.is_decorative,
      focal_x: asset.focal?.x ?? null,
      focal_y: asset.focal?.y ?? null,
    },
    translations: Object.entries(asset.translations).map(([locale_code, t]) => ({
      locale_code,
      alt: t.alt ?? "",
      caption: t.caption ?? null,
      credit: t.credit ?? null,
    })),
  };
}
