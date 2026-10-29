// Forms wire types (doc/05-api-spec.md section 13.6; backend materm-admin-backend/modules/forms/models/form.model.go).
// ETag of a form = `"<lock_version>"`; `recipients_etag` is a SEPARATE validator (a hash of the recipient set, already quoted)
// that only `PUT /forms/{id}/recipients` uses. A list row has no ETag header: build it with `formEtag(row)`.
import type { ApiMeta } from "@/types/api";
import type { UserRef } from "@/types/media";
import type { AggregateStamp, PublishableMeta } from "@/types/publishing";

// One language of a form. Nullable members are `null` when empty. `messages` = `{ <error code>: <text> }`.
export type FormTranslation = {
  title: string;
  description: string | null;
  submit_label: string;
  sending_label: string | null;
  success_title: string | null;
  success_description: string | null;
  success_again_label: string | null;
  messages: Record<string, string>;
};

export type FormFieldTranslation = {
  label: string;
  placeholder: string | null;
  help: string | null;
  // `{ <option value>: <label> }`
  option_labels: Record<string, string>;
};

export type FormFieldType = "text" | "email" | "tel" | "textarea" | "select" | "radio" | "checkbox" | "consent";

// Read-only in P1 (the builder is P2).
export type FormFieldDef = {
  key: string;
  type: FormFieldType;
  required: boolean;
  min_length: number | null;
  max_length: number | null;
  pattern: string | null;
  options: string[] | null;
  // `x-pii`: the value is personal data (export / retention).
  pii: boolean;
};

// Derived from the field `topic` (C-27): the value never changes; the labels are the field's `option_labels`.
export type FormTopic = {
  value: string;
  labels: Record<string, string>;
  notify_override: string[];
};

export type FormRecipientKind = "to" | "cc" | "bcc";

export type FormRecipient = {
  id?: number;
  email: string;
  kind: FormRecipientKind;
  // `null` = every topic.
  topic_value: string | null;
  is_active: boolean;
};

export type FormSettings = {
  store_submissions: boolean;
  retention_days: number;
  retention_mode: string;
  honeypot_field: string | null;
  rate_limit_max: number;
  rate_limit_window_s: number;
  rate_limit_daily_max: number;
  min_fill_seconds: number;
  max_payload_bytes: number;
  notify_enabled: boolean;
  success_redirect_url: string | null;
};

export type FormDraftRef = {
  revision_id: number;
  version: number;
  created_at: string;
  created_by: UserRef;
} | null;

export type FormListItem = PublishableMeta & {
  id: number;
  public_id: string;
  slug: string;
  name: string;
  is_system: boolean;
  // Active recipients only.
  recipient_count: number;
  // Present only for a caller who holds `forms.submissions:read`.
  submissions_new?: number;
  draft: FormDraftRef;
};

export type FormDetail = FormListItem & {
  settings: FormSettings;
  schema_version: number;
  fields: FormFieldDef[];
  topics: FormTopic[];
  translations: Record<string, FormTranslation>;
  // `{ <field key>: { <locale>: FormFieldTranslation } }`
  field_translations: Record<string, Record<string, FormFieldTranslation>>;
  recipients: FormRecipient[];
  recipients_etag: string;
  missing_locales: string[];
};

export type FormWarning = { path: string; code: string; params?: Record<string, string | number | boolean | string[] | undefined> };

export type FormWriteResult = FormDetail & { aggregate: AggregateStamp; warnings: FormWarning[] };

// ---- requests -----------------------------------------------------------------------------------------------------------
// `PATCH /forms/{id}` (partial, `If-Match` = the form's ETag). A nullable text sent as `null` clears it; `messages` and
// `option_labels` REPLACE the whole map of that language; a locale sent as `null` deletes that language's row (not the default).
export type FormTranslationPatch = {
  title?: string;
  description?: string | null;
  submit_label?: string;
  sending_label?: string | null;
  success_title?: string | null;
  success_description?: string | null;
  success_again_label?: string | null;
  messages?: Record<string, string>;
};

export type FormFieldTranslationPatch = {
  label?: string;
  placeholder?: string | null;
  help?: string | null;
  option_labels?: Record<string, string>;
};

export type UpdateFormPayload = Partial<{
  name: string;
  store_submissions: boolean;
  retention_days: number;
  honeypot_field: string | null;
  rate_limit_max: number;
  rate_limit_window_s: number;
  rate_limit_daily_max: number;
  min_fill_seconds: number;
  notify_enabled: boolean;
  success_redirect_url: string | null;
  translations: Record<string, FormTranslationPatch | null>;
  field_translations: Record<string, Record<string, FormFieldTranslationPatch | null>>;
}>;

export type RecipientInput = { email: string; kind: FormRecipientKind; topic_value: string | null; is_active: boolean };
export type ReplaceRecipientsPayload = { recipients: RecipientInput[] };
export type RecipientsResult = { recipients: FormRecipient[]; recipients_etag: string };

export type FormsQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  status?: string;
  has_unpublished_changes?: boolean;
  sort?: string;
};

export type FormsListResponse = { data: FormListItem[]; meta: ApiMeta };
