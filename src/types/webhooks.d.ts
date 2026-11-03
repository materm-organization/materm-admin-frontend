// External webhooks (doc/05 section 16, doc/api/openapi-admin.yaml: Webhook, CreateWebhookRequest, UpdateWebhookRequest, WebhookTestResult,
// WebhookDelivery). Key `ops.webhooks`, super_admin only. The ETag is a HASH of the editable fields (`etag`, also the `ETag` header), NOT
// `updated_at`: the worker writes statistics all the time. Send it back in `If-Match` exactly as given.
import type { UserRef } from "@/types/media";

export type WebhookEvent = "content.published" | "content.unpublished" | "form.submitted" | "media.ready" | "user.created";
// `webhook.test` exists only on deliveries (a test send); nobody can subscribe to it.
export type WebhookDeliveryEvent = WebhookEvent | "webhook.test";

export type WebhookDisabledReason = "auto_24h_failure";

export type Webhook = {
  id: number;
  public_id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  is_active: boolean;
  timeout_ms: number;
  max_attempts: number;
  // The last 4 characters of the CURRENT secret. The secret itself is never part of this type: see `WebhookWithSecret`.
  secret_hint: string;
  consecutive_failures: number;
  last_success_at: string | null;
  disabled_reason: WebhookDisabledReason | null;
  created_by?: UserRef;
  updated_by?: UserRef;
  created_at: string;
  updated_at: string;
  etag: string;
};

// What the server answers to create and rotate-secret ONLY. It is split at the service boundary (`services/webhooks.api.ts`): the
// secret goes to a callback, the rest is what React Query may keep.
export type WebhookWithSecret = Webhook & { secret?: string | null };

export type WebhooksQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  is_active?: boolean | "true" | "false";
  event?: WebhookEvent;
  sort?: string;
};

export type CreateWebhookPayload = {
  name: string;
  url: string;
  events: WebhookEvent[];
  is_active?: boolean;
  timeout_ms?: number;
};
export type UpdateWebhookPayload = Partial<CreateWebhookPayload>;

export type WebhookTestResult = {
  delivery_id: number;
  ok: boolean;
  status_code: number | null;
  latency_ms: number | null;
  response_snippet: string | null;
  error_class: string | null;
};

export type WebhookDeliveryStatus = "pending" | "delivering" | "succeeded" | "failed" | "dead";

export type WebhookDelivery = {
  id: number;
  webhook_id: number;
  event_type: WebhookDeliveryEvent;
  event_id: string;
  status: WebhookDeliveryStatus;
  attempt: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_status_code: number | null;
  last_error: string | null;
  response_ms: number | null;
  response_body: string | null;
  delivered_at: string | null;
  created_at: string;
};

export type WebhookDeliveriesQuery = {
  page?: number;
  limit?: number;
  status?: string;
  event?: WebhookDeliveryEvent;
  sort?: string;
};
