import { beforeEach, describe, expect, it } from "vitest";

import { MockHttpError, getMockDb, resetMockDb } from "@/mocks/mock-db";
import { listAuditLogs, setAuditCaller } from "@/mocks/mock-audit";

const q = (query: string) => listAuditLogs(getMockDb(), new URLSearchParams(query));
const fails = (query: string, status: number) => {
  try {
    q(query);
  } catch (error) {
    expect(error).toBeInstanceOf(MockHttpError);
    expect((error as MockHttpError).status).toBe(status);
    return;
  }
  throw new Error("expected the call to fail");
};

beforeEach(() => resetMockDb());

describe("GET /audit-logs: who may ask which shape", () => {
  it("an auditor (ops.audit:read) may use every filter", () => {
    setAuditCaller(getMockDb(), { "ops.audit": ["read"] });
    expect(q("action=iam.user.updated").data).toHaveLength(1);
    expect(q("entity_type=iam.role").data).toHaveLength(1);
    expect(q("").meta.total).toBe(19);
  });

  it("without ops.audit:read the TAB SHAPE (entity_type + entity_id + from/to/page/limit/sort) works with read on the entity key", () => {
    setAuditCaller(getMockDb(), { "iam.users": ["read"] });
    expect(q("entity_type=iam.user&entity_id=1&limit=20&page=1&sort=-occurred_at&from=2026-10-27T00:00:00Z&to=2026-10-28T00:00:00Z").data.map((r) => r.id)).toEqual([2, 1]);
  });

  it("the History tab of a webhook (ops.webhook) opens with ops.webhooks:read and not with another key", () => {
    setAuditCaller(getMockDb(), { "ops.webhooks": ["read"] });
    expect(q("entity_type=ops.webhook&entity_id=1").data.map((r) => r.action)).toEqual(["ops.webhook.secret_rotated", "ops.webhook.tested", "ops.webhook.updated", "ops.webhook.created"]);
    expect(q("entity_type=ops.webhook&entity_id=2").data[0]).toMatchObject({ action: "ops.webhook.disabled", actor_type: "system" });
    setAuditCaller(getMockDb(), { "ops.system": ["read"], "iam.users": ["read"] });
    fails("entity_type=ops.webhook&entity_id=1", 403);
  });

  it("without ops.audit:read any other shape is 403, even with read on the entity", () => {
    setAuditCaller(getMockDb(), { "iam.users": ["read"] });
    fails("entity_type=iam.user&entity_id=1&action=iam.user.updated", 403);
    fails("entity_type=iam.user&entity_id=1&actor_id=6", 403);
    fails("entity_type=iam.user", 403);
    fails("", 403);
  });

  it("without read on the entity's key the tab shape is 403 too", () => {
    setAuditCaller(getMockDb(), { "cms.pages": ["read"] });
    fails("entity_type=iam.user&entity_id=1", 403);
    fails("entity_type=unknown.thing&entity_id=1", 403);
  });

  it("unknown keys are 422 and entity_id needs entity_type", () => {
    fails("keyword=a", 422);
    fails("entity_id=1", 422);
  });
});

describe("GET /audit-logs: collection tabs (entity_id=0)", () => {
  it("entity_id=0 returns the whole trail of cms.locale / cms.ui_string / cms.ui_strings_bundle with the new summaries", () => {
    setAuditCaller(getMockDb(), { "cms.locales": ["read"], "cms.ui_strings": ["read"] });
    expect(q("entity_type=cms.locale&entity_id=0").data.map((r) => r.summary)).toEqual(["locale lo updated: is_active, fallback_code"]);
    const strings = q("entity_type=cms.ui_string&entity_id=0&limit=20").data.map((r) => r.summary);
    expect(strings).toContain("nav.home: restore of v2");
    expect(strings.some((x) => x?.startsWith("bundle "))).toBe(true);
    expect(q("entity_type=cms.ui_strings_bundle&entity_id=0").data[0].summary).toBe("bundle 3f9c2ab: inserted=2 source_updated=1 kept_override=4");
  });

  it("entity_id=0 stays invalid for any other entity type, and an extra filter on a collection tab is 403 without ops.audit:read", () => {
    setAuditCaller(getMockDb(), { "cms.locales": ["read"], "iam.users": ["read"] });
    fails("entity_type=iam.user&entity_id=0", 422);
    fails("entity_type=cms.locale&entity_id=0&action=cms.locale.updated", 403);
  });

  it("needs read on the key of that entity", () => {
    setAuditCaller(getMockDb(), { "cms.locales": ["read"] });
    fails("entity_type=cms.ui_string&entity_id=0", 403);
  });
});
