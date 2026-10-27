import { AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";

import { MissingEtagError, ifMatch, ifMatchHeaders, withEtag } from "@/lib/etag";

describe("withEtag", () => {
  it("reads the quoted ETag header verbatim next to the data", () => {
    const headers = new AxiosHeaders({ ETag: '"2026-10-21T08:01:22.481903Z"' });
    expect(withEtag({ data: { id: 1 }, headers })).toEqual({
      data: { id: 1 },
      etag: '"2026-10-21T08:01:22.481903Z"',
    });
  });

  it("works with a plain header object, any casing", () => {
    expect(withEtag({ data: 1, headers: { etag: '"7"' } }).etag).toBe('"7"');
    expect(withEtag({ data: 1, headers: { ETag: '"8"' } }).etag).toBe('"8"');
  });

  it("returns undefined when the header is missing or blank", () => {
    expect(withEtag({ data: 1, headers: {} }).etag).toBeUndefined();
    expect(withEtag({ data: 1, headers: { etag: "  " } }).etag).toBeUndefined();
    expect(withEtag({ data: 1, headers: undefined as never }).etag).toBeUndefined();
  });
});

describe("ifMatch", () => {
  it("builds the If-Match header config without touching the value", () => {
    expect(ifMatch('"7"')).toEqual({ headers: { "If-Match": '"7"' } });
  });

  it("is an empty config without an etag when it is optional (PATCH /users/{id})", () => {
    expect(ifMatch(undefined)).toEqual({});
    expect(ifMatch(null)).toEqual({});
  });

  it("ifMatchHeaders is a plain record that combines with other headers", () => {
    expect(ifMatchHeaders('"7"')).toEqual({ "If-Match": '"7"' });
    expect(ifMatchHeaders(undefined)).toEqual({});
    expect(() => ifMatchHeaders(undefined, { required: true })).toThrow(MissingEtagError);
    expect({ ...ifMatchHeaders('"7"'), "Idempotency-Key": "k" }).toEqual({ "If-Match": '"7"', "Idempotency-Key": "k" });
  });

  it("throws MissingEtagError when it is required (PUT /roles/{id}/permissions)", () => {
    expect(() => ifMatch(undefined, { required: true })).toThrow(MissingEtagError);
    expect(() => ifMatch("", { required: true })).toThrow(MissingEtagError);
    expect(ifMatch('"1"', { required: true })).toEqual({ headers: { "If-Match": '"1"' } });
  });
});
