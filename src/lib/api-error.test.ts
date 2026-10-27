import { describe, expect, it } from "vitest";

import {
  isConflictError,
  isGloballyToasted,
  isNoPermissionError,
  isPreconditionRequiredError,
  parseApiError,
} from "@/lib/api-error";
import { apiError, networkError } from "@/test/api-error";

describe("isNoPermissionError (a read that ends in 403 / auth error = NoPermission, never retried)", () => {
  it("is true for a plain 403", () => {
    expect(isNoPermissionError(apiError(403, { code: "FORBIDDEN" }))).toBe(true);
  });

  it("is false for 403 PASSWORD_CHANGE_REQUIRED (the forced dialog handles it)", () => {
    expect(isNoPermissionError(apiError(403, { code: "PASSWORD_CHANGE_REQUIRED" }))).toBe(false);
  });

  it("is true for a 401 that did not end the session", () => {
    expect(isNoPermissionError(apiError(401, { code: "UNAUTHENTICATED" }))).toBe(true);
    expect(isNoPermissionError(apiError(401, { code: "AUTHZ_CHANGED" }))).toBe(true);
  });

  it("is false for 401s that end the session", () => {
    for (const code of ["SESSION_REVOKED", "REFRESH_REUSED", "REFRESH_REPLAY_UNAVAILABLE"]) {
      expect(isNoPermissionError(apiError(401, { code }))).toBe(false);
    }
  });

  it("is false for everything else", () => {
    expect(isNoPermissionError(apiError(404, { code: "NOT_FOUND" }))).toBe(false);
    expect(isNoPermissionError(apiError(500, { code: "INTERNAL_ERROR" }))).toBe(false);
    expect(isNoPermissionError(networkError())).toBe(false);
    expect(isNoPermissionError(new Error("boom"))).toBe(false);
    expect(isNoPermissionError(undefined)).toBe(false);
  });

  it("decides on the code, never on the message", () => {
    expect(isNoPermissionError(apiError(403, { message: "PASSWORD_CHANGE_REQUIRED" }))).toBe(false);
    expect(isNoPermissionError(apiError(403, { message: "you shall not pass" }))).toBe(true);
  });
});

describe("isConflictError (409 CONFLICT_LOCK_VERSION / 412 -> ConflictDialog)", () => {
  it("matches the lock conflict and 412", () => {
    expect(isConflictError(apiError(409, { code: "CONFLICT_LOCK_VERSION" }))).toBe(true);
    expect(isConflictError(apiError(412, {}))).toBe(true);
  });

  it("does not match other 409s or other statuses", () => {
    expect(isConflictError(apiError(409, { code: "CONFLICT_DUPLICATE" }))).toBe(false);
    expect(isConflictError(apiError(422, { code: "CONFLICT_LOCK_VERSION" }))).toBe(false);
    expect(isConflictError(apiError(428, { code: "PRECONDITION_REQUIRED" }))).toBe(false);
    expect(isConflictError(networkError())).toBe(false);
  });
});

describe("428 PRECONDITION_REQUIRED", () => {
  it("is recognised and toasted globally (a client bug, not a form error)", () => {
    const error = apiError(428, { code: "PRECONDITION_REQUIRED" });
    expect(isPreconditionRequiredError(error)).toBe(true);
    expect(isGloballyToasted(parseApiError(error))).toBe(true);
    expect(isPreconditionRequiredError(apiError(409, { code: "CONFLICT_LOCK_VERSION" }))).toBe(false);
  });
});

describe("isGloballyToasted", () => {
  it("toasts network, 403 (not PASSWORD_CHANGE_REQUIRED), 429 and 5xx; leaves form errors alone", () => {
    expect(isGloballyToasted(parseApiError(networkError()))).toBe(true);
    expect(isGloballyToasted(parseApiError(apiError(403, { code: "FORBIDDEN" })))).toBe(true);
    expect(isGloballyToasted(parseApiError(apiError(403, { code: "PASSWORD_CHANGE_REQUIRED" })))).toBe(false);
    expect(isGloballyToasted(parseApiError(apiError(429, { code: "RATE_LIMITED" })))).toBe(true);
    expect(isGloballyToasted(parseApiError(apiError(503, {})))).toBe(true);
    for (const status of [400, 404, 409, 422]) {
      expect(isGloballyToasted(parseApiError(apiError(status, {})))).toBe(false);
    }
  });
});
