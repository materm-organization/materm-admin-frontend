// Submissions inbox wire types (doc/05-api-spec.md section 13.7; backend modules/forms/models/submission.model.go).
// Everything here is PERSONAL DATA of website visitors, and UNTRUSTED text: render it as text, never as HTML, never log it.
import type { UserRef } from "@/types/media";

export type SubmissionStatus = "new" | "read" | "replied" | "spam" | "archived";

export type SubmissionFormRef = { id: number; slug: string; name: string };

export type SubmissionListItem = {
  id: number;
  public_id: string;
  // The received date; also the `?created_at=` partition hint of every call that names this row.
  created_at: string;
  form: SubmissionFormRef;
  locale_code: string | null;
  status: SubmissionStatus;
  sender_name: string | null;
  sender_email: string | null;
  topic: string | null;
  // <= 140 characters of the message.
  message_preview: string | null;
  source_path: string | null;
  // `null` always in P1.
  assigned_to: UserRef;
  handled_by: UserRef;
  handled_at: string | null;
  spam_score: number;
  notes_count: number;
  anonymized_at: string | null;
  retention_until: string;
  // The ETag of the row, quotes included: the same value as the ETag header of `GET /submissions/{id}`. The bulk status sends it as it is.
  etag: string;
};

export type SubmissionField = { key: string; label: string; type: string; value: unknown };

export type SubmissionNote = { id: number; note: string; author: UserRef; created_at: string };

export type SubmissionDetail = SubmissionListItem & {
  schema_version: number;
  // The fields that are still in the form's schema, in `field_order`; `label` in the requested language.
  fields: SubmissionField[];
  // Keys the schema no longer has: shown by their raw key.
  extra: Record<string, unknown>;
  user_agent: string | null;
  // The first 12 hex characters only.
  ip_hash_prefix: string | null;
  consent_at: string | null;
  consent_version: string | null;
  notes: SubmissionNote[];
  retention_overdue: boolean;
};

// `GET /submissions/summary`: the badge of the sidebar and the chips of the inbox. Spam is not counted.
export type SubmissionsSummary = {
  new: number;
  by_form: Array<{ form_id: number; slug: string; name: string; new: number }>;
};

export type SubmissionsQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  // Comma list; absent = every status except `spam`.
  status?: string;
  form_id?: number;
  topic?: string;
  // RFC 3339
  from?: string;
  to?: string;
  sort?: string;
};

// The export takes the filter of the list without paging / sort, plus the language of the column labels.
export type SubmissionsExportQuery = Omit<SubmissionsQuery, "page" | "limit" | "sort"> & { locale?: string };

// One entry per submission: the `etag` of its list row (quotes included).
export type BulkStatusItem = { id: number; etag: string };

export type BulkStatusPayload = { items: BulkStatusItem[]; status: SubmissionStatus };

// `stale`: the row changed since the ETag was read; it was NOT written. `from` and `etag` then carry its current status and ETag.
export type BulkSkipReason = "not_found" | "stale" | "invalid_transition" | "anonymized" | "unchanged";

export type BulkStatusResult = {
  updated: Array<{ id: number; status: SubmissionStatus; etag: string }>;
  skipped: Array<{ id: number; reason: BulkSkipReason; from?: SubmissionStatus; etag?: string }>;
  counts: { updated: number; skipped: number };
};
