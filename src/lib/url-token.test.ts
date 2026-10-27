import { afterEach, describe, expect, it } from "vitest";

import { consumeFragmentToken, parseTokenFragment } from "@/lib/url-token";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("parseTokenFragment", () => {
  it("reads token=… with or without the leading #", () => {
    expect(parseTokenFragment("#token=abc_DEF-123")).toBe("abc_DEF-123");
    expect(parseTokenFragment("token=abc")).toBe("abc");
  });

  it("returns null for an empty / missing / blank token", () => {
    expect(parseTokenFragment("")).toBeNull();
    expect(parseTokenFragment("#")).toBeNull();
    expect(parseTokenFragment("#other=1")).toBeNull();
    expect(parseTokenFragment("#token=")).toBeNull();
    expect(parseTokenFragment("#token=%20")).toBeNull();
  });
});

describe("consumeFragmentToken", () => {
  it("returns the token and removes the whole fragment from the address bar, keeping path and query", () => {
    window.history.replaceState(null, "", "/auth/reset-password?lang=la#token=SECRET");
    expect(consumeFragmentToken()).toBe("SECRET");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("SECRET");
    expect(window.location.pathname + window.location.search).toBe("/auth/reset-password?lang=la");
  });

  it("returns null and leaves the URL alone when there is no fragment", () => {
    window.history.replaceState(null, "", "/auth/reset-password");
    expect(consumeFragmentToken()).toBeNull();
    expect(window.location.pathname).toBe("/auth/reset-password");
  });

  it("strips a fragment that carries no token as well", () => {
    window.history.replaceState(null, "", "/auth/reset-password#junk");
    expect(consumeFragmentToken()).toBeNull();
    expect(window.location.hash).toBe("");
  });
});
