import { describe, expect, it } from "vitest";

import { getMockDb, resetMockDb } from "@/mocks/mock-db";
import { listTemplates } from "@/mocks/mock-pages";

import { sectionExcerpt } from "./section-excerpt";
import { addOptions, orderProblem, requirementStates, resolvePosition } from "./section-structure";

const templates = () => {
  resetMockDb();
  return Object.fromEntries(listTemplates(getMockDb()).map((t) => [t.key, t]));
};
const s = (key: string) => ({ section_type: { key } });

describe("template structure rules", () => {
  it("refuses a hero that is not first, a section before the hero and a type the template does not allow", () => {
    const { standard, blog_index } = templates();
    expect(orderProblem(standard, ["hero_brand", "intro_text"])).toBeNull();
    expect(orderProblem(standard, ["intro_text", "hero_brand"])).toBe("hero_first");
    expect(orderProblem(standard, ["hero_brand", "contact_section"])).toBe("section_not_allowed");
    expect(orderProblem(blog_index, ["post_list", "hero_article"])).toBe("after_hero");
  });

  it("offers the allowed types and disables one that reached its maximum (the hero counts as a group)", () => {
    const { standard } = templates();
    const options = addOptions(standard, [s("hero_article")]);
    expect(options.find((o) => o.type.section_type_key === "hero_brand")?.disabledReason).toBe("max");
    expect(options.find((o) => o.type.section_type_key === "faq")?.disabledReason).toBeNull();
    expect(options.some((o) => o.type.section_type_key === "contact_section")).toBe(false);
  });

  it("puts a hero on top and a section that follows the hero below it", () => {
    const { standard, contact } = templates();
    expect(resolvePosition(standard, [], "hero_brand", 3)).toBe(0);
    expect(resolvePosition(standard, [s("hero_brand"), s("faq")], "faq", 0)).toBe(1);
    expect(resolvePosition(contact, [s("hero_brand")], "contact_section", 0)).toBe(1);
    expect(resolvePosition(contact, [s("hero_brand")], "faq", 9)).toBe(1);
  });

  it("tells which requirements of the template are met", () => {
    const { contact } = templates();
    expect(requirementStates(contact, [s("hero_brand")]).map((r) => r.met)).toEqual([true, false]);
    expect(requirementStates(contact, [s("hero_brand"), s("contact_section")]).every((r) => r.met)).toBe(true);
  });
});

describe("section excerpt", () => {
  it("takes the title of the chosen language, falls back to the default one and cuts at 40 characters", () => {
    expect(sectionExcerpt({ title: { la: "ສະບາຍດີ", en: "Hello" } }, "en", "la")).toBe("Hello");
    expect(sectionExcerpt({ title: { la: "ສະບາຍດີ" } }, "en", "la")).toBe("ສະບາຍດີ");
    expect(sectionExcerpt({ title: { en: "x".repeat(60) } }, "en", "la")).toHaveLength(40);
    expect(sectionExcerpt({ text: { en: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Rich words" }] }] } } }, "en", "la")).toBe("Rich words");
    expect(sectionExcerpt({ show_logo: true }, "en", "la")).toBe("");
  });
});
