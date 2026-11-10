"use client";

import { useCan } from "@/hooks/use-permission";
import { PERMISSION_ACTIONS } from "@/lib/constants/permissions";
import { PUBLISHABLE_RESOURCES, type PublishableResource } from "@/lib/publishable-resources";
import type { PublishableState } from "@/types/publishing";

// What the signed-in user may do with one publishable entity (doc/05 13.3.2, 12.10 - 12.11; doc/07 2.5.7). One place for the rules the
// PublishBar and the editors share:
//  - publish / unpublish never count the creator; `update` counts `update_own` on the creator's own thing (posts only);
//  - submit for review: `update` (| `update_own` of mine); reject: `review`;
//  - schedule: `schedule` AND `publish` (BR-11), and only for the kinds that have a schedule;
//  - BR-10: while a post is in review or scheduled, an author who holds only `update_own` can not touch it (not even to translate).
export function usePublishCapabilities(resource: PublishableResource, entity: Pick<PublishableState, "status" | "owner_id">) {
  const config = PUBLISHABLE_RESOURCES[resource];
  const own = config.ownActions ? { ownerId: entity.owner_id } : {};
  const key = config.permissionKey;
  const canPublish = useCan(key, PERMISSION_ACTIONS.PUBLISH);
  const canUnpublish = useCan(key, PERMISSION_ACTIONS.UNPUBLISH);
  const canUpdate = useCan(key, PERMISSION_ACTIONS.UPDATE, own);
  const canUpdateAny = useCan(key, PERMISSION_ACTIONS.UPDATE);
  const holdsUpdateOwn = useCan(key, `${PERMISSION_ACTIONS.UPDATE}_own`);
  const canTranslate = useCan(key, PERMISSION_ACTIONS.TRANSLATE);
  const canRead = useCan(key, PERMISSION_ACTIONS.READ);
  const canReviewAction = useCan(key, PERMISSION_ACTIONS.REVIEW);
  const canScheduleAction = useCan(key, PERMISSION_ACTIONS.SCHEDULE);
  const canPreviewAction = useCan(key, config.previewActions, own);

  const locked = entity.status === "in_review" || entity.status === "scheduled";
  return {
    canPublish,
    canUnpublish,
    canUpdate,
    canTranslate,
    canRead,
    canPreviewAction,
    canSubmitReview: config.review && canUpdate,
    canReject: config.review && canReviewAction,
    canSchedule: config.schedule && canScheduleAction && canPublish,
    // BR-10 (the server's `authorLocked`): the caller holds `update_own` but not `update`; whose post it is does not matter.
    authorLocked: config.ownActions && locked && holdsUpdateOwn && !canUpdateAny,
  };
}
