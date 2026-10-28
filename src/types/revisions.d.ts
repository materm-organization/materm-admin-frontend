// Revisions of the save-live entities (doc/05-api-spec.md section 11.7, doc/api/openapi-admin.yaml:
// RevisionSummary, RevisionDetail, RestoreRevisionRequest, RestoredFrom). A save-live revision is the state
// BEFORE an edit: `created_by` / `created_at` are who replaced that state and when (05 11.1.2).
import type { UserRef } from "@/types/media";

// `history` / `restore` for save-live; a publishable entity also has `draft` (at most one) and `published` rows.
export type RevisionKind = "history" | "restore" | "published" | "draft";

export type RevisionSummary = {
  id: number;
  version: number;
  kind: RevisionKind;
  change_note: string | null;
  // `change_note == "preview"` (preview links of publishable entities; never true for save-live).
  is_preview: boolean;
  schema_version: number;
  created_at: string;
  created_by: UserRef;
  // Publishable entities only: the latest `published` row of a page that is published right now.
  is_live?: boolean;
};

export type RevisionDetail = RevisionSummary & {
  entity: { type: string; id: number; key?: string | null };
  // Shape per entity, 05 11.7 item 3. Treated as opaque JSON by the generic UI.
  snapshot: Record<string, unknown>;
};

export type RestoredFrom = { revision_id: number; version: number };

export type RevisionsListQuery = {
  page?: number;
  limit?: number;
  kind?: string;
  include_preview?: boolean;
  sort?: "-version" | "version";
};
