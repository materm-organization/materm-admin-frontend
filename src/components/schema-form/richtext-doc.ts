// The stored rich-text value is a ProseMirror / Tiptap document (doc/04 section 3.7), never HTML.
// Pure helpers (no React, no Tiptap) so the validator, completeness and the editor share them.
export type RichTextMark = { type: string; attrs?: Record<string, unknown> };
export type RichTextNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  marks?: RichTextMark[];
  text?: string;
};
export type RichTextDoc = { type: "doc"; content?: RichTextNode[] };

export function isRichTextDoc(value: unknown): value is RichTextDoc {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === "doc"
  );
}

// "Empty" = no text node with a non-blank string (an image / embed node counts as content).
export function isRichTextEmpty(value: unknown): boolean {
  if (!isRichTextDoc(value)) return true;
  const visit = (node: RichTextNode): boolean => {
    if (node.type === "text") return typeof node.text === "string" && node.text.trim().length > 0;
    if (node.type === "image" || node.type === "embed") return true;
    return (node.content ?? []).some(visit);
  };
  return !(value.content ?? []).some(visit);
}

export function richTextPlainText(value: unknown): string {
  if (!isRichTextDoc(value)) return "";
  const parts: string[] = [];
  const visit = (node: RichTextNode) => {
    if (node.type === "text" && typeof node.text === "string") parts.push(node.text);
    else if (node.type === "hardBreak") parts.push("\n");
    (node.content ?? []).forEach(visit);
    if (["paragraph", "heading", "listItem", "blockquote"].includes(node.type)) parts.push("\n");
  };
  (value.content ?? []).forEach(visit);
  return parts.join("").trim();
}

// All nodes, text nodes included (the "lite <= 50 nodes" counter of the editor).
export function countRichTextNodes(value: unknown): number {
  if (!isRichTextDoc(value)) return 0;
  const visit = (node: RichTextNode): number =>
    1 + (node.content ?? []).reduce((sum, child) => sum + visit(child), 0);
  return (value.content ?? []).reduce((sum, node) => sum + visit(node), 0);
}

// Every `href` of a link mark in the document (R-016 applies to rich-text links too).
export function collectRichTextLinks(value: unknown): Array<{ href: string; path: Array<string | number> }> {
  const out: Array<{ href: string; path: Array<string | number> }> = [];
  if (!isRichTextDoc(value)) return out;
  const visit = (node: RichTextNode, path: Array<string | number>) => {
    (node.marks ?? []).forEach((mark, m) => {
      const href = mark.attrs?.href;
      if (mark.type === "link" && typeof href === "string") out.push({ href, path: [...path, "marks", m] });
    });
    (node.content ?? []).forEach((child, i) => visit(child, [...path, "content", i]));
  };
  (value.content ?? []).forEach((node, i) => visit(node, ["content", i]));
  return out;
}

const EMPTY_PARAGRAPH: RichTextNode = { type: "paragraph" };

export function emptyRichTextDoc(): RichTextDoc {
  return { type: "doc", content: [EMPTY_PARAGRAPH] };
}

// Keeps only the attributes the backend allow-list knows (doc/04 section 3.7), so a Tiptap default such as
// `rel`, `class: null`, `target: "_blank"` or `orderedList.type` never reaches the API (it would be a 422).
const ALLOWED_ATTRS: Record<string, string[]> = {
  heading: ["level"],
  orderedList: ["start"],
  image: ["media_id", "alt", "caption"],
  embed: ["provider", "url"],
};
const ALLOWED_LINK_ATTRS = ["href", "page_id", "post_id", "target"];

function cleanAttrs(allowed: string[], attrs: Record<string, unknown> | undefined) {
  if (!attrs) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = attrs[key];
    if (value !== null && value !== undefined && value !== "") out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function normalizeRichTextNode(node: RichTextNode): RichTextNode {
  const out: RichTextNode = { type: node.type };
  const attrs =
    node.type === "orderedList"
      ? cleanAttrs(ALLOWED_ATTRS.orderedList, node.attrs?.start === 1 ? { ...node.attrs, start: undefined } : node.attrs)
      : cleanAttrs(ALLOWED_ATTRS[node.type] ?? [], node.attrs);
  if (attrs) out.attrs = attrs;
  if (node.text !== undefined) out.text = node.text;
  if (node.content) out.content = node.content.map(normalizeRichTextNode);
  if (node.marks && node.marks.length > 0) {
    out.marks = node.marks.map((mark) => {
      const markAttrs = mark.type === "link" ? cleanAttrs(ALLOWED_LINK_ATTRS, mark.attrs) : undefined;
      return markAttrs ? { type: mark.type, attrs: markAttrs } : { type: mark.type };
    });
  }
  return out;
}

export function normalizeRichTextDoc(doc: RichTextDoc): RichTextDoc {
  return { type: "doc", content: (doc.content ?? []).map(normalizeRichTextNode) };
}
