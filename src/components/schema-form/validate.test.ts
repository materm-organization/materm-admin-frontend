import { describe, expect, it } from "vitest";

import { EXAMPLE_SECTIONS, SECTION_TYPE_FIXTURES, SECTION_TYPE_KEYS } from "./fixtures";
import { createSchemaValidator } from "./validate";

describe("validate: the shipped content", () => {
  it("compiles all 12 section schemas", () => {
    expect(SECTION_TYPE_KEYS).toHaveLength(12);
    for (const key of SECTION_TYPE_KEYS) {
      expect(createSchemaValidator(SECTION_TYPE_FIXTURES[key].json_schema).available, key).toBe(true);
    }
  });

  it.each(SECTION_TYPE_KEYS)("default_props of %s pass the draft level", (key) => {
    const type = SECTION_TYPE_FIXTURES[key];
    const issues = createSchemaValidator(type.json_schema).validate(type.default_props, { mode: "draft" });
    expect(issues).toEqual([]);
  });

  it("has 17 example sections", () => {
    expect(EXAMPLE_SECTIONS).toHaveLength(17);
  });

  it.each(EXAMPLE_SECTIONS.map((s) => [`${s.page}#${s.index} ${s.section_type}`, s] as const))(
    "example %s passes the publish level",
    (_name, section) => {
      const type = SECTION_TYPE_FIXTURES[section.section_type];
      const issues = createSchemaValidator(type.json_schema).validate(section.props, {
        mode: "publish",
        defaultLocale: "la",
      });
      expect(issues).toEqual([]);
    }
  );
});
