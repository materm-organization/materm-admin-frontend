// FAQ wire types (doc/05-api-spec.md section 13.5; doc/api/openapi-admin.yaml: FaqItemTranslation, FaqItemTranslationPatch, FaqItem,
// FaqGroupListItem, FaqGroupDetail, FaqGroupWriteResult, CreateFaqGroupRequest, UpdateFaqGroupRequest, CreateFaqItemRequest,
// UpdateFaqItemRequest, FaqItemWriteResult). ETag of a group = `"<lock_version>"`.
import type { ApiMeta } from "@/types/api";
import type { ItemOrderEntry } from "@/types/albums";
import type { SaveLiveWarning } from "@/types/media";
import type { PageDraftRef } from "@/types/pages";
import type { AggregateStamp, PublishableMeta, PublishedRevisionRef } from "@/types/publishing";

// Tiptap / ProseMirror document JSON, profile `lite` (doc/04 section 3.7). Never HTML.
// The answer is rich text of profile `lite` (doc/04 3.7): the backend accepts only these top-level nodes (anything else, a
// heading for one, is 422 `not_in_enum`); the children (listItem, text, hardBreak) and the marks (bold / italic / link) are the editor's.
export type FaqAnswerNode = { type: "paragraph" | "bulletList" | "orderedList"; attrs?: Record<string, unknown>; content?: unknown[] };
export type FaqAnswer = { type: "doc"; content?: FaqAnswerNode[] };

// A language row has BOTH texts (the columns are NOT NULL).
export type FaqItemTranslation = { question: string; answer: FaqAnswer };
export type FaqItemTranslationPatch = Partial<FaqItemTranslation>;

export type FaqItem = {
  id: number;
  public_id: string;
  sort_order: number;
  is_visible: boolean;
  translations: Record<string, FaqItemTranslation>;
};

export type FaqGroupListItem = PublishableMeta & {
  id: number;
  public_id: string;
  key: string;
  // The internal label (not translated).
  name: string;
  item_count: number;
  visible_item_count: number;
  // How many `faq` sections use the group (by `group_key`).
  usage_count: number;
  draft: PageDraftRef;
};

export type FaqGroupDetail = FaqGroupListItem;
export type FaqGroupWriteResult = FaqGroupDetail & { aggregate: AggregateStamp; warnings: SaveLiveWarning[] };
export type FaqGroupPublishResult = FaqGroupWriteResult & { published_revision: PublishedRevisionRef };
export type FaqGroupRestoreResult = FaqGroupWriteResult & { restored_from: { revision_id: number; version: number } };
export type FaqGroupDeleteResult = { aggregate: AggregateStamp; warnings: SaveLiveWarning[] } | null;

export type FaqItemWriteResult = { item: FaqItem; order: ItemOrderEntry[]; aggregate: AggregateStamp; warnings: SaveLiveWarning[] };
export type FaqItemDeleteResult = { order: ItemOrderEntry[]; aggregate: AggregateStamp; warnings: SaveLiveWarning[] };
export type FaqOrderResult = { order: ItemOrderEntry[]; aggregate: AggregateStamp };

export type CreateFaqGroupPayload = { key: string; name: string };
export type UpdateFaqGroupPayload = { name?: string };
export type CreateFaqItemPayload = { translations: Record<string, FaqItemTranslation>; is_visible?: boolean; position?: number };
export type UpdateFaqItemPayload = {
  is_visible?: boolean;
  // merge per language; `null` removes that language's row (not the default language)
  translations?: Record<string, FaqItemTranslationPatch | null>;
};

export type FaqGroupsQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  status?: string;
  has_unpublished_changes?: boolean;
  trashed?: boolean;
  sort?: string;
};

export type FaqGroupsList = { data: FaqGroupListItem[]; meta: ApiMeta };
