// UI strings (doc/05-api-spec.md section 11.4, doc/api/openapi-admin.yaml: UiStringItem, UiStringLocale,
// UiStringListEnvelope, PutUiStringRequest, UiStringWriteResult, UiStringsBundleManifest, BundleSyncResult).
import type { ApiMeta } from "@/types/api";
import type { SaveLiveWarning, UserRef } from "@/types/media";

export type UiStringLocale = {
  // The value in the latest synced bundle (manifest); null = no manifest / not in the bundle / not in that language.
  source: string | null;
  // The value stored in `cms_ui_strings`; null = no row.
  value: string | null;
  // `value != null && value != source`; null while no manifest was synced.
  is_override: boolean | null;
  effective: string | null;
  note: string | null;
  // `"<updated_at>"` of the row; null without a row.
  etag: string | null;
  updated_at: string | null;
  updated_by?: UserRef;
};

export type UiStringItem = {
  key: string;
  namespace: string;
  // false = orphan (a row whose key left the bundle); null while no manifest was synced.
  in_bundle: boolean | null;
  placeholders: string[];
  locales: Record<string, UiStringLocale>;
};

export type UiStringManifestInfo = {
  version: number;
  generated_at: string;
  source_commit: string;
  synced_at: string;
  key_count: number;
} | null;

export type UiStringsListMeta = ApiMeta & {
  manifest?: UiStringManifestInfo;
  summary?: { keys: number; overridden?: number; orphans?: number; missing?: Record<string, number> };
};

export type UiStringsListQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  // Comma separated, at most 10.
  namespace?: string;
  locale?: string;
  overridden?: boolean;
  missing?: string;
  same_as?: string;
  orphan?: boolean;
  sort?: string;
};

export type PutUiStringPayload = { value: string; note?: string | null };

export type UiStringWriteResult = {
  key: string;
  locale: string;
  source: string | null;
  value: string | null;
  is_override: boolean | null;
  effective: string | null;
  note?: string | null;
  etag?: string | null;
  updated_at?: string | null;
  updated_by?: UserRef;
  is_new: boolean;
  no_change: boolean;
  warnings: SaveLiveWarning[];
};

export type UiStringDeleteResult = { key: string; locale: string; source: string | null; effective: string | null } | null;

export type UiStringsBundleKey = { key: string; namespace: string; values: Record<string, string> };
export type UiStringsBundleManifest = { generated_at: string; source_commit: string; keys: UiStringsBundleKey[] };

export type BundleSyncResult = {
  dry_run: boolean;
  manifest: { version: number; generated_at?: string; source_commit?: string; key_count?: number; unchanged: boolean };
  counts: { keys: number; inserted: number; source_updated: number; kept_override: number; unchanged: number };
  new_keys: string[];
  placeholder_conflicts: Array<{ key: string; locale: string; expected: string[]; actual: string[] }>;
  orphans: string[];
  orphan_count: number;
  truncated: boolean;
};
