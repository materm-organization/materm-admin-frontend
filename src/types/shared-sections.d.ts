// Shared sections wire types (doc/05-api-spec.md section 18; doc/api/openapi-admin.yaml tag SharedSections). A shared section is a
// publishable root (ETag = `"<lock_version>"`, e.g. `"5"`); pages reference it through `cms_page_sections.shared_section_id`.
import type { ApiMeta } from "@/types/api";
import type { SaveLiveWarning } from "@/types/media";
import type { PageDraftRef, SectionTypeLite } from "@/types/pages";
import type { AggregateStamp, PublishableMeta, PublishedRevisionRef } from "@/types/publishing";

export type SharedSectionListItem = PublishableMeta & {
  id: number;
  public_id: string;
  name: string;
  section_type: SectionTypeLite;
  variant: string | null;
  effective_variant: string | null;
  props_bytes: number;
  unsupported: boolean;
  translation_status: Record<string, { missing: number }>;
  // SS-15: pages outside the trash / in the trash that reference it (live rows or draft).
  used_in_pages: number;
  used_in_trashed_pages: number;
  draft: PageDraftRef;
};

// `GET /shared-sections/{id}`: the working copy including `props`.
export type SharedSection = SharedSectionListItem & { props: Record<string, unknown> };

// Every write / command: the detail plus the stamp and the warnings (05 18.2). `published_revision` after a publish, `restored_from` after a revision restore.
export type SharedSectionWriteResult = SharedSection & {
  aggregate: AggregateStamp;
  warnings: SaveLiveWarning[];
  published_revision?: PublishedRevisionRef;
  restored_from?: { revision_id: number; version: number };
};

// `DELETE`: `null` when it was in the trash already.
export type SharedSectionDeleteResult = { aggregate: AggregateStamp; warnings: SaveLiveWarning[] } | null;

export type CreateSharedSectionPayload = {
  name: string;
  section_type_key: string;
  variant?: string | null;
  props?: Record<string, unknown>;
};

// `section_type_key` / `section_version` are immutable (SS-13), so they are not here. At least one field.
export type UpdateSharedSectionPayload = {
  name?: string;
  variant?: string | null;
  props?: Record<string, unknown>;
};

// Query of `GET /shared-sections` (05 18.4); anything else is a 422 `unknown_field`.
export type SharedSectionsQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  // comma lists
  section_type?: string;
  status?: string;
  has_unpublished_changes?: boolean;
  in_use?: boolean;
  placeable_on_page?: number;
  trashed?: boolean;
  sort?: string;
};

export type SharedSectionsList = { data: SharedSectionListItem[]; meta: ApiMeta };

// `GET /shared-sections/{id}/usages` (05 18.7).
export type SharedUsageSection = { section_id: number; public_id: string; where: "live" | "draft"; is_visible: boolean; sort_order: number };

export type SharedUsagePage = {
  page_id: number;
  title: string | null;
  path: string;
  template: string;
  status: PublishableMeta["status"];
  has_unpublished_changes: boolean;
  deleted_at: string | null;
  // The page is live AND has a visible live row of this shared section: it loses the section if the shared one is unpublished.
  live_on_site: boolean;
  sections: SharedUsageSection[];
};

export type SharedSectionUsages = { shared_section_id: number; total_pages: number; truncated: boolean; pages: SharedUsagePage[] };

// One row of `details.references[]` of the 409 `ENTITY_REFERENCED` (`reason: "shared_section_in_use"`, 05 18.6).
export type SharedSectionReference = {
  entity_type: string;
  id: number;
  title?: string | null;
  field?: string | null;
  kind: "section_ref" | "draft_section_ref";
  in_draft: boolean;
  page_status: PublishableMeta["status"];
  page_trashed: boolean;
  section_id: number;
  is_visible: boolean;
};

// The `shared_section_referenced` warning of an unpublish (05 18.8.3).
export type SharedUnpublishWarningParams = {
  total_references: number;
  live_pages: Array<{ id: number; title: string | null; path: string }>;
  live_pages_total: number;
  pages_blocked_on_publish: number;
  truncated: boolean;
};
