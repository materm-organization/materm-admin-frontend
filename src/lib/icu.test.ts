import { describe, expect, it } from "vitest";

import { analyzeIcu, checkIcuValue, diffPlaceholders } from "@/lib/icu";
import { formatUiStringKeyEtag } from "@/lib/ui-string-etag";

describe("analyzeIcu", () => {
  it("lists the placeholder names, sorted, once each; a plural's # is not one", () => {
    expect(analyzeIcu("Open the gallery ({index} of {total}), {index}")).toEqual({ ok: true, placeholders: ["index", "total"] });
    expect(analyzeIcu("{n, plural, one {# post in {category}} other {# posts in {category}}}")).toEqual({ ok: true, placeholders: ["category", "n"] });
    expect(analyzeIcu("Plain text")).toEqual({ ok: true, placeholders: [] });
    expect(analyzeIcu("Read <b>{what}</b>")).toEqual({ ok: true, placeholders: ["b", "what"] });
  });

  it("syntax errors say where; a plural / select without `other` names the argument", () => {
    const syntax = analyzeIcu("Menu: {page");
    expect(syntax).toMatchObject({ ok: false, issue: { code: "icu_syntax", params: { offset: expect.any(Number) } } });
    expect(analyzeIcu("{n, plural, one {x}}")).toEqual({ ok: false, issue: { code: "plural_other_missing", params: { argument: "n" } } });
    expect(analyzeIcu("{kind, select, a {x} other {{n, plural, one {y}}}}")).toEqual({ ok: false, issue: { code: "plural_other_missing", params: { argument: "n" } } });
  });
});

describe("checkIcuValue", () => {
  it("compares the placeholder set with the source; null source skips the comparison", () => {
    expect(checkIcuValue("Page {page}", ["page"])).toEqual({ ok: true, placeholders: ["page"] });
    expect(checkIcuValue("Page {pagina}", ["page"])).toEqual({
      ok: false,
      code: "placeholder_mismatch",
      params: { expected: ["page"], missing: ["page"], unexpected: ["pagina"] },
    });
    expect(checkIcuValue("Anything {x}", null).ok).toBe(true);
    expect(checkIcuValue("{", ["a"])).toMatchObject({ ok: false, code: "icu_syntax" });
  });

  it("diffPlaceholders is null for equal sets", () => {
    expect(diffPlaceholders(["a", "b"], ["b", "a"])).toBeNull();
  });
});

describe("the key-level restore ETag (provisional contract, isolated in lib/ui-string-etag.ts)", () => {
  it("is the quoted number of the latest revision", () => {
    expect(formatUiStringKeyEtag(0)).toBe('"0"');
    expect(formatUiStringKeyEtag(7)).toBe('"7"');
  });
});
