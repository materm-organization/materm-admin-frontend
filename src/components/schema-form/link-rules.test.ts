import { describe, expect, it } from "vitest";

import { checkLinkUrl, isSafeLinkUrl, isSafeRichLinkHref, LEGACY_LINK_URL_PATTERN, PORTABLE_LINK_URL_PATTERN } from "./link-rules";

describe("link url rule (R-016)", () => {
  it.each([
    ["https://example.test/a?b=1#c", "https"],
    ["/about", "path"],
    ["/", "path"],
    ["#contact", "anchor"],
    ["mailto:hi@example.test", "mailto"],
    ["tel:+8562012345678", "tel"],
  ])("accepts %s", (url, kind) => {
    expect(checkLinkUrl(url)).toEqual({ ok: true, kind });
  });

  it.each([
    ["//evil.test", "protocol_relative"],
    ["//evil.test/login", "protocol_relative"],
    ["/\\evil.test", "protocol_relative"],
    ["javascript:alert(1)", "scheme"],
    ["JaVaScRiPt:alert(1)", "scheme"],
    ["data:text/html,x", "scheme"],
    ["http://example.test", "scheme"],
    ["example.test", "scheme"],
    ["\\\\evil.test", "scheme"],
    ["", "empty"],
  ])("rejects %j", (url, reason) => {
    expect(checkLinkUrl(url)).toEqual({ ok: false, reason });
    expect(isSafeLinkUrl(url)).toBe(false);
  });

  it("rich-text hrefs additionally refuse #anchors", () => {
    expect(isSafeRichLinkHref("/x")).toBe(true);
    expect(isSafeRichLinkHref("#x")).toBe(false);
    expect(isSafeRichLinkHref("//evil.test")).toBe(false);
    expect(isSafeRichLinkHref("javascript:alert(1)")).toBe(false);
  });

  it("the portable schema pattern agrees with the widget rule", () => {
    const portable = new RegExp(PORTABLE_LINK_URL_PATTERN);
    const legacy = new RegExp(LEGACY_LINK_URL_PATTERN);
    for (const url of ["https://a.test", "/", "/x", "#a", "mailto:a@b.c", "tel:1", "//evil.test", "/\\evil.test", "javascript:x", "http://a.test", "x"]) {
      expect(portable.test(url), url).toBe(isSafeLinkUrl(url));
    }
    // ...while the legacy one lets the two protocol-relative forms through
    expect(legacy.test("//evil.test")).toBe(true);
    expect(legacy.test("/\\evil.test")).toBe(true);
  });
});
