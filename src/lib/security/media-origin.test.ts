import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildContentSecurityPolicy } from "@/lib/security/csp";
import {
  MEDIA_ORIGIN_FAILURE_TTL_MS,
  MEDIA_ORIGIN_TTL_MS,
  configUrlFromBaseUrl,
  getBackendMediaOrigin,
  mediaOriginFromConfigBody,
  resetMediaOriginCache,
  strictHttpOrigin,
} from "@/lib/security/media-origin";

const BASE = "http://localhost:8080/api/v1";
const ok = (media_origin: unknown) =>
  new Response(JSON.stringify({ success: true, data: { media_origin } }), { status: 200 });

describe("strictHttpOrigin", () => {
  it("keeps only the origin of http(s) URLs", () => {
    expect(strictHttpOrigin("http://localhost:3310")).toBe("http://localhost:3310");
    expect(strictHttpOrigin("https://files.example.com/a/b?x=1")).toBe("https://files.example.com");
  });
  it.each([
    "*",
    "https:",
    "http://",
    "ftp://x.com",
    "javascript:alert(1)",
    "http://u:p@x.com",
    "http://x.com; script-src *",
    "http://x.com, http://y.com",
    "http://x.com y",
    "http://x.com\r\nSet-Cookie: a=b",
    "http://*.example.com",
    "",
    null,
    42,
  ])("rejects %j", (v) => {
    expect(strictHttpOrigin(v)).toBeUndefined();
  });
});

describe("mediaOriginFromConfigBody / configUrlFromBaseUrl", () => {
  it("reads data.media_origin", () => {
    expect(mediaOriginFromConfigBody({ success: true, data: { media_origin: "http://localhost:3310" } })).toBe(
      "http://localhost:3310",
    );
    expect(mediaOriginFromConfigBody({ data: { media_origin: null } })).toBeUndefined();
    expect(mediaOriginFromConfigBody({})).toBeUndefined();
    expect(mediaOriginFromConfigBody("x")).toBeUndefined();
  });
  it("builds the config URL only for absolute http(s) bases", () => {
    expect(configUrlFromBaseUrl("http://h:1/api/v1/")).toBe("http://h:1/api/v1/config");
    expect(configUrlFromBaseUrl("/api/v1")).toBeUndefined();
    expect(configUrlFromBaseUrl(undefined)).toBeUndefined();
  });
});

describe("getBackendMediaOrigin", () => {
  let clock = 0;
  const now = () => clock;
  const fetchMock = vi.fn();

  beforeEach(() => {
    clock = 1_000;
    resetMediaOriginCache();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fetches {base}/config with a timeout signal and returns the origin", async () => {
    fetchMock.mockResolvedValue(ok("http://localhost:3310"));
    expect(await getBackendMediaOrigin(BASE, now)).toBe("http://localhost:3310");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8080/api/v1/config");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("caches a good answer for 5 minutes, then refetches", async () => {
    fetchMock.mockImplementation(async () => ok("http://localhost:3310"));
    await getBackendMediaOrigin(BASE, now);
    clock += MEDIA_ORIGIN_TTL_MS - 1;
    await getBackendMediaOrigin(BASE, now);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clock += 2;
    await getBackendMediaOrigin(BASE, now);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches a failure for 30 seconds and never throws", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    expect(await getBackendMediaOrigin(BASE, now)).toBeUndefined();
    clock += MEDIA_ORIGIN_FAILURE_TTL_MS - 1;
    expect(await getBackendMediaOrigin(BASE, now)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clock += 2;
    await getBackendMediaOrigin(BASE, now);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a timeout abort, non-2xx, bad JSON and invalid values as failures", async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => {
        throw new DOMException("timeout", "TimeoutError");
      },
      async () => new Response("{}", { status: 500 }),
      async () => new Response("not json", { status: 200 }),
      async () => ok("http://x.com; script-src *"),
      async () => ok("*"),
    ];
    for (const c of cases) {
      resetMediaOriginCache();
      fetchMock.mockImplementationOnce(c);
      expect(await getBackendMediaOrigin(BASE, now)).toBeUndefined();
    }
  });

  it("shares one request between concurrent callers", async () => {
    fetchMock.mockImplementation(async () => ok("http://localhost:3310"));
    const [a, b] = await Promise.all([getBackendMediaOrigin(BASE, now), getBackendMediaOrigin(BASE, now)]);
    expect([a, b]).toEqual(["http://localhost:3310", "http://localhost:3310"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fetch for a relative or missing base", async () => {
    expect(await getBackendMediaOrigin("/api/v1", now)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("final CSP header", () => {
  const imgSrc = (csp: string) => csp.split("; ").find((d) => d.startsWith("img-src "));

  it("carries the backend media origin in img-src only", async () => {
    resetMediaOriginCache();
    vi.stubGlobal("fetch", vi.fn(async () => ok("http://localhost:3310")));
    const media = await getBackendMediaOrigin(BASE, () => 0);
    const csp = buildContentSecurityPolicy({ nonce: "n", apiOrigin: "http://localhost:8080", mediaOrigins: media ? [media] : [] });
    expect(imgSrc(csp)).toBe("img-src 'self' data: blob: http://localhost:8080 http://localhost:3310");
    expect(csp.match(/localhost:3310/g)).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("has no media origin when the backend fails or answers garbage", async () => {
    for (const f of [vi.fn(async () => { throw new Error("x"); }), vi.fn(async () => ok("http://a.com;b"))]) {
      resetMediaOriginCache();
      vi.stubGlobal("fetch", f);
      const media = await getBackendMediaOrigin(BASE, () => 0);
      const csp = buildContentSecurityPolicy({ nonce: "n", mediaOrigins: media ? [media] : [] });
      expect(imgSrc(csp)).toBe("img-src 'self' data: blob:");
      vi.unstubAllGlobals();
    }
  });
});
