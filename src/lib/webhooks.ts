// Pure helpers of the webhooks screen (SCR-43, doc/05 section 16): the five events, the editable draft, the checks that save a round trip,
// and the classifiers of the answers the screen branches on. No React, no secrets.
import { parseApiError } from "@/lib/api-error";
import type { ApiFieldError } from "@/types/api";
import type { CreateWebhookPayload, UpdateWebhookPayload, Webhook, WebhookEvent } from "@/types/webhooks";

export const WEBHOOK_EVENTS: readonly WebhookEvent[] = ["content.published", "content.unpublished", "form.submitted", "media.ready", "user.created"];
export const MAX_NAME = 80;
export const MAX_URL = 2048;
export const MIN_TIMEOUT_MS = 1000;
export const MAX_TIMEOUT_MS = 10000;
export const DEFAULT_TIMEOUT_MS = 5000;

export type WebhookDraft = { name: string; url: string; events: WebhookEvent[]; isActive: boolean; timeout: string };

export const emptyDraft = (): WebhookDraft => ({ name: "", url: "", events: [], isActive: true, timeout: String(DEFAULT_TIMEOUT_MS) });
export const draftFromWebhook = (w: Webhook): WebhookDraft => ({
  name: w.name,
  url: w.url,
  events: sortEvents(w.events),
  isActive: w.is_active,
  timeout: String(w.timeout_ms),
});

export function sortEvents(events: readonly WebhookEvent[]): WebhookEvent[] {
  return WEBHOOK_EVENTS.filter((e) => events.includes(e));
}

export const parseTimeout = (value: string): number | null => (/^\d+$/.test(value.trim()) ? Number(value.trim()) : null);

const len = (v: string) => [...v.trim()].length;
const body = (path: string, code: string, params?: ApiFieldError["params"]): ApiFieldError => ({ in: "body", path, code, ...(params ? { params } : {}) });

// What can be told without the server (it still checks everything again; the URL rules, above all the SSRF ones, are the server's alone).
export function validate(d: WebhookDraft): ApiFieldError[] {
  const errors: ApiFieldError[] = [];
  if (d.name.trim() === "") errors.push(body("/name", "required"));
  else if (len(d.name) > MAX_NAME) errors.push(body("/name", "too_long", { max: MAX_NAME }));
  if (d.url.trim() === "") errors.push(body("/url", "required"));
  else if ([...d.url.trim()].length > MAX_URL) errors.push(body("/url", "too_long", { max: MAX_URL }));
  if (d.events.length === 0) errors.push(body("/events", "required"));
  const timeout = parseTimeout(d.timeout);
  if (timeout === null) errors.push(body("/timeout_ms", "invalid_type"));
  else if (timeout < MIN_TIMEOUT_MS || timeout > MAX_TIMEOUT_MS) errors.push(body("/timeout_ms", "out_of_range", { min: MIN_TIMEOUT_MS, max: MAX_TIMEOUT_MS }));
  return errors;
}

export function buildCreatePayload(d: WebhookDraft): CreateWebhookPayload {
  return { name: d.name.trim(), url: d.url.trim(), events: sortEvents(d.events), is_active: d.isActive, timeout_ms: parseTimeout(d.timeout) ?? DEFAULT_TIMEOUT_MS };
}

// Only what changed (a PATCH needs at least one field; the server answers "unchanged" with the same ETag).
export function buildUpdatePayload(saved: WebhookDraft, d: WebhookDraft): UpdateWebhookPayload {
  const out: UpdateWebhookPayload = {};
  if (d.name.trim() !== saved.name.trim()) out.name = d.name.trim();
  if (d.url.trim() !== saved.url.trim()) out.url = d.url.trim();
  if (sortEvents(d.events).join() !== sortEvents(saved.events).join()) out.events = sortEvents(d.events);
  if (d.isActive !== saved.isActive) out.is_active = d.isActive;
  const timeout = parseTimeout(d.timeout);
  if (timeout !== null && timeout !== parseTimeout(saved.timeout)) out.timeout_ms = timeout;
  return out;
}

export const isChanged = (saved: WebhookDraft, d: WebhookDraft) => Object.keys(buildUpdatePayload(saved, d)).length > 0;

// The error of a field, wherever the server put it: `/events/2` belongs to the events group.
export function issueFor(issues: ApiFieldError[], field: "name" | "url" | "events" | "is_active" | "timeout_ms"): ApiFieldError | undefined {
  return issues.find((i) => i.path === `/${field}` || i.path.startsWith(`/${field}/`));
}

// The server cannot do the thing because its own configuration is missing: 503 `SERVICE_UNAVAILABLE` with `details.dependency` =
// `security.webhookSecretKey` or `webhooks.enabled` (create, rotate-secret, test). Other 503s are "temporarily unavailable".
export function isNotConfigured(error: unknown): boolean {
  const parsed = parseApiError(error);
  if (parsed.status !== 503) return false;
  const dependency = parsed.details?.dependency;
  return dependency === "security.webhookSecretKey" || dependency === "webhooks.enabled";
}

export type TestFailure = { kind: "not_configured" } | { kind: "rate_limited"; retryAfter?: number } | { kind: "unavailable" } | { kind: "other" };
export function classifyTestFailure(error: unknown): TestFailure {
  const parsed = parseApiError(error);
  if (isNotConfigured(error)) return { kind: "not_configured" };
  if (parsed.status === 429 || parsed.code === "RATE_LIMITED") return { kind: "rate_limited", retryAfter: parsed.retryAfter };
  if (parsed.status === 503) return { kind: "unavailable" };
  return { kind: "other" };
}

export const RETRY_REASONS = ["pending", "delivering", "succeeded", "test_delivery", "webhook_inactive"] as const;
export type RetryReason = (typeof RETRY_REASONS)[number];
// 409 `INVALID_STATE` of a retry: `details.reason`; undefined = not an INVALID_STATE answer.
export function retryRefusal(error: unknown): RetryReason | "unknown" | undefined {
  const parsed = parseApiError(error);
  if (parsed.status !== 409 || parsed.code !== "INVALID_STATE") return undefined;
  const reason = parsed.details?.reason;
  return (RETRY_REASONS as readonly unknown[]).includes(reason) ? (reason as RetryReason) : "unknown";
}

export const ERROR_CLASSES = ["blocked_address", "dns_failed", "timeout", "tls_failed", "connect_failed", "http_status", "secret_unavailable", "payload_too_large", "canceled", "webhook_inactive"] as const;
export const isKnownErrorClass = (v: string): boolean => (ERROR_CLASSES as readonly string[]).includes(v);

// `allowed` in field-error params may be a list.
export function paramText(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

// A delivery can be sent again only when it failed for good or is waiting for its next try, and its webhook is on.
export const canRetryStatus = (status: string) => status === "failed" || status === "dead";

// The audit action `ops.webhook.secret_rotated` -> `secret_rotated`.
export const auditActionSuffix = (action: string) => (action.startsWith("ops.webhook.") ? action.slice("ops.webhook.".length) : action);
