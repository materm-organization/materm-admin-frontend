import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "@/test/msw-server";
import { cmsHandlers } from "@/test/cms-handlers";

import { EXAMPLE_SECTIONS, SECTION_TYPE_FIXTURES, SECTION_TYPE_KEYS } from "./fixtures";
import { issueTexts, renderSchemaForm, settle } from "./test-utils";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }), usePathname: () => "/admin/dev" }));

beforeEach(() => server.use(...cmsHandlers));
afterEach(() => cleanup());

describe("SchemaForm renders every section type", () => {
  it.each(SECTION_TYPE_KEYS)("%s from default_props in draft mode: no problems, a form", async (key) => {
    const type = SECTION_TYPE_FIXTURES[key];
    const { container } = renderSchemaForm(type, structuredClone(type.default_props), { mode: "draft" });
    await settle();
    expect(container.querySelector('[data-slot="schema-form"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="issue-summary"]')).not.toBeInTheDocument();
    expect(issueTexts(container)).toEqual([]);
    // Something editable is on screen (a field, a group or an add button), and nothing fell back to JSON.
    expect(container.querySelectorAll("input,textarea,button,[role=textbox]").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("has no editor yet");
  });

  it.each(EXAMPLE_SECTIONS.map((s) => [`${s.page}#${s.index} ${s.section_type}`, s] as const))(
    "example %s in publish mode: no problems",
    async (_name, section) => {
      const type = SECTION_TYPE_FIXTURES[section.section_type];
      const { container } = renderSchemaForm(type, structuredClone(section.props), { mode: "publish" });
      await settle();
      expect(container.querySelector('[data-slot="issue-summary"]')).not.toBeInTheDocument();
      expect(issueTexts(container)).toEqual([]);
      expect(container.textContent).not.toContain("has no editor yet");
    }
  );
});
