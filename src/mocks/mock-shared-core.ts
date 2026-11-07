// The pure part of the shared-sections mock (doc/05 section 18): what a page needs to know about a shared section without importing the
// pages model (`mock-pages.ts` imports THIS file, `mock-shared-sections.ts` imports both). Only reads `db`.
import { parseMicros } from "@/mocks/mock-time";
import { keyOf, type MockDb, type MockSharedSection, type MockSharedSnapshot } from "@/mocks/mock-core";
import type { SharedSectionRef } from "@/types/pages";

// 18.11.1: `trashed` and `missing` are states of the reference, not of the row's `status`.
export type SharedState = "published" | "draft" | "in_review" | "scheduled" | "archived" | "expired" | "trashed" | "missing";

// The predicate of the view `v_published_page_sections`, letter for letter: not deleted, `published`, `published_at <= now`, not unpublished yet.
export function sharedState(db: MockDb, id: number): SharedState {
  const row = db.sharedSections.find((s) => s.id === id);
  if (!row) return "missing";
  if (row.deleted_at) return "trashed";
  if (row.status !== "published") return row.status;
  const now = db.clock;
  const from = row.published_at ? parseMicros(row.published_at) : Number.POSITIVE_INFINITY;
  const until = row.unpublished_at ? parseMicros(row.unpublished_at) : null;
  return from <= now && (until === null || until > now) ? "published" : "expired";
}
export const sharedIsLive = (db: MockDb, id: number) => sharedState(db, id) === "published";

export const sharedRow = (db: MockDb, id: number): MockSharedSection | undefined => db.sharedSections.find((s) => s.id === id);

// The working copy of a shared section: its `draft` row while it is published and has pending edits (05 12.2.2), else the real row.
export function sharedWorking(db: MockDb, row: MockSharedSection): MockSharedSnapshot {
  const draft = row.status === "published" ? db.revisions[keyOf("shared-sections", row.id)]?.find((r) => r.kind === "draft") : undefined;
  return (draft?.snapshot as unknown as MockSharedSnapshot | undefined) ?? row.live;
}
export const sharedHasDraft = (db: MockDb, row: MockSharedSection) => row.status === "published" && Boolean(db.revisions[keyOf("shared-sections", row.id)]?.some((r) => r.kind === "draft"));

// The block `shared_section` of a page section (05 18.9.3): `name` / `variant` are the WORKING copy's.
export function sharedRefBlock(db: MockDb, id: number): SharedSectionRef | null {
  const row = sharedRow(db, id);
  if (!row) return null;
  const w = sharedWorking(db, row);
  return {
    id: row.id,
    public_id: row.public_id,
    name: w.name,
    status: row.status,
    has_unpublished_changes: sharedHasDraft(db, row),
    live: sharedIsLive(db, id),
    deleted_at: row.deleted_at,
    variant: w.variant,
  };
}
