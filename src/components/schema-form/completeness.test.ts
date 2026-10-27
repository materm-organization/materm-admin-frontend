import { describe, expect, it } from "vitest";

import { computeCompleteness, sumCompleteness } from "./completeness";
import { EXAMPLE_SECTIONS, SECTION_TYPE_FIXTURES } from "./fixtures";

const hero = SECTION_TYPE_FIXTURES.hero_brand.json_schema;

describe("computeCompleteness", () => {
  it("counts the required localized leaves per locale", () => {
    const c = computeCompleteness(hero, { title: { la: "A" }, background: { media_id: 1, decorative: true } }, ["la", "en"]);
    expect(c.la).toMatchObject({ total: 1, filled: 1, percent: 100, status: "complete", missing: [] });
    expect(c.en).toMatchObject({ total: 1, filled: 0, percent: 0, status: "missing" });
    expect(c.en.missing).toEqual([{ path: "/title/en", kind: "text" }]);
  });

  it("treats blank text as empty and a section without required leaves as 100%", () => {
    expect(computeCompleteness(hero, { title: { la: "   " } }, ["la"]).la.filled).toBe(0);
    const none = computeCompleteness(SECTION_TYPE_FIXTURES.post_list.json_schema, {}, ["la"]);
    expect(none.la).toMatchObject({ total: 0, percent: 100, status: "complete" });
  });

  it("counts leaves inside repeater items, rich text by its text nodes, and only the visible `then` requirements", () => {
    const about = SECTION_TYPE_FIXTURES.about_blocks.json_schema;
    const doc = (t: string) => ({ type: "doc", content: [{ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] }] });
    const props = {
      items: [
        { title: { la: "T", en: "T" }, body: { la: doc("b"), en: doc("") } },
        { title: { la: "T2" }, body: { la: doc("b2") } },
      ],
    };
    const c = computeCompleteness(about, props, ["la", "en"]);
    expect(c.la).toMatchObject({ total: 4, filled: 4 });
    expect(c.en).toMatchObject({ total: 4, filled: 1, status: "partial" });
    expect(c.en.missing.map((m) => m.path)).toEqual(["/items/0/body/en", "/items/1/title/en", "/items/1/body/en"]);

    const contact = SECTION_TYPE_FIXTURES.contact_section.json_schema;
    const base = { eyebrow: { la: "e" }, title: { la: "t" } };
    const settings = computeCompleteness(contact, { ...base, info_items: [{ icon: "phone", label: { la: "p" }, source: "contact.phone" }] }, ["la"]);
    const custom = computeCompleteness(contact, { ...base, info_items: [{ icon: "phone", label: { la: "p" }, source: "custom" }] }, ["la"]);
    expect(settings.la.total).toBe(3);
    // `value` becomes required through the `then` of source = custom
    expect(custom.la.total).toBe(4);
    expect(custom.la.missing.map((m) => m.path)).toEqual(["/info_items/0/value/la"]);
  });

  it("counts the alt of non-decorative images when the media row is known", () => {
    const props = { title: { la: "A", en: "A" }, background: { media_id: 7, alt: { la: "alt" } } };
    const known = computeCompleteness(hero, props, ["la", "en"], { media: (id) => (id === 7 ? { alt: { en: "media alt" } } : undefined) });
    expect(known.la).toMatchObject({ total: 2, filled: 2 });
    expect(known.en).toMatchObject({ total: 2, filled: 2 });
    const unknown = computeCompleteness(hero, props, ["la"], { media: () => undefined });
    expect(unknown.la.total).toBe(1);
    const decorative = computeCompleteness(hero, { ...props, background: { media_id: 7, decorative: true } }, ["la"], { media: () => ({}) });
    expect(decorative.la.total).toBe(1);
    const missingAlt = computeCompleteness(hero, { title: { la: "A" }, background: { media_id: 7 } }, ["la"], { media: () => ({}) });
    expect(missingAlt.la.missing).toEqual([{ path: "/background/alt/la", kind: "alt" }]);
  });

  it("is complete for every example section in the languages they are written in", () => {
    for (const section of EXAMPLE_SECTIONS) {
      const c = computeCompleteness(SECTION_TYPE_FIXTURES[section.section_type].json_schema, section.props, ["la", "en"]);
      expect(c.la.missing, `${section.page}#${section.index}`).toEqual([]);
    }
  });

  it("sums sections into a page total", () => {
    const a = computeCompleteness(hero, { title: { la: "A" } }, ["la", "en"]);
    const b = computeCompleteness(hero, { title: { la: "A", en: "A" } }, ["la", "en"]);
    const sum = sumCompleteness([a, b]);
    expect(sum.la).toMatchObject({ total: 2, filled: 2, percent: 100, status: "complete" });
    expect(sum.en).toMatchObject({ total: 2, filled: 1, percent: 50, status: "partial" });
  });
});
