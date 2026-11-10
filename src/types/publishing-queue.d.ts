// `GET /publishing/queue` (doc/05 12.12, backend `modules/publishing`, FR-PUB-14). The answer carries only the requested tabs (all three when `tab`
// is absent); a kind the caller may not read is left out of rows and counts. No `href` is sent: the UI builds links (`lib/publishing-queue.ts`).
import type { UserRef } from "@/types/media";
import type { PublishableStatus, ScheduleInfo } from "@/types/publishing";

export type QueueTab = "awaiting_review" | "scheduled" | "unpublished_changes";
// The plural form of the admin API paths (also the `entity_type` of a row).
export type QueueKind = "pages" | "posts" | "albums" | "faq-groups" | "forms" | "collection-entries" | "shared-sections";

export type QueueCan = { read: boolean; update: boolean; review: boolean; publish: boolean; schedule: boolean };

export type QueueRowBase = {
  entity_type: QueueKind;
  id: number;
  // Only on `collection-entries`.
  collection_key?: string;
  title: string;
  status: PublishableStatus;
  updated_at: string;
  updated_by: UserRef;
  can: QueueCan;
};

export type QueueAwaitingItem = QueueRowBase & { submitted_at: string | null; submitted_by: UserRef };
// `run_at` = the action's `run_at`, else the root's `scheduled_at` (null when neither exists); `overdue` by database time.
export type QueueScheduledItem = QueueRowBase & { run_at: string | null; overdue: boolean; schedule: ScheduleInfo | null };
export type QueueChangesItem = QueueRowBase & { draft_updated_at: string; draft_updated_by: UserRef };

export type QueueTabData<T> = { count: number; items: T[] };

export type PublishingQueue = {
  awaiting_review?: QueueTabData<QueueAwaitingItem>;
  scheduled?: QueueTabData<QueueScheduledItem>;
  unpublished_changes?: QueueTabData<QueueChangesItem>;
};

export type PublishingQueueQuery = {
  tab?: QueueTab;
  // Comma list on the wire.
  kind?: QueueKind[];
  page?: number;
  limit?: number;
  // RFC 3339, at most now + 30 days.
  to?: string;
};
