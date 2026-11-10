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

// The `schedule` member of a detail (D1; pages, posts, albums, collection entries; `null` = nothing scheduled): the newest pending /
// running / failed row of the server's schedule table. `run_at` is `+07:00`. `failed` = the server tried 3 times and gave up; the
// entity stays `scheduled` with a past `run_at` (overdue) until somebody unschedules, reschedules or publishes it now.
export type ScheduleAction = "publish" | "apply_revision";
export type ScheduleStatus = "pending" | "running" | "failed";
export type ScheduleInfo = {
  action: ScheduleAction;
  run_at: string;
  status: ScheduleStatus;
  attempts: number;
  // A short summary (blocker codes), never row content.
  last_error: string | null;
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
  // Only on the detail of a schedulable kind (D1).
  schedule?: ScheduleInfo | null;
};

// What PublishBar needs to know about an entity (a subset of PublishableMeta + the two flags a page has).
export type PublishableState = Pick<PublishableMeta, "status" | "has_unpublished_changes"> & {
  // A number; a collection entry uses the composite `"<key>:<id>"` (lib/collections/ref.ts).
  id: number | string;
  deleted_at?: string | null;
  // The home page can not be unpublished (BR-16); a system page can not be deleted (BR-18).
  is_home?: boolean;
  is_system?: boolean;
  // D1: what the bar shows for a scheduled entity (the detail's `schedule`, and the root's `scheduled_at` as a fallback) and whether it
  // was ever published (`first_published_at`: the target of an unschedule is `archived` then, else `draft`).
  schedule?: ScheduleInfo | null;
  scheduled_at?: string | null;
  first_published_at?: string | null;
  // Who created it (`created_by.id`): a kind with `update_own` (posts) lets the creator save / discard / preview.
  owner_id?: number | null;
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

// `POST .../reject` also names the history revision that holds the comment (its change note).
export type RejectResult = PublishableCommandResult & { review_revision?: PublishedRevisionRef };

// 409 `INVALID_STATE` `details.reason` of the D1 commands (plus `trashed`, shared with the rest).
export type ReviewScheduleInvalidReason = "not_draft" | "not_in_review" | "not_scheduled" | "nothing_to_publish" | "trashed";

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
  // A picture of an album / a question of a FAQ group (T1.5.6): its numeric id, its 0-based position, its `public_id` in the pointer.
  itemId?: number;
  itemIndex?: number;
  itemPublicId?: string;
};
