import { describe, expect, it, vi } from "vitest";

import { idempotencyHeaders, idempotencyKeyHeaders, newIdempotencyKey } from "@/lib/idempotency";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("idempotency key", () => {
  it("is a UUIDv4, different each time", () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(UUID_V4);
    expect(a).not.toBe(b);
  });

  it("still makes a UUIDv4 where crypto.randomUUID is missing (plain-http LAN)", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      expect(newIdempotencyKey()).toMatch(UUID_V4);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("builds the request config", () => {
    expect(idempotencyHeaders("abc")).toEqual({ headers: { "Idempotency-Key": "abc" } });
    expect(idempotencyHeaders(undefined)).toEqual({});
    expect(idempotencyKeyHeaders("abc")).toEqual({ "Idempotency-Key": "abc" });
    expect(idempotencyKeyHeaders(null)).toEqual({});
  });
});
