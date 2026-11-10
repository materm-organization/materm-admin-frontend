import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatchHeaders, withEtag } from "@/lib/etag";
import { idempotencyKeyHeaders } from "@/lib/idempotency";
import { publishableBase, type PublishableResource } from "@/lib/publishable-resources";
import type { ApiResponse } from "@/types/api";
import type { PublishDryRunResult, PublishableCommandResult, RejectResult } from "@/types/publishing";

// The publish engine (doc/05 section 12.7): the same three commands for every publishable entity, `POST /{e}/{id}/...`.
// Every one needs `If-Match` (428 without it, 409 `CONFLICT_LOCK_VERSION` when stale) and answers the root in the shape
// of its own GET plus `aggregate` and `warnings`, with the NEW ETag in the header - the caller puts it in its cache.
export const PublishingAPI = {
  // `dryRun`: the same rules, nothing changes, no new ETag, an answer `{ publishable: true, warnings }`; a 422
  // `PUBLISH_BLOCKED` (`errors[]` blockers with `in: "entity"`, `details.warnings[]`) when it can not be published.
  Publish: async (
    resource: PublishableResource,
    id: number | string,
    etag: string | undefined,
    options: { dryRun?: boolean; changeNote?: string; idempotencyKey?: string } = {}
  ) =>
    withEtag(
      await axiosInstance.post<ApiResponse<PublishableCommandResult | PublishDryRunResult>>(
        API_ENDPOINTS.PUBLISHING.PUBLISH(publishableBase(resource, id)),
        options.changeNote ? { change_note: options.changeNote } : undefined,
        {
          headers: { ...ifMatchHeaders(etag, { required: true }), ...idempotencyKeyHeaders(options.idempotencyKey) },
          params: options.dryRun ? { dry_run: true } : undefined,
        }
      )
    ),
  // Never fails because of a pending draft (it is kept in the History: the warning `draft_kept_as_history`). 409
  // `INVALID_STATE` `is_home` / `not_published`; 409 `ENTITY_REFERENCED` until `confirm_references=true` (the first
  // request never carries it).
  Unpublish: async (
    resource: PublishableResource,
    id: number | string,
    etag: string | undefined,
    options: { confirmReferences?: boolean; idempotencyKey?: string } = {}
  ) =>
    withEtag(
      await axiosInstance.post<ApiResponse<PublishableCommandResult>>(API_ENDPOINTS.PUBLISHING.UNPUBLISH(publishableBase(resource, id)), undefined, {
        headers: { ...ifMatchHeaders(etag, { required: true }), ...idempotencyKeyHeaders(options.idempotencyKey) },
        params: options.confirmReferences ? { confirm_references: true } : undefined,
      })
    ),
  // The draft becomes a `history` revision (note "discarded"), it is not deleted. 409 `INVALID_STATE` `no_draft`.
  DiscardDraft: async (resource: PublishableResource, id: number | string, etag: string | undefined) =>
    withEtag(
      await axiosInstance.post<ApiResponse<PublishableCommandResult>>(API_ENDPOINTS.PUBLISHING.DISCARD_DRAFT(publishableBase(resource, id)), undefined, {
        headers: ifMatchHeaders(etag, { required: true }),
      })
    ),
  // D1 (doc/05 12.10). `note` (<= 200) is an optional message to the reviewer. 409 `INVALID_STATE` `not_draft`. `Idempotency-Key` per dialog open.
  SubmitReview: async (resource: PublishableResource, id: number | string, etag: string | undefined, options: { note?: string; idempotencyKey?: string } = {}) =>
    withEtag(
      await axiosInstance.post<ApiResponse<PublishableCommandResult>>(
        API_ENDPOINTS.PUBLISHING.SUBMIT_REVIEW(publishableBase(resource, id)),
        options.note ? { note: options.note } : undefined,
        { headers: { ...ifMatchHeaders(etag, { required: true }), ...idempotencyKeyHeaders(options.idempotencyKey) } }
      )
    ),
  // The comment is REQUIRED (1..200 characters; 422 at `/comment` `required` / `too_long`). 409 `INVALID_STATE` `not_in_review`. The answer
  // names the history revision that holds the comment (`review_revision`).
  Reject: async (resource: PublishableResource, id: number | string, etag: string | undefined, options: { comment: string; idempotencyKey?: string }) =>
    withEtag(
      await axiosInstance.post<ApiResponse<RejectResult>>(
        API_ENDPOINTS.PUBLISHING.REJECT(publishableBase(resource, id)),
        { comment: options.comment },
        { headers: { ...ifMatchHeaders(etag, { required: true }), ...idempotencyKeyHeaders(options.idempotencyKey) } }
      )
    ),
  // `scheduledAt` = RFC 3339 WITH an offset (>= now + 1 minute, <= now + 1 year; 422 `out_of_range` with `params.min` / `max`). The publish rules
  // run again on the server (422 `PUBLISH_BLOCKED`). Scheduling an already scheduled entity moves the time. 60 per hour (429).
  Schedule: async (resource: PublishableResource, id: number | string, etag: string | undefined, options: { scheduledAt: string; idempotencyKey?: string }) =>
    withEtag(
      await axiosInstance.post<ApiResponse<PublishableCommandResult>>(
        API_ENDPOINTS.PUBLISHING.SCHEDULE(publishableBase(resource, id)),
        { scheduled_at: options.scheduledAt },
        { headers: { ...ifMatchHeaders(etag, { required: true }), ...idempotencyKeyHeaders(options.idempotencyKey) } }
      )
    ),
  // No body, no `Idempotency-Key` (a repeat is a plain 409 `not_scheduled`), never rate limited. scheduled -> draft (never published) / archived.
  Unschedule: async (resource: PublishableResource, id: number | string, etag: string | undefined) =>
    withEtag(
      await axiosInstance.delete<ApiResponse<PublishableCommandResult>>(API_ENDPOINTS.PUBLISHING.SCHEDULE(publishableBase(resource, id)), {
        headers: ifMatchHeaders(etag, { required: true }),
      })
    ),
};
