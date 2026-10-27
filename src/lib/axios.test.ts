import { http, HttpResponse } from "msw";
import Cookies from "js-cookie";
import { beforeEach, describe, expect, it } from "vitest";

import { clearSession, getAccessToken, setTokens } from "@/lib/auth-session";
import { axiosInstance, axiosPublicInstance } from "@/lib/axios";
import { ifMatchHeaders, withEtag } from "@/lib/etag";
import { idempotencyKeyHeaders } from "@/lib/idempotency";
import { isNoPermissionError, parseApiError } from "@/lib/api-error";
import { server } from "@/test/msw-server";

const API = "http://localhost:3000/api/v1";

beforeEach(() => {
  clearSession();
  Cookies.remove("locale");
});

describe("Accept-Language (F-3, C-19)", () => {
  it("sends the UI locale cookie, `la` by default, on both instances", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(`${API}/ping`, ({ request }) => {
        seen.push(request.headers.get("accept-language"));
        return HttpResponse.json({ success: true, data: null });
      })
    );
    await axiosInstance.get("/ping");
    Cookies.set("locale", "en");
    await axiosInstance.get("/ping");
    await axiosPublicInstance.get("/ping");
    Cookies.set("locale", "xx");
    await axiosPublicInstance.get("/ping");
    expect(seen).toEqual(["la", "en", "en", "la"]);
  });
});

describe("403 is a read refusal, not a session problem (NoPermission, no retry)", () => {
  it("rejects once: no retry, no refresh, session kept", async () => {
    setTokens({ access: "A1", refresh: "R1" });
    let calls = 0;
    let refreshes = 0;
    server.use(
      http.get(`${API}/things`, () => {
        calls += 1;
        return HttpResponse.json({ success: false, code: "FORBIDDEN", message: "no" }, { status: 403 });
      }),
      http.get(`${API}/jwt/refresh`, () => {
        refreshes += 1;
        return HttpResponse.json({ success: true, data: { access: "A2", refresh: "R2" } });
      })
    );
    const error = await axiosInstance.get("/things").then(
      () => null,
      (e: unknown) => e
    );
    expect(calls).toBe(1);
    expect(refreshes).toBe(0);
    expect(isNoPermissionError(error)).toBe(true);
    expect(parseApiError(error).code).toBe("FORBIDDEN");
    expect(getAccessToken()).toBe("A1");
  });
});

describe("single-flight refresh (F-1)", () => {
  it("several concurrent 401s trigger ONE refresh and each request is retried once", async () => {
    setTokens({ access: "OLD", refresh: "R1" });
    let refreshes = 0;
    const attempts: string[] = [];
    server.use(
      http.get(`${API}/jwt/refresh`, async () => {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 20));
        return HttpResponse.json({ success: true, data: { access: "NEW", refresh: "R2" } });
      }),
      http.get(`${API}/items/:n`, ({ request, params }) => {
        const auth = request.headers.get("authorization");
        attempts.push(`${params.n}:${auth}`);
        if (auth !== "Bearer NEW") {
          return HttpResponse.json({ success: false, code: "TOKEN_EXPIRED" }, { status: 401 });
        }
        return HttpResponse.json({ success: true, data: params.n });
      })
    );
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => axiosInstance.get(`/items/${n}`)));
    expect(results.map((r) => r.data.data)).toEqual(["1", "2", "3", "4", "5"]);
    expect(refreshes).toBe(1);
    expect(attempts.filter((a) => a.endsWith("NEW"))).toHaveLength(5);
    expect(getAccessToken()).toBe("NEW");
  });
});

describe("ETag / If-Match round trip (F-10 plumbing)", () => {
  it("reads the ETag of a GET and sends it back as If-Match on the write", async () => {
    setTokens({ access: "A", refresh: "R" });
    let sentIfMatch: string | null = null;
    let sentKey: string | null = null;
    server.use(
      http.get(`${API}/roles/1`, () =>
        HttpResponse.json({ success: true, data: { id: 1 } }, { headers: { ETag: '"2026-10-21T08:01:22.481903Z"' } })
      ),
      http.put(`${API}/roles/1/permissions`, ({ request }) => {
        sentIfMatch = request.headers.get("if-match");
        sentKey = request.headers.get("idempotency-key");
        return HttpResponse.json(
          { success: false, code: "CONFLICT_LOCK_VERSION" },
          { status: 409 }
        );
      })
    );
    const read = withEtag(await axiosInstance.get("/roles/1"));
    expect(read.etag).toBe('"2026-10-21T08:01:22.481903Z"');

    const error = await axiosInstance
      .put(
        "/roles/1/permissions",
        { grants: [] },
        { headers: { ...ifMatchHeaders(read.etag, { required: true }), ...idempotencyKeyHeaders("k-1") } }
      )
      .then(
        () => null,
        (e: unknown) => e
      );
    expect(sentIfMatch).toBe('"2026-10-21T08:01:22.481903Z"');
    expect(sentKey).toBe("k-1");
    expect(parseApiError(error)).toMatchObject({ status: 409, code: "CONFLICT_LOCK_VERSION" });
  });
});
