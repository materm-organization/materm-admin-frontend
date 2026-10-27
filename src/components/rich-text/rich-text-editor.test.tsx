import { render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { EXAMPLE_SECTIONS, SECTION_TYPE_FIXTURES } from "@/components/schema-form/fixtures";
import postExample from "@/components/schema-form/fixtures/examples/post.music-night-under-the-stars.json";
import { normalizeRichTextDoc, type RichTextDoc } from "@/components/schema-form/richtext-doc";
import { walkSchemaValue } from "@/components/schema-form/schema-walker";

import en from "../../../i18n/en.json";
import { RichTextEditor } from "./rich-text-editor";
import type { Editor } from "@tiptap/react";

// Every rich-text document of the real content: the `lite` ones of the 17 example sections and the `full` body of
// the example post. Loading a stored document must neither change it nor report a change (that would mark the
// form dirty), whatever the editor's schema does with it.
type Sample = { name: string; profile: "lite" | "full"; doc: RichTextDoc };

function samples(): Sample[] {
  const out: Sample[] = [];
  for (const section of EXAMPLE_SECTIONS) {
    const schema = SECTION_TYPE_FIXTURES[section.section_type].json_schema;
    walkSchemaValue(schema, schema, section.props, ({ schema: node, value, pointer }) => {
      if (node["x-richtext"] && value && typeof value === "object") {
        for (const [locale, doc] of Object.entries(value)) {
          out.push({ name: `${section.page}#${section.index} ${section.section_type} ${pointer}/${locale}`, profile: "lite", doc: doc as RichTextDoc });
        }
      }
    });
  }
  for (const t of (postExample as unknown as { translations: Array<{ locale: string; body: RichTextDoc }> }).translations) {
    out.push({ name: `post body ${t.locale}`, profile: "full", doc: t.body });
  }
  return out;
}

const all = samples();

describe("RichTextEditor round trip on the real documents", () => {
  it("covers the lite documents of the examples and both languages of the post body", () => {
    expect(all.filter((s) => s.profile === "lite").length).toBeGreaterThanOrEqual(8);
    expect(all.filter((s) => s.profile === "full")).toHaveLength(2);
    expect(JSON.stringify(all.filter((s) => s.profile === "full"))).toContain('"lead"');
  });

  it.each(all.map((s) => [s.name, s] as const))("%s: no change reported, content identical", async (_name, sample) => {
    const onChange = vi.fn();
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Vientiane">
        <RichTextEditor value={sample.doc} onChange={onChange} profile={sample.profile} aria-label="x" />
      </NextIntlClientProvider>
    );
    await waitFor(() => expect(container.querySelector(".ProseMirror")).toBeInTheDocument());
    const editor = (container.querySelector(".ProseMirror") as unknown as { editor: Editor }).editor;
    expect(onChange).not.toHaveBeenCalled();
    expect(normalizeRichTextDoc(editor.getJSON() as RichTextDoc)).toEqual(normalizeRichTextDoc(sample.doc));
  });
});
