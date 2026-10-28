// Publish engine wire types shared by every publishable entity (doc/05-api-spec.md sections 10.2, 10.4, 10.5,
// 12.7; doc/api/openapi-admin.yaml: AggregateStamp, PublishableMeta, PublishIssue, PublishBlockedError,
// PublishResult, PublishedRevisionRef). Pages are the first user; posts / albums / FAQ / forms reuse them (M5).
import type { UserRef } from "@/types/media";

export type PublishableStatus = "draft" | "in_review" | "scheduled" | "published" | "archived";

// The answer of every write / command carries the root's new stamp: `lock_version` is the ETag's value, so the
// client updates its ETag from it without a refetch (05 10.4).
export type AggregateStamp = {
  entity_type: string;
  id: number;
  lock_version: number;
  status: PublishableStatus;
  has_unpublished_changes: boolean;
  updated_at: string;
};

// The lifecycle block every list row and detail of a publishable root has (05 10.2).
export type PublishableMeta = {
  status: PublishableStatus;
  lock_version: number;
  has_unpublished_changes: boolean;
  published_at: string | null;
  first_published_at: string | null;
  scheduled_at: string | null;
  unpublished_at: string | null;
  created_by: UserRef;
  updated_by: UserRef;
  created_at: string;
  updated_at: string;
  // Only on `?trashed=true` rows.
  deleted_at?: string | null;
  purge_at?: string | null;
};

// What PublishBar needs to know about an entity (a subset of PublishableMeta + the two flags a page has).
export type PublishableState = Pick<PublishableMeta, "status" | "has_unpublished_changes"> & {
  id: number;
  deleted_at?: string | null;
  // The home page can not be unpublished (BR-16); a system page can not be deleted (BR-18).
  is_home?: boolean;
  is_system?: boolean;
};

// A blocker (`errors[]` of a 422 PUBLISH_BLOCKED, has `in: "entity"`) or a warning (`details.warnings[]`, no `in`).
export type PublishIssue = {
  in?: "entity";
  path: string;
  code: string;
  message?: string;
  params?: {
    locale?: string;
    section_id?: number;
    section_key?: string;
    section_index?: number;
    [key: string]: string | number | boolean | string[] | undefined;
  };
};

export type PublishBlockedDetails = {
  blocker_count?: number;
  truncated?: boolean;
  warning_count?: number;
  warnings?: PublishIssue[];
};

// The non-blocking notices of a successful command (`data.warnings[]`; the same shape as a PublishIssue, no `in`).
export type CommandWarning = PublishIssue;

// What every successful command of the engine answers (for pages: a `PageWriteResult`): the root in the shape of its
// own GET plus the stamp and the warnings. PublishBar only reads these two; the host reads the rest.
export type PublishableCommandResult = {
  aggregate: AggregateStamp;
  warnings?: CommandWarning[];
  [field: string]: unknown;
};

export type PublishedRevisionRef = { id: number; version: number };

// `?dry_run=true` that passed: no ETag, nothing changed.
export type PublishDryRunResult = { publishable: true; warnings: PublishIssue[] };

// Where "Go to field" sends the host: the pointer as the server wrote it, plus what it already knows about it.
export type PublishIssueTarget = {
  pointer: string;
  code: string;
  locale?: string;
  sectionId?: number;
  sectionKey?: string;
  sectionIndex?: number;
  // `public_id` of the section when the pointer is inside `/sections/<public_id>/...`.
  sectionPublicId?: string;
};
