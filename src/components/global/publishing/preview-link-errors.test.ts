import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";

import { classifyPreviewCreateError, parseTtlMinutes, safeHttpUrl } from "@/components/global/publishing/preview-link-errors";

function apiError(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError("x", "ERR_BAD_REQUEST", config, {}, { status, statusText: "", data: { success: false, ...body }, headers, config });
}

describe("classifyPreviewCreateError", () => {
  it("503 with details.dependency preview.portalUrl is 'not configured'; another 503 / 5xx is 'unavailable'", () => {
    expect(classifyPreviewCreateError(apiError(503, { code: "SERVICE_UNAVAILABLE", details: { dependency: "preview.portalUrl" } }))).toEqual({ kind: "notConfigured" });
    expect(classifyPreviewCreateError(apiError(503, { code: "SERVICE_UNAVAILABLE" }))).toEqual({ kind: "unavailable" });
    expect(classifyPreviewCreateError(apiError(500, { code: "INTERNAL_ERROR" }))).toEqual({ kind: "unavailable" });
  });

  it("422 limit_exceeded / unknown_reference at /locale / out_of_range at /ttl_minutes", () => {
    const wrap = (errors: unknown[]) => apiError(422, { code: "VALIDATION_FAILED", errors });
    expect(classifyPreviewCreateError(wrap([{ in: "body", path: "", code: "limit_exceeded", params: { max: 20 } }]))).toEqual({ kind: "limit", max: 20 });
    expect(classifyPreviewCreateError(wrap([{ in: "body", path: "/locale", code: "unknown_reference" }]))).toEqual({ kind: "locale" });
    expect(classifyPreviewCreateError(wrap([{ in: "body", path: "/ttl_minutes", code: "out_of_range", params: { min: 1, max: 1440 } }]))).toEqual({ kind: "ttl", min: 1, max: 1440 });
    expect(classifyPreviewCreateError(wrap([{ in: "body", path: "/x", code: "unknown_field" }]))).toEqual({ kind: "other" });
    // 05 18.12.4: the shared sections of the page are too big to freeze: not the 20-links limit
    expect(classifyPreviewCreateError(wrap([{ in: "entity", path: "/shared_sections", code: "limit_exceeded", params: { max_bytes: 2097152 } }]))).toEqual({ kind: "sharedTooLarge" });
  });

  it("429 carries Retry-After; 409 INVALID_STATE trashed vs another reason; 404, 403, network", () => {
    expect(classifyPreviewCreateError(apiError(429, { code: "RATE_LIMITED" }, { "retry-after": "1800" }))).toEqual({ kind: "rate", retryAfter: 1800 });
    expect(classifyPreviewCreateError(apiError(409, { code: "INVALID_STATE", details: { reason: "trashed" } }))).toEqual({ kind: "trashed" });
    expect(classifyPreviewCreateError(apiError(409, { code: "INVALID_STATE", details: { reason: "x" } }))).toEqual({ kind: "invalidState" });
    expect(classifyPreviewCreateError(apiError(409, { code: "CONFLICT_LOCK_VERSION" }))).toEqual({ kind: "other" });
    expect(classifyPreviewCreateError(apiError(404, { code: "NOT_FOUND" }))).toEqual({ kind: "notFound" });
    expect(classifyPreviewCreateError(apiError(403, { code: "FORBIDDEN" }))).toEqual({ kind: "forbidden" });
    expect(classifyPreviewCreateError(new AxiosError("Network Error"))).toEqual({ kind: "network" });
    expect(classifyPreviewCreateError(new Error("x"))).toEqual({ kind: "other" });
  });
});

describe("parseTtlMinutes", () => {
  it("accepts whole numbers 1..1440 only", () => {
    expect(parseTtlMinutes("1")).toBe(1);
    expect(parseTtlMinutes(" 90 ")).toBe(90);
    expect(parseTtlMinutes("1440")).toBe(1440);
    for (const bad of ["", "0", "1441", "-5", "1.5", "1e3", "abc", "30 min", "00000001"]) expect(parseTtlMinutes(bad)).toBeNull();
  });
});

describe("safeHttpUrl", () => {
  it("lets only http(s) addresses into an href", () => {
    expect(safeHttpUrl("https://materm.example/api/preview?token=a&path=%2F&locale=la")).toBe("https://materm.example/api/preview?token=a&path=%2F&locale=la");
    expect(safeHttpUrl("http://localhost:3000/api/preview?token=a")).not.toBeNull();
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,x")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
  });
});
