import { AxiosError, type AxiosResponse } from "axios";
import { describe, expect, it } from "vitest";

import {
  auditActionSuffix,
  buildCreatePayload,
  buildUpdatePayload,
  canRetryStatus,
  classifyTestFailure,
  draftFromWebhook,
  emptyDraft,
  isChanged,
  isNotConfigured,
  issueFor,
  paramText,
  retryRefusal,
  sortEvents,
  validate,
} from "@/lib/webhooks";
import type { Webhook } from "@/types/webhooks";

const failure = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new AxiosError("x", "ERR", undefined, undefined, { status, data: body, headers, statusText: "", config: {} as never } as AxiosResponse);

const hook: Webhook = {
  id: 1, public_id: "p", name: "CRM", url: "https://hooks.example.com/a", events: ["form.submitted", "content.published"], is_active: true, timeout_ms: 5000, max_attempts: 8,
  secret_hint: "ab12", consecutive_failures: 0, last_success_at: null, disabled_reason: null, created_at: "", updated_at: "", etag: '"1-aaaa"',
};

describe("webhook draft", () => {
  it("validates what can be told without the server, all at once", () => {
    expect(validate(emptyDraft()).map((e) => `${e.path}:${e.code}`)).toEqual(["/name:required", "/url:required", "/events:required"]);
    const d = { ...emptyDraft(), name: "x".repeat(81), url: "https://a.example.com", events: ["media.ready" as const], timeout: "999" };
    expect(validate(d).map((e) => `${e.path}:${e.code}`)).toEqual(["/name:too_long", "/timeout_ms:out_of_range"]);
    expect(validate({ ...d, name: "ok", timeout: "5s" }).map((e) => e.code)).toEqual(["invalid_type"]);
    expect(validate({ ...d, name: "ok", timeout: "10000" })).toEqual([]);
    expect(validate({ ...d, name: "ok", timeout: "1000" })).toEqual([]);
  });

  it("does not judge the URL: https, private addresses and ports are the server's call", () => {
    const d = { ...emptyDraft(), name: "n", events: ["media.ready" as const] };
    for (const url of ["http://localhost", "https://10.0.0.1", "ftp://x", "nonsense"]) expect(validate({ ...d, url })).toEqual([]);
  });

  it("builds the create body trimmed, events in the fixed order, the default timeout", () => {
    expect(buildCreatePayload({ name: " CRM ", url: " https://a.example.com/x ", events: ["user.created", "content.published"], isActive: false, timeout: "" })).toEqual({
      name: "CRM", url: "https://a.example.com/x", events: ["content.published", "user.created"], is_active: false, timeout_ms: 5000,
    });
  });

  it("builds a PATCH with only what changed (events compared as a set)", () => {
    const saved = draftFromWebhook(hook);
    expect(saved.events).toEqual(["content.published", "form.submitted"]);
    expect(buildUpdatePayload(saved, saved)).toEqual({});
    expect(isChanged(saved, { ...saved, events: ["form.submitted", "content.published"] })).toBe(false);
    expect(buildUpdatePayload(saved, { ...saved, name: "  CRM 2 ", timeout: "7000", isActive: false })).toEqual({ name: "CRM 2", timeout_ms: 7000, is_active: false });
    expect(buildUpdatePayload(saved, { ...saved, events: ["media.ready"] })).toEqual({ events: ["media.ready"] });
    expect(sortEvents(["user.created", "content.published"])).toEqual(["content.published", "user.created"]);
  });

  it("finds a field error wherever the server put it", () => {
    const issues = [{ in: "body" as const, path: "/events/2", code: "duplicate" }, { in: "body" as const, path: "/url", code: "invalid_url" }];
    expect(issueFor(issues, "events")?.code).toBe("duplicate");
    expect(issueFor(issues, "url")?.code).toBe("invalid_url");
    expect(issueFor(issues, "name")).toBeUndefined();
    expect(paramText(["443", "8443"])).toBe("443, 8443");
    expect(paramText(undefined)).toBe("");
  });
});

describe("answers the screen branches on", () => {
  it("503 with details.dependency = security.webhookSecretKey or webhooks.enabled is 'not configured'; another 503 is not", () => {
    for (const dependency of ["security.webhookSecretKey", "webhooks.enabled"]) {
      const e = failure(503, { code: "SERVICE_UNAVAILABLE", details: { dependency } });
      expect(isNotConfigured(e)).toBe(true);
      expect(classifyTestFailure(e)).toEqual({ kind: "not_configured" });
    }
    const other = failure(503, { code: "SERVICE_UNAVAILABLE", details: { dependency: "redis" } });
    expect(isNotConfigured(other)).toBe(false);
    expect(classifyTestFailure(other)).toEqual({ kind: "unavailable" });
    expect(isNotConfigured(failure(500, { code: "INTERNAL_ERROR" }))).toBe(false);
  });

  it("429 keeps Retry-After; anything else is 'other'", () => {
    expect(classifyTestFailure(failure(429, { code: "RATE_LIMITED" }, { "retry-after": "30" }))).toEqual({ kind: "rate_limited", retryAfter: 30 });
    expect(classifyTestFailure(failure(404, { code: "NOT_FOUND" }))).toEqual({ kind: "other" });
    expect(classifyTestFailure(new Error("boom"))).toEqual({ kind: "other" });
  });

  it("a retry refusal is INVALID_STATE with a known details.reason", () => {
    for (const reason of ["pending", "delivering", "succeeded", "test_delivery", "webhook_inactive"])
      expect(retryRefusal(failure(409, { code: "INVALID_STATE", details: { reason } }))).toBe(reason);
    expect(retryRefusal(failure(409, { code: "INVALID_STATE", details: { reason: "new_one" } }))).toBe("unknown");
    expect(retryRefusal(failure(409, { code: "CONFLICT_LOCK_VERSION" }))).toBeUndefined();
    expect(retryRefusal(failure(404, { code: "NOT_FOUND" }))).toBeUndefined();
  });

  it("only failed and dead deliveries can be retried; audit actions lose their prefix", () => {
    expect(["pending", "delivering", "succeeded", "failed", "dead"].filter(canRetryStatus)).toEqual(["failed", "dead"]);
    expect(auditActionSuffix("ops.webhook.secret_rotated")).toBe("secret_rotated");
    expect(auditActionSuffix("iam.user.created")).toBe("iam.user.created");
  });
});
