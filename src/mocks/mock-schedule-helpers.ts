// D1: the test / click-through helpers of the review and schedule model - the stand-in for the server's scheduler worker and for a few roles.
// `fireSchedule` is what the worker does when the time comes (the publish rules run again), `failSchedule` is the worker giving up after 3 attempts,
// `makeScheduleOverdue` is a time that passed before the worker got to it. Kinds: "pages" | "posts" | "albums" | "collection-entries"
// (a collection entry's id is the composite `"<collection key>:<entry id>"`).
import { failAlbumSchedule, fireAlbumSchedule, makeAlbumScheduleOverdue } from "@/mocks/mock-albums";
import { failEntrySchedule, fireEntrySchedule, makeEntryScheduleOverdue } from "@/mocks/mock-collections";
import { invalidState, type MockDb, type MockWorkflowRole } from "@/mocks/mock-core";
import { failPageSchedule, firePageSchedule, makePageScheduleOverdue } from "@/mocks/mock-pages";
import { failPostSchedule, firePostSchedule, makePostScheduleOverdue } from "@/mocks/mock-posts";

export type ScheduleKind = "pages" | "posts" | "albums" | "collection-entries";

function entryParts(id: string | number): [string, string] {
  const [key, entryId] = String(id).split(":");
  if (!key || !entryId) throw invalidState("not_scheduled");
  return [key, entryId];
}

export function fireSchedule(db: MockDb, kind: ScheduleKind, id: string | number) {
  switch (kind) {
    case "pages":
      return firePageSchedule(db, String(id));
    case "posts":
      return firePostSchedule(db, String(id));
    case "albums":
      return fireAlbumSchedule(db, String(id));
    default:
      return fireEntrySchedule(db, ...entryParts(id));
  }
}

export function failSchedule(db: MockDb, kind: ScheduleKind, id: string | number, lastError?: string) {
  switch (kind) {
    case "pages":
      return failPageSchedule(db, String(id), lastError);
    case "posts":
      return failPostSchedule(db, String(id), lastError);
    case "albums":
      return failAlbumSchedule(db, String(id), lastError);
    default:
      return failEntrySchedule(db, ...entryParts(id), lastError);
  }
}

export function makeScheduleOverdue(db: MockDb, kind: ScheduleKind, id: string | number) {
  switch (kind) {
    case "pages":
      return makePageScheduleOverdue(db, String(id));
    case "posts":
      return makePostScheduleOverdue(db, String(id));
    case "albums":
      return makeAlbumScheduleOverdue(db, String(id));
    default:
      return makeEntryScheduleOverdue(db, ...entryParts(id));
  }
}

export const setWorkflowRole = (db: MockDb, role: MockWorkflowRole) => {
  db.workflowRole = role;
};

// The permission grants that match each role, for the cached `/auth/me` of a click-through (the models enforce the same rules with 403).
export const WORKFLOW_ACTIONS: Record<MockWorkflowRole, string[]> = {
  full: ["read", "create", "update", "delete", "publish", "unpublish", "translate", "review", "schedule"],
  writer: ["read", "create", "update", "delete", "translate"],
  reviewer: ["read", "review"],
  scheduler: ["read", "update", "schedule"],
};
