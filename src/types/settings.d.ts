// Settings groups (doc/05-api-spec.md section 11.3, doc/api/openapi-admin.yaml: SettingsGroup, SettingsFieldDef,
// SettingsMediaRef, PutSettingsRequest). Definitions (`fields[]`) are seed-defined and read-only; the API edits
// VALUES, a whole group per `PUT` (replace).
import type { SaveLiveWarning, UserRef } from "@/types/media";

// `analytics` is P2 (404 in P1); there is no `social` group (the social links are the `social` menu).
export type SettingsGroupKey = "brand" | "contact" | "footer" | "site" | "seo" | (string & {});

export type SettingsValueType = "string" | "text" | "number" | "boolean" | "json" | "url" | "email" | "phone" | "media";

export type SettingsFieldDef = {
  key: string;
  value_type: SettingsValueType;
  is_localized: boolean;
  is_public: boolean;
  required: boolean;
  description?: string | null;
  sort_order: number;
  max_length?: number | null;
  pattern?: string | null;
  // Media fields only.
  accept?: { kinds?: string[]; mime_types?: string[] } | null;
};

export type SettingsMediaRef = {
  id: number;
  status: string;
  original_filename?: string;
  mime_type?: string;
  width?: number | null;
  height?: number | null;
  url?: string | null;
};

// not localized: the value itself (`string` / `number` / `boolean` / `null`); localized: `{ "<locale>": string }`;
// media: the media id or `null`.
export type SettingsValue = string | number | boolean | null | Record<string, string | null>;
export type SettingsValues = Record<string, SettingsValue | undefined>;

export type SettingsGroup = {
  group: SettingsGroupKey;
  // Which permission key guards the group: `cms.seo` for `seo`, else `cms.settings`.
  permission_key: "cms.settings" | "cms.seo";
  // The number in the ETag (`"<version>"`; `"0"` = never edited).
  version: number;
  etag: string;
  updated_at?: string | null;
  updated_by?: UserRef;
  fields: SettingsFieldDef[];
  values: SettingsValues;
  media: Record<string, SettingsMediaRef>;
  // Only on the answer of a `PUT` / a restore.
  warnings?: SaveLiveWarning[];
};

export type PutSettingsPayload = { values: SettingsValues; change_note?: string };
