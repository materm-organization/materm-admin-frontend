import { describe, expect, it } from "vitest";

import { buildCreatePayload, buildUpdatePayload, checkPayload, draftFromRow, emptyRedirectDraft, isChanged, normalizeSource, validate } from "@/components/protected/redirects/redirect-draft";

describe("redirect draft", () => {
  it("normalises the source path", () => {
    expect(normalizeSource(" Old/Path// ")).toBe("/old/path");
    expect(normalizeSource("/")).toBe("/");
    expect(normalizeSource("")).toBe("");
  });

  it("validates source and target", () => {
    const d = { ...emptyRedirectDraft(), sourcePath: "/a", target: "/b" };
    expect(validate(d)).toEqual([]);
    expect(validate({ ...d, sourcePath: "" })[0]).toMatchObject({ path: "/source_path", code: "required" });
    expect(validate({ ...d, sourcePath: "/a?x=1" })[0]).toMatchObject({ path: "/source_path", code: "pattern_mismatch" });
    expect(validate({ ...d, target: "http://x.test" })[0]).toMatchObject({ path: "/target", code: "pattern_mismatch" });
    expect(validate({ ...d, target: "https://x.test/p" })).toEqual([]);
    expect(validate({ ...d, target: "//evil.test" })[0]).toMatchObject({ code: "pattern_mismatch" });
    expect(validate({ ...d, sourcePath: "A/", target: "/a" })[0]).toMatchObject({ path: "/target", code: "target_equals_source" });
  });

  it("builds payloads: blank language = null, patch has only what changed", () => {
    const d = { ...emptyRedirectDraft(), sourcePath: "A/", target: "/b", note: " hi " };
    expect(buildCreatePayload(d)).toEqual({ source_path: "/a", target: "/b", status_code: 301, locale_code: null, is_active: true, note: "hi" });
    const saved = draftFromRow({ id: 1, public_id: "x", source_path: "/a", target: "/b", status_code: 301, locale_code: "en", is_active: true, note: null, created_at: "", updated_at: "" });
    expect(isChanged(saved, saved)).toBe(false);
    expect(buildUpdatePayload(saved, { ...saved, localeCode: "", statusCode: 308 })).toEqual({ status_code: 308, locale_code: null });
  });

  it("asks the server only when the form is valid", () => {
    expect(checkPayload(emptyRedirectDraft())).toBeNull();
    expect(checkPayload({ ...emptyRedirectDraft(), sourcePath: "/a", target: "/b" }, 4)).toEqual({ source_path: "/a", target: "/b", status_code: 301, locale_code: null, id: 4 });
  });
});
