import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { MissingWebhookEtagError, WebhooksAPI, etagOfWebhook, splitSecret } from "@/services/webhooks.api";
import { server } from "@/test/msw-server";
import type { Webhook } from "@/types/webhooks";

const API = "*/api/v1";
const row = { id: 3, name: "n", etag: '"3-ab"', secret_hint: "wxyz" } as unknown as Webhook;

describe("webhooks service", () => {
  it("splits the one-time secret from the row (the row keeps nothing of it)", () => {
    const { webhook, secret } = splitSecret({ ...row, secret: "whsec_abc" });
    expect(secret).toBe("whsec_abc");
    expect("secret" in webhook).toBe(false);
    expect(splitSecret({ ...row, secret: null }).secret).toBeNull();
    expect(splitSecret(row).secret).toBeNull();
  });

  it("create hands the secret to the callback and returns data WITHOUT it (so no cache can keep it); the ETag comes from the header", async () => {
    server.use(http.post(`${API}/webhooks`, () => HttpResponse.json({ success: true, data: { ...row, secret: "whsec_once" } }, { status: 201, headers: { ETag: '"3-header"' } })));
    let seen: string | null = "unset";
    const res = await WebhooksAPI.Create({ name: "n", url: "https://a.example.com", events: ["media.ready"] }, (s) => (seen = s), "key-9");
    expect(seen).toBe("whsec_once");
    expect(JSON.stringify(res)).not.toContain("whsec_once");
    expect(res.etag).toBe('"3-header"');
  });

  it("create sends the Idempotency-Key; rotate sends If-Match and strips the secret too", async () => {
    const headers: Record<string, string | null> = {};
    server.use(
      http.post(`${API}/webhooks`, ({ request }) => {
        headers.idem = request.headers.get("Idempotency-Key");
        return HttpResponse.json({ success: true, data: { ...row, secret: null } }, { status: 201 });
      }),
      http.post(`${API}/webhooks/3/rotate-secret`, ({ request }) => {
        headers.ifMatch = request.headers.get("If-Match");
        return HttpResponse.json({ success: true, data: { ...row, secret: "whsec_new" } }, { headers: { ETag: '"3-new"' } });
      })
    );
    let got: string | null = "unset";
    await WebhooksAPI.Create({ name: "n", url: "https://a.example.com", events: ["media.ready"] }, (s) => (got = s), "key-9");
    expect(headers.idem).toBe("key-9");
    expect(got).toBeNull();
    const rotated = await WebhooksAPI.RotateSecret(3, '"3-ab"', (s) => (got = s));
    expect(headers.ifMatch).toBe('"3-ab"');
    expect(got).toBe("whsec_new");
    expect(JSON.stringify(rotated)).not.toContain("whsec_new");
  });

  it("PATCH and DELETE need an ETag (no request without one) and send it exactly as given", async () => {
    const ifMatch: Array<string | null> = [];
    server.use(
      http.patch(`${API}/webhooks/3`, ({ request }) => {
        ifMatch.push(request.headers.get("If-Match"));
        return HttpResponse.json({ success: true, data: row });
      }),
      http.delete(`${API}/webhooks/3`, ({ request }) => {
        ifMatch.push(request.headers.get("If-Match"));
        return HttpResponse.json({ success: true, data: null });
      })
    );
    await expect(WebhooksAPI.Update(3, { name: "x" }, undefined)).rejects.toThrow();
    await expect(WebhooksAPI.Delete(3, undefined)).rejects.toThrow();
    expect(ifMatch).toEqual([]);
    await WebhooksAPI.Update(3, { name: "x" }, '"3-ab"');
    await WebhooksAPI.Delete(3, '"3-ab"');
    expect(ifMatch).toEqual(['"3-ab"', '"3-ab"']);
  });

  it("uses the etag field, never updated_at", () => {
    expect(etagOfWebhook({ etag: '"3-ab"' })).toBe('"3-ab"');
    expect(etagOfWebhook({ etag: '"3-ab"' }, '"3-hdr"')).toBe('"3-hdr"');
    expect(() => etagOfWebhook({ etag: "" })).toThrow(MissingWebhookEtagError);
  });

  it("retry posts to the delivery, not the webhook", async () => {
    let url = "";
    server.use(http.post(`${API}/webhook-deliveries/:id/retry`, ({ request }) => {
      url = new URL(request.url).pathname;
      return HttpResponse.json({ success: true, data: { id: 41, status: "pending" } });
    }));
    await WebhooksAPI.Retry(41);
    expect(url).toMatch(/\/webhook-deliveries\/41\/retry$/);
  });
});
