import { describe, expect, it } from "vitest";

import {
  collectRichTextLinks,
  countRichTextNodes,
  isRichTextEmpty,
  normalizeRichTextDoc,
  richTextPlainText,
  type RichTextDoc,
} from "@/components/schema-form/richtext-doc";

import { sanitizePastedHtml } from "./sanitize";

const para = (text: string, marks?: RichTextDoc["content"]) => ({ type: "paragraph", content: [{ type: "text", text, ...(marks ? { marks } : {}) }] });

describe("rich text document helpers", () => {
  it("emptiness: no text node, or only blanks", () => {
    expect(isRichTextEmpty(undefined)).toBe(true);
    expect(isRichTextEmpty({ type: "doc" })).toBe(true);
    expect(isRichTextEmpty({ type: "doc", content: [{ type: "paragraph" }] })).toBe(true);
    expect(isRichTextEmpty({ type: "doc", content: [para("  ")] })).toBe(true);
    expect(isRichTextEmpty({ type: "doc", content: [para("a")] })).toBe(false);
    expect(isRichTextEmpty({ type: "doc", content: [{ type: "image", attrs: { media_id: 1 } }] })).toBe(false);
    expect(isRichTextEmpty("<p>x</p>")).toBe(true);
  });

  it("plain text, node count and link hrefs", () => {
    const doc: RichTextDoc = {
      type: "doc",
      content: [para("one"), { type: "paragraph", content: [{ type: "text", text: "two", marks: [{ type: "link", attrs: { href: "/x" } }] }] }],
    };
    expect(richTextPlainText(doc)).toBe("one\ntwo");
    expect(countRichTextNodes(doc)).toBe(4);
    expect(collectRichTextLinks(doc)).toEqual([{ href: "/x", path: ["content", 1, "content", 0, "marks", 0] }]);
  });

  it("normalising keeps only the attributes of the backend allow-list", () => {
    const raw = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, id: null }, content: [{ type: "text", text: "H" }] },
        { type: "orderedList", attrs: { start: 1, type: null }, content: [{ type: "listItem", content: [para("a")] }] },
        { type: "orderedList", attrs: { start: 3, type: null }, content: [{ type: "listItem", content: [para("b")] }] },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "link",
              marks: [{ type: "link", attrs: { href: "https://e.test", target: null, rel: "noopener noreferrer nofollow", class: null, title: null } }, { type: "bold" }],
            },
          ],
        },
      ],
    } as RichTextDoc;
    const out = normalizeRichTextDoc(raw);
    expect(out.content?.[0]).toEqual({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "H" }] });
    expect(out.content?.[1].attrs).toBeUndefined();
    expect(out.content?.[2].attrs).toEqual({ start: 3 });
    expect(out.content?.[3].content?.[0].marks).toEqual([{ type: "link", attrs: { href: "https://e.test" } }, { type: "bold" }]);
  });
});

describe("sanitizePastedHtml", () => {
  it("drops scripts, styles, images, event handlers, classes and styles", () => {
    const html =
      '<p style="color:red" class="x" onclick="evil()">Hi <b id="y">there</b><script>alert(1)</script><img src=x onerror=alert(1)></p><style>p{}</style><iframe src="//e"></iframe>';
    const out = sanitizePastedHtml(html);
    expect(out).toBe("<p>Hi <b>there</b></p>");
  });
  it("keeps href on links and start on ordered lists only", () => {
    const out = sanitizePastedHtml('<a href="https://e.test" target="_blank" rel="x" onclick="y">l</a><ol start="3" type="a"><li>i</li></ol>');
    expect(out).toBe('<a href="https://e.test">l</a><ol start="3"><li>i</li></ol>');
  });
});
