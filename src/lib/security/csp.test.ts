import { describe, expect, it } from "vitest";

import {
  apiOriginFromBaseUrl,
  buildContentSecurityPolicy,
  generateNonce,
  mediaOriginsFromEnv,
} from "@/lib/security/csp";

describe("buildContentSecurityPolicy", () => {
  const csp = buildContentSecurityPolicy({ nonce: "abc123", apiOrigin: "https://api.example.com" });
  const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `));

  it("scripts need the request's nonce: no unsafe-inline, no unsafe-eval in production", () => {
    expect(directive("script-src")).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  });

  it("allows eval and websockets only in development", () => {
    const dev = buildContentSecurityPolicy({ nonce: "n", isDev: true });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("ws:");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("ws:");
  });

  it("connects only to the app and the API origin", () => {
    expect(directive("connect-src")).toBe("connect-src 'self' https://api.example.com");
    expect(buildContentSecurityPolicy({ nonce: "n" })).toContain("connect-src 'self';");
  });

  it("locks down objects, base, framing and forms", () => {
    for (const d of [
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "frame-src 'none'",
      "form-action 'self'",
      "default-src 'self'",
    ]) {
      expect(csp).toContain(d);
    }
  });
});

describe("apiOriginFromBaseUrl", () => {
  it("keeps only the origin of an absolute URL", () => {
    expect(apiOriginFromBaseUrl("http://localhost:8080/api/v1")).toBe("http://localhost:8080");
    expect(apiOriginFromBaseUrl("https://api.example.com")).toBe("https://api.example.com");
  });

  it("is undefined for relative, blank, invalid or non-http values", () => {
    expect(apiOriginFromBaseUrl("/api/v1")).toBeUndefined();
    expect(apiOriginFromBaseUrl("")).toBeUndefined();
    expect(apiOriginFromBaseUrl(undefined)).toBeUndefined();
    expect(apiOriginFromBaseUrl("javascript:alert(1)")).toBeUndefined();
  });
});

describe("generateNonce", () => {
  it("makes a fresh base64 nonce each time", () => {
    const a = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(generateNonce()).not.toBe(a);
  });
});

describe("media origins (img-src)", () => {
  it("lists them in img-src only, never in connect-src or script-src", () => {
    const csp = buildContentSecurityPolicy({ nonce: "n", apiOrigin: "https://api.example.com", mediaOrigins: ["http://localhost:3001", "https://files.example.com"] });
    const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `));
    expect(directive("img-src")).toBe("img-src 'self' data: blob: https://api.example.com http://localhost:3001 https://files.example.com");
    expect(directive("connect-src")).toBe("connect-src 'self' https://api.example.com");
    expect(csp).not.toContain("localhost:3001; script");
    expect(buildContentSecurityPolicy({ nonce: "n" })).toContain("img-src 'self' data: blob:;");
  });

  it("media-src is 'self', blob: and the media origins only (no API origin, no wildcard)", () => {
    const csp = buildContentSecurityPolicy({ nonce: "n", apiOrigin: "https://api.example.com", mediaOrigins: ["http://localhost:3001", "https://files.example.com"] });
    const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `));
    expect(directive("media-src")).toBe("media-src 'self' blob: http://localhost:3001 https://files.example.com");
    expect(buildContentSecurityPolicy({ nonce: "n", apiOrigin: "https://api.example.com" })).toContain("media-src 'self' blob:;");
    expect(csp).not.toContain("unsafe-eval");
    expect(directive("script-src")).not.toContain("files.example.com");
    expect(directive("default-src")).toBe("default-src 'self'");
  });

  it("reads origins from the env value: trims, de-duplicates, keeps http(s) origins only", () => {
    expect(mediaOriginsFromEnv("http://localhost:3001, https://files.example.com/media/x , http://localhost:3001")).toEqual([
      "http://localhost:3001",
      "https://files.example.com",
    ]);
    expect(mediaOriginsFromEnv("*, javascript:alert(1), data:text/html, ftp://x.test, not a url")).toEqual([]);
    expect(mediaOriginsFromEnv(undefined)).toEqual([]);
    expect(mediaOriginsFromEnv("")).toEqual([]);
  });
});
