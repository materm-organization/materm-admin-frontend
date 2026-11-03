import { beforeEach, describe, expect, it } from "vitest";

import { MockHttpError } from "@/mocks/mock-core";
import { createMockDb } from "@/mocks/mock-db";
import {
  createWebhook,
  deleteWebhook,
  etagOfRow,
  getWebhook,
  listWebhookDeliveries,
  listWebhooks,
  patchWebhook,
  retryWebhookDelivery,
  rotateWebhookSecret,
  testWebhook,
} from "@/mocks/mock-webhooks";

let db = createMockDb();
beforeEach(() => {
  db = createMockDb();
});
const q = (s = "") => new URLSearchParams(s);
const fails = (fn: () => unknown, status: number) => {
  try {
    fn();
  } catch (e) {
    const err = e as MockHttpError;
    expect(err.status).toBe(status);
    return err;
  }
  throw new Error("expected a failure");
};
const errs = (e: MockHttpError) => e.body.errors as Array<{ path: string; code: string; params?: unknown }>;
const codes = (e: MockHttpError) => errs(e).map((x) => `${x.path}:${x.code}`);
const good = { name: "Hook", url: "https://hooks.example.org/a", events: ["media.ready"] };
const etag = (id: number) => etagOfRow(db.webhooks.rows.find((r) => r.id === id)!);

describe("webhooks mock (doc/05 section 16)", () => {
  it("lists with filters and sorts, never with a secret", () => {
    const all = listWebhooks(db, q());
    expect(all.data.map((w) => w.id)).toEqual([3, 2, 1]);
    expect(JSON.stringify(all.data)).not.toContain("whsec_");
    expect(all.data.every((w) => "secret" in w === false)).toBe(true);
    expect(listWebhooks(db, q("is_active=true")).data.map((w) => w.id)).toEqual([1]);
    expect(listWebhooks(db, q("event=user.created")).data.map((w) => w.id)).toEqual([2]);
    expect(listWebhooks(db, q("keyword=crm")).data.map((w) => w.id)).toEqual([1]);
    expect(listWebhooks(db, q("keyword=mirror.example")).data.map((w) => w.id)).toEqual([3]);
    expect(listWebhooks(db, q("sort=name")).data.map((w) => w.name)).toEqual(["Backup mirror", "CRM sync", "Slack relay"]);
    fails(() => listWebhooks(db, q("event=webhook.test")), 422);
    fails(() => listWebhooks(db, q("bogus=1")), 422);
    fails(() => listWebhooks(db, q("sort=url")), 422);
    fails(() => listWebhooks(db, q("is_active=maybe")), 422);
  });

  it("a row has +07:00 6-digit timestamps, a hash etag (not updated_at) and the same value in the header answer", () => {
    const { data, etag: header } = getWebhook(db, "1");
    expect(data.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+07:00$/);
    expect(data.last_success_at).toMatch(/\.\d{6}\+07:00$/);
    expect(data.etag).toBe(header);
    expect(data.etag).toMatch(/^"1-[0-9a-f]{8}"$/);
    expect(data.etag).not.toContain(data.updated_at);
  });

  it("create answers the secret once (whsec_ + 43), keeps secret_hint, and a replay of the same Idempotency-Key has secret null", () => {
    const first = createWebhook(db, good, "key-1");
    expect(first.data.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(first.data.secret_hint).toBe(first.data.secret!.slice(-4));
    expect(first.data.events).toEqual(["media.ready"]);
    expect(first.data.timeout_ms).toBe(5000);
    expect(first.data.max_attempts).toBe(8);
    const replay = createWebhook(db, good, "key-1");
    expect(replay.data.secret).toBeNull();
    expect(replay.data.id).toBe(first.data.id);
    expect(db.webhooks.rows).toHaveLength(4);
    fails(() => createWebhook(db, { ...good, name: "Other" }, "key-1"), 422);
    // get / list never show it
    expect(JSON.stringify(getWebhook(db, String(first.data.id)))).not.toContain("whsec_");
  });

  it("reports every problem at once with the contract's codes and JSON pointers", () => {
    const e = fails(() => createWebhook(db, { name: " ", url: "http://user:pw@host.example.com:8443/x#f", events: ["bogus", "media.ready", "media.ready"], timeout_ms: 50, is_active: "yes", extra: 1 }, null), 422);
    expect(codes(e)).toEqual(
      expect.arrayContaining(["/extra:unknown_field", "/name:required", "/url:scheme_not_allowed", "/url:credentials_not_allowed", "/url:port_not_allowed", "/events/0:unknown_value", "/events/2:duplicate", "/is_active:invalid_type", "/timeout_ms:out_of_range"])
    );
    expect(errs(e).find((x) => x.code === "port_not_allowed")?.params).toEqual({ allowed: ["443"] });
    expect(codes(fails(() => createWebhook(db, { name: "a" }, null), 422))).toEqual(["/url:required", "/events:required"]);
    expect(codes(fails(() => createWebhook(db, { name: "a", url: "not a url", events: [] }, null), 422))).toEqual(["/url:invalid_url", "/events:required"]);
    expect(codes(fails(() => createWebhook(db, { ...good, name: "x".repeat(81) }, null), 422))).toEqual(["/name:too_long"]);
    expect(db.webhooks.rows).toHaveLength(3);
  });

  it.each([
    ["https://localhost/x", "host_not_allowed"],
    ["https://db.internal/x", "host_not_allowed"],
    ["https://printer.local/x", "host_not_allowed"],
    ["https://2130706433/x", "address_not_allowed"],
    ["https://127.0.0.1/x", "address_not_allowed"],
    ["https://10.1.2.3/x", "address_not_allowed"],
    ["https://169.254.169.254/x", "address_not_allowed"],
    ["https://172.20.0.1/x", "address_not_allowed"],
    ["https://192.168.1.1/x", "address_not_allowed"],
    ["https://[::1]/x", "address_not_allowed"],
    ["https://private.example.com/x", "address_not_allowed"],
    ["https://nope.invalid/x", "unresolvable_host"],
  ])("the early URL check refuses %s as %s", (url, code) => {
    const e = fails(() => createWebhook(db, { ...good, url }, null), 422);
    // `2130706433` has no dot: the URL parser turns it into 127.0.0.1
    expect(errs(e).map((x) => x.code)).toContain(code);
  });

  it("a public IP literal over https passes the early check without any network", () => {
    expect(createWebhook(db, { ...good, url: "https://93.184.216.34/hook" }, null).data.url).toBe("https://93.184.216.34/hook");
  });

  it("patch needs If-Match (428), refuses a stale one (409), sends the same etag back for no change and a new one for a change", () => {
    fails(() => patchWebhook(db, "1", { name: "CRM" }, null), 428);
    const old = etag(1);
    expect(patchWebhook(db, "1", { name: "CRM sync" }, old).etag).toBe(old);
    const changed = patchWebhook(db, "1", { name: "CRM 2" }, old);
    expect(changed.etag).not.toBe(old);
    expect(changed.data.name).toBe("CRM 2");
    expect(fails(() => patchWebhook(db, "1", { name: "CRM 3" }, old), 409).body.code).toBe("CONFLICT_LOCK_VERSION");
    expect(codes(fails(() => patchWebhook(db, "1", {}, changed.etag), 422))).toEqual([":min_properties"]);
    expect(codes(fails(() => patchWebhook(db, "1", { id: 4 }, changed.etag), 422))).toEqual(["/id:unknown_field"]);
  });

  it("the worker's statistics do not move the etag", () => {
    const before = etag(1);
    const row = db.webhooks.rows.find((r) => r.id === 1)!;
    row.consecutive_failures = 3;
    row.last_success_at = "2026-11-03T10:00:00.000001+07:00";
    row.updated_at = "2026-11-03T10:00:01.000001+07:00";
    expect(etag(1)).toBe(before);
  });

  it("is_active:true on a webhook the system switched off clears the reason and the failure count", () => {
    const res = patchWebhook(db, "2", { is_active: true }, etag(2));
    expect(res.data).toMatchObject({ is_active: true, disabled_reason: null, consecutive_failures: 0 });
  });

  it("rotate-secret needs If-Match, gives a new secret once and changes hint and etag", () => {
    fails(() => rotateWebhookSecret(db, "1", null), 428);
    const old = etag(1);
    const res = rotateWebhookSecret(db, "1", old);
    expect(res.data.secret).toMatch(/^whsec_/);
    expect(res.data.secret_hint).toBe(res.data.secret!.slice(-4));
    expect(res.data.secret_hint).not.toBe("ab12");
    expect(res.etag).not.toBe(old);
    expect(JSON.stringify(getWebhook(db, "1"))).not.toContain(res.data.secret!);
  });

  it("without the secret key create, rotate and test answer 503 with details.dependency", () => {
    db.webhooks.unconfigured = true;
    for (const fn of [() => createWebhook(db, good, null), () => rotateWebhookSecret(db, "1", etag(1)), () => testWebhook(db, "1")]) {
      const e = fails(fn, 503);
      expect(e.body).toMatchObject({ code: "SERVICE_UNAVAILABLE", details: { dependency: "security.webhookSecretKey" } });
    }
    expect(db.webhooks.rows).toHaveLength(3);
  });

  it("delete needs If-Match, is gone for good (404) and takes its deliveries away", () => {
    fails(() => deleteWebhook(db, "1", null), 428);
    deleteWebhook(db, "1", etag(1));
    fails(() => getWebhook(db, "1"), 404);
    fails(() => listWebhookDeliveries(db, "1", q()), 404);
    expect(listWebhooks(db, q()).data.map((w) => w.id)).toEqual([3, 2]);
  });

  it("test: ok, http_status (with a snippet), timeout, blocked; a delivery row is written; not counted as a failure", () => {
    const ok = testWebhook(db, "1");
    expect(ok).toMatchObject({ ok: true, status_code: 200, error_class: null });
    expect(testWebhook(db, "2")).toMatchObject({ ok: false, status_code: 500, error_class: "http_status" });
    const row = db.webhooks.rows.find((r) => r.id === 2)!;
    expect(row.consecutive_failures).toBe(31);
    const rows = listWebhookDeliveries(db, "1", q("event=webhook.test"));
    expect(rows.data[0]).toMatchObject({ event_type: "webhook.test", status: "succeeded" });
    const slow = createWebhook(db, { ...good, url: "https://slow.example.org/x" }, null).data;
    expect(testWebhook(db, String(slow.id))).toMatchObject({ ok: false, status_code: null, error_class: "timeout" });
  });

  it("test is limited to 10 a minute (429 with Retry-After)", () => {
    for (let i = 0; i < 10; i++) testWebhook(db, "1");
    const e = fails(() => testWebhook(db, "1"), 429);
    expect(e.body.code).toBe("RATE_LIMITED");
    expect(e.headers["Retry-After"]).toBe("30");
  });

  it("deliveries: newest first, paginated, filtered by a status list and an event, strict", () => {
    const page1 = listWebhookDeliveries(db, "1", q());
    expect(page1.data).toHaveLength(20);
    expect(page1.meta.total).toBe(25);
    expect(page1.data[0].created_at).toMatch(/\+07:00$/);
    expect(page1.data.map((d) => d.created_at)).toEqual([...page1.data.map((d) => d.created_at)].sort().reverse());
    expect(listWebhookDeliveries(db, "1", q("page=2")).data).toHaveLength(5);
    expect(listWebhookDeliveries(db, "1", q("status=failed,dead")).data.map((d) => d.status).sort()).toEqual(["dead", "failed"]);
    expect(listWebhookDeliveries(db, "1", q("event=webhook.test")).data).toHaveLength(1);
    const e = fails(() => listWebhookDeliveries(db, "1", q("status=bogus")), 422);
    expect(errs(e)[0]).toMatchObject({ path: "/status", code: "unknown_value" });
    fails(() => listWebhookDeliveries(db, "1", q("event=bogus")), 422);
  });

  it("retry: failed and dead go back to pending (dead restarts at attempt 0); the other states are 409 INVALID_STATE with details.reason", () => {
    const byStatus = (s: string) => db.webhooks.deliveries.find((d) => d.webhook_id === 1 && d.status === s && d.event_type !== "webhook.test")!;
    expect(retryWebhookDelivery(db, String(byStatus("failed").id))).toMatchObject({ status: "pending", attempt: 2 });
    expect(retryWebhookDelivery(db, String(byStatus("dead").id))).toMatchObject({ status: "pending", attempt: 0 });
    const reason = (id: number) => (fails(() => retryWebhookDelivery(db, String(id)), 409).body.details as { reason: string }).reason;
    expect(reason(byStatus("pending").id)).toBe("pending");
    expect(reason(byStatus("delivering").id)).toBe("delivering");
    expect(reason(byStatus("succeeded").id)).toBe("succeeded");
    expect(reason(db.webhooks.deliveries.find((d) => d.event_type === "webhook.test")!.id)).toBe("test_delivery");
    expect(reason(db.webhooks.deliveries.find((d) => d.webhook_id === 2 && d.status === "dead")!.id)).toBe("webhook_inactive");
    fails(() => retryWebhookDelivery(db, "9999"), 404);
  });
});
