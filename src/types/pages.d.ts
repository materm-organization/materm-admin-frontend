// Pages wire types (doc/05-api-spec.md section 12.3 / 12.4; doc/api/openapi-admin.yaml: PageListItem, PageDetail,
// PageWriteResult, PageCreateResult, CreatePageRequest, SetHomeResult, PageReference(s), PageTemplate).
// ETag of a page = `"<lock_version>"`; a list row has no ETag header, build it with `pageEtag(row)`.
import type { ApiMeta } from "@/types/api";
import type { SaveLiveWarning } from "@/types/media";
import type { AggregateStamp, PublishableMeta, PublishedRevisionRef } from "@/types/publishing";

export type PageTranslationStatus = { enabled: boolean; title: boolean; seo_title: boolean; seo_description: boolean };

export type PageTranslation = {
  title: string;
  seo_title?: string | null;
  seo_title_absolute?: boolean;
  seo_description?: string | null;
  og_image_id?: number | null;
  canonical_path?: string | null;
  is_enabled?: boolean;
};

export type PageDraftRef = {
  revision_id: number;
  version: number;
  created_at: string;
  created_by: { id: number; name: string | null } | null;
} | null;

export type PageListItem = PublishableMeta & {
  id: number;
  public_id: string;
  key: string;
  name: string;
  template: string;
  path: string;
  parent_id: number | null;
  is_home: boolean;
  is_system: boolean;
  noindex: boolean;
  in_sitemap: boolean;
  sort_order: number;
  title: string | null;
  title_locale: string | null;
  translation_status: Record<string, PageTranslationStatus>;
  section_count: number;
  draft: PageDraftRef;
};

export type PageDetail = PageListItem & {
  translations: Record<string, PageTranslation>;
  missing_locales: string[];
  sections_missing: Record<string, number>;
};

export type SectionTypeLite = {
  id: number;
  key: string;
  version: number;
  name: string;
  is_active: boolean;
  code_registered: boolean;
};

export type SectionSummary = {
  id: number;
  public_id: string;
  page_id: number;
  section_type: SectionTypeLite;
  variant: string | null;
  effective_variant: string | null;
  sort_order: number;
  is_visible: boolean;
  anchor_id: string | null;
  props_bytes: number;
  shared_section_id: number | null;
  required: boolean;
  unsupported: boolean;
  translation_status: Record<string, { missing: number }>;
  props?: Record<string, unknown>;
};

// A section with its props (`GET .../sections/{id}`, the `section` of a write answer).
export type PageSection = SectionSummary & { props: Record<string, unknown> };

export type SectionOrder = { id: number; public_id: string; sort_order: number };

// `POST` (201) / `PATCH .../sections/{id}`: the section, the order of all sections and the page's new stamp. A write
// answers NOT the page: the page's new ETag is the `ETag` header, its new state is `aggregate`.
export type SectionWriteResult = {
  section: PageSection;
  sections: SectionOrder[];
  aggregate: AggregateStamp;
  warnings: SaveLiveWarning[];
};

// `PUT .../sections/order` and `DELETE .../sections/{id}`.
export type SectionOrderResult = { sections: SectionOrder[]; aggregate: AggregateStamp };

export type CreateSectionPayload = {
  section_type_key: string;
  position?: number;
  variant?: string | null;
  props?: Record<string, unknown>;
  is_visible?: boolean;
  anchor_id?: string | null;
};

export type UpdateSectionPayload = {
  props?: Record<string, unknown>;
  variant?: string | null;
  is_visible?: boolean;
  anchor_id?: string | null;
};

export type PageWriteResult = PageDetail & {
  aggregate: AggregateStamp;
  warnings: SaveLiveWarning[];
};

export type PageCreateResult = PageWriteResult & { sections: SectionSummary[] };

export type PagePublishResult = PageWriteResult & { published_revision: PublishedRevisionRef };

export type PageRestoreResult = PageWriteResult & { restored_from: { revision_id: number; version: number } };

// `DELETE /pages/{id}`: `null` when it was in the trash already.
export type PageDeleteResult = { aggregate: AggregateStamp; warnings: SaveLiveWarning[] } | null;

export type SetHomeResult = {
  page: PageWriteResult;
  previous_home: { id: number; key: string; path: string; lock_version: number } | null;
  aggregates: AggregateStamp[];
};

export type PageReference = {
  entity_type: string;
  id: number;
  title?: string | null;
  field?: string | null;
  kind: "menu_item" | "section_props" | "draft_props";
  in_draft: boolean;
  menu_key?: string | null;
};

export type PageReferences = { references: PageReference[]; total_references: number; truncated: boolean };

export type TemplateSection = {
  section_type_key: string;
  name: string;
  is_active: boolean;
  code_registered: boolean;
  required: boolean;
  max_per_page: number | null;
  position: "first" | "after_hero" | "any";
  group: string | null;
};

export type TemplateRequirement = {
  kind: "group" | "type";
  group: string | null;
  section_type_keys: string[];
  min: 1;
  max: number | null;
  position: "first" | "after_hero" | "any";
};

export type PageTemplate = {
  key: string;
  name: string;
  description: string;
  is_default: boolean;
  allowed_sections: TemplateSection[];
  required: TemplateRequirement[];
  initial_sections: Array<{ section_type_key: string; variant: string | null }>;
  page_count: number;
};

export type CreatePagePayload = {
  template: string;
  path: string;
  translations: Record<string, PageTranslation>;
  key?: string;
  name?: string;
  noindex?: boolean;
  in_sitemap?: boolean;
  sort_order?: number;
};

export type UpdatePagePayload = {
  name?: string;
  template?: string;
  path?: string;
  noindex?: boolean;
  in_sitemap?: boolean;
  sort_order?: number;
  translations?: Record<string, Partial<PageTranslation> | null>;
};

// Query of `GET /pages` (anything else is a 422 `unknown_field`).
export type PagesQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  locale?: string;
  // comma list of statuses / templates
  status?: string;
  template?: string;
  is_home?: boolean;
  has_unpublished_changes?: boolean;
  trashed?: boolean;
  sort?: string;
};

export type PagesList = { data: PageListItem[]; meta: ApiMeta };
