import { describe, expect, it } from "vitest";

import { SECTION_TYPE_FIXTURES } from "./fixtures";
import { codePointLength, fallbackValue, hasContent, hasTextInOtherLocales, humanize, setLocaleValue } from "./value-ops";

describe("setLocaleValue", () => {
  it("sets one language and keeps the others", () => {
    expect(setLocaleValue({ la: "a" }, "en", "b", true)).toEqual({ la: "a", en: "b" });
    expect(setLocaleValue(undefined, "la", "x", false)).toEqual({ la: "x" });
  });
  it("removes a cleared language; an emptied required map stays {}, an optional one goes away", () => {
    expect(setLocaleValue({ la: "a", en: "b" }, "en", "", true)).toEqual({ la: "a" });
    expect(setLocaleValue({ la: "a" }, "la", "", true)).toEqual({});
    expect(setLocaleValue({ la: "a" }, "la", "", false)).toBeUndefined();
    expect(setLocaleValue(undefined, "la", "", true)).toEqual({});
    expect(setLocaleValue(undefined, "la", "", false)).toBeUndefined();
    expect(setLocaleValue({ la: "a" }, "en", undefined, false)).toEqual({ la: "a" });
  });
});

describe("fallbackValue", () => {
  const locales = [
    { code: "la", fallback_code: null },
    { code: "en", fallback_code: "la" },
    { code: "th", fallback_code: "en" },
  ];
  it("follows the chain, then the default language", () => {
    expect(fallbackValue({ la: "L" }, "th", locales, "la")).toEqual({ locale: "la", value: "L" });
    expect(fallbackValue({ la: "L", en: "E" }, "th", locales, "la")).toEqual({ locale: "en", value: "E" });
    expect(fallbackValue({}, "en", locales, "la")).toBeUndefined();
    expect(fallbackValue(undefined, "en", locales, "la")).toBeUndefined();
  });
  it("does not loop on a cycle", () => {
    const cyc = [{ code: "a", fallback_code: "b" }, { code: "b", fallback_code: "a" }];
    expect(fallbackValue({}, "a", cyc, "z")).toBeUndefined();
  });
});

describe("misc", () => {
  it("hasContent, codePointLength, humanize", () => {
    expect(hasContent("  ")).toBe(false);
    expect(hasContent("x")).toBe(true);
    expect(hasContent({ type: "doc", content: [{ type: "paragraph" }] })).toBe(false);
    expect(hasContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] })).toBe(true);
    expect(codePointLength("😀a")).toBe(2);
    expect(humanize("open_in_new_tab")).toBe("Open in new tab");
    expect(humanize("contact.phone")).toBe("Contact phone");
  });
  it("hasTextInOtherLocales is schema-guided (an `alt` string is not a locale)", () => {
    const type = SECTION_TYPE_FIXTURES.about_blocks;
    const itemSchema = (type.json_schema.properties?.items as { items: object }).items as never;
    const item = { title: { la: "T", en: "E" }, image: { media_id: 1 } };
    expect(hasTextInOtherLocales(type.json_schema, itemSchema, item, "la")).toBe(true);
    expect(hasTextInOtherLocales(type.json_schema, itemSchema, { title: { la: "T" } }, "la")).toBe(false);
    expect(hasTextInOtherLocales(type.json_schema, itemSchema, { image: { media_id: 1, alt: "plain" } }, "la")).toBe(false);
  });
});
