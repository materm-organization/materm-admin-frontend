import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";

import { parseApiError } from "@/lib/api-error";
import { unwrapBlobError } from "@/lib/blob-error";

const failed = (status: number, body: Blob | string | object, headers: Record<string, string> = {}) => {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError("failed", String(status), config, null, {
    status,
    statusText: "",
    data: body,
    headers,
    config,
  });
};

describe("unwrapBlobError", () => {
  it("turns a JSON Blob body into the envelope, so the code and details are readable", async () => {
    const body = new Blob([JSON.stringify({ success: false, code: "EXPORT_TOO_LARGE", details: { matched: 60000, max: 50000 } })], { type: "application/json" });
    const error = await unwrapBlobError(failed(422, body));
    const parsed = parseApiError(error);
    expect(parsed.code).toBe("EXPORT_TOO_LARGE");
    expect(parsed.details).toEqual({ matched: 60000, max: 50000 });
  });

  it("keeps Retry-After and the status of a 429", async () => {
    const body = new Blob([JSON.stringify({ success: false, code: "RATE_LIMITED" })]);
    const parsed = parseApiError(await unwrapBlobError(failed(429, body, { "retry-after": "1800" })));
    expect(parsed).toMatchObject({ status: 429, code: "RATE_LIMITED", retryAfter: 1800 });
  });

  it("leaves a body that is not JSON, a plain object and a non-axios error alone", async () => {
    const html = new Blob(["<html>bad gateway</html>"]);
    const error = failed(502, html);
    expect(await unwrapBlobError(error)).toBe(error);
    expect((error.response as { data: unknown }).data).toBe(html);
    const plain = failed(422, { code: "X" });
    expect(await unwrapBlobError(plain)).toBe(plain);
    const other = new Error("boom");
    expect(await unwrapBlobError(other)).toBe(other);
  });

  it("does not turn a JSON array into an envelope", async () => {
    const error = failed(500, new Blob(["[1,2]"]));
    await unwrapBlobError(error);
    expect((error.response as { data: unknown }).data).toBeInstanceOf(Blob);
  });
});
