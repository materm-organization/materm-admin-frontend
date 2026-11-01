import { describe, expect, it } from "vitest";

import { buildCreatePayload, buildUpdatePayload, checkPayload, draftFromRow, emptyRedirectDraft, isChanged, normalizeSource, rowSnapshot, validate } from "@/components/protected/redirects/redirect-draft";

describe("redirect draft", () => {
  it("normalises the source path", () => {
    expect(normalizeSource(" /Old/Path// ")).toBe("/old/path");
    expect(normalizeSource("/")).toBe("/");
    expect(normalizeSource("")).toBe("");
  });

  it("validates source and target", () => {
    const d = { ...emptyRedirectDraft(), sourcePath: "/a", target: "/b" };
    expect(validate(d)).toEqual([]);
    expect(validate({ ...d, sourcePath: "" })[0]).toMatchObject({ path: "/source_path", code: "required" });
    expect(validate({ ...d, sourcePath: "/a?x=1" })[0]).toMatchObject({ path: "/source_path", code: "pattern_mismatch", params: { rule: "no_query_or_fragment" } });
    expect(validate({ ...d, sourcePath: "a" })[0]).toMatchObject({ params: { rule: "must_start_with_slash" } });
    expect(validate({ ...d, sourcePath: "/a//b" })[0]).toMatchObject({ params: { rule: "empty_segment" } });
    expect(validate({ ...d, target: "http://x.test" })[0]).toMatchObject({ path: "/target", code: "https_only" });
    expect(validate({ ...d, target: "javascript:alert(1)" })[0]).toMatchObject({ code: "scheme_not_allowed" });
    expect(validate({ ...d, target: "https://u:p@x.test" })[0]).toMatchObject({ code: "userinfo_not_allowed" });
    expect(validate({ ...d, target: "example.com/x" })[0]).toMatchObject({ code: "path_or_https_url" });
    expect(validate({ ...d, target: "https://x.test/p" })).toEqual([]);
    expect(validate({ ...d, target: "//evil.test" })[0]).toMatchObject({ code: "pattern_mismatch", params: { rule: "protocol_relative" } });
    expect(validate({ ...d, sourcePath: "/a/", target: "/A?x=1" })[0]).toMatchObject({ path: "/target", code: "self_redirect" });
  });

  it("builds payloads: blank language = null, patch has only what changed", () => {
    const d = { ...emptyRedirectDraft(), sourcePath: "/A/", target: "/b", note: " hi " };
    expect(buildCreatePayload(d)).toEqual({ source_path: "/a", target: "/b", status_code: 301, locale_code: null, is_active: true, note: "hi" });
    const saved = draftFromRow({ id: 1, public_id: "x", source_path: "/a", target: "/b", status_code: 301, locale_code: "en", is_active: true, note: null, created_at: "", updated_at: "" });
    expect(isChanged(saved, saved)).toBe(false);
    expect(buildUpdatePayload(saved, { ...saved, localeCode: "", statusCode: 308 })).toEqual({ status_code: 308, locale_code: null });
  });

  it("snapshot is flat", () => {
    const row = { id: 1, public_id: "x", source_path: "/a", target: "/b", status_code: 301 as const, locale_code: null, is_active: true, note: null, created_at: "", updated_at: "" };
    expect(rowSnapshot(row)).toEqual({ source_path: "/a", locale_code: null, target: "/b", status_code: 301, is_active: true, note: null });
  });

  it("asks the server only when the form is valid", () => {
    expect(checkPayload(emptyRedirectDraft())).toBeNull();
    expect(checkPayload({ ...emptyRedirectDraft(), sourcePath: "/a", target: "/b" }, 4)).toEqual({ source_path: "/a", target: "/b", status_code: 301, locale_code: null, is_active: true, id: 4 });
  });
});
