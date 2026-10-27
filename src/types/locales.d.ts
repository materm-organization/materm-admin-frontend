// Locale wire shapes (doc/05-api-spec.md section 10.7).
export type LocaleDateFormats = {
  short?: string;
  long?: string;
  months?: string[];
  [key: string]: unknown;
};

export type Locale = {
  code: string;
  name: string;
  native_name: string;
  short_label: string;
  flag: string | null;
  text_direction: "ltr" | "rtl";
  is_default: boolean;
  is_active: boolean;
  fallback_code: string | null;
  search_config: string;
  date_formats: LocaleDateFormats | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

// PATCH /locales/{code}: partial; `null` clears only `flag` and `fallback_code`.
export type UpdateLocalePayload = {
  name?: string;
  native_name?: string;
  short_label?: string;
  flag?: string | null;
  sort_order?: number;
  is_active?: boolean;
  fallback_code?: string | null;
  date_formats?: { short: string; long?: string; months: string[] };
};
