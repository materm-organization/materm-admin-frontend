import { mergeAttributes, Node } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";

import { isSafeRichLinkHref } from "@/components/schema-form/link-rules";

// The Tiptap extension set per profile (doc/07 section 5.3, doc/04 section 3.7). Everything the StarterKit
// brings beyond the allow-list is switched off, so a pasted node / mark the backend would reject cannot exist
// in the editor at all. Order: nodes of both profiles first, then the `full` extras.
export type RichTextProfile = "lite" | "full";

// A link mark may point at a page / post by id instead of a URL (written by other tools, kept on round trip).
const LinkWithRefs = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      page_id: { default: null },
      post_id: { default: null },
    };
  },
});

// "Lead" paragraph (standfirst): at most one, the first node of a `full` document.
export const Lead = Node.create({
  name: "lead",
  group: "block",
  content: "inline*",
  parseHTML: () => [{ tag: "p[data-lead]" }],
  renderHTML: ({ HTMLAttributes }) => ["p", mergeAttributes(HTMLAttributes, { "data-lead": "" }), 0],
  addCommands() {
    return {
      // Turns the first block into the lead (or back into a paragraph); only the first block can be the lead.
      toggleLead:
        () =>
        ({ state, tr, dispatch }) => {
          const first = state.doc.firstChild;
          if (!first) return false;
          const target =
            first.type.name === "lead"
              ? state.schema.nodes.paragraph
              : first.type.name === "paragraph"
                ? state.schema.nodes.lead
                : null;
          if (!target) return false;
          if (dispatch) dispatch(tr.setNodeMarkup(0, target));
          return true;
        },
    };
  },
});

// Atoms: kept intact on a round trip (a `full` body can hold them) but inserted by the posts editor, not here.
function atom(name: "image" | "embed", attributeNames: string[], label: (attrs: Record<string, unknown>) => string) {
  return Node.create({
    name,
    group: "block",
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      return Object.fromEntries(attributeNames.map((a) => [a, { default: null }]));
    },
    parseHTML: () => [{ tag: `div[data-rt-node="${name}"]` }],
    renderHTML({ node, HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-rt-node": name, class: "rt-atom" }), label(node.attrs)];
    },
  });
}

export const ImageNode = atom("image", ["media_id", "alt", "caption"], (a) => `Image #${a.media_id ?? "?"}`);
export const EmbedNode = atom("embed", ["provider", "url"], (a) => `Embed: ${a.provider ?? "?"}`);

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    lead: { toggleLead: () => ReturnType };
  }
}

export function buildExtensions(profile: RichTextProfile) {
  const full = profile === "full";
  return [
    StarterKit.configure({
      // Not in either profile.
      underline: false,
      strike: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      // Would append an empty paragraph after every block quote / list.
      trailingNode: false,
      heading: full ? { levels: [2, 3] } : false,
      blockquote: full ? {} : false,
      // Replaced below with the page_id / post_id aware one.
      link: false,
    }),
    LinkWithRefs.configure({
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      defaultProtocol: "https",
      protocols: ["mailto", "tel"],
      // R-016: `https:`, `mailto:`, `tel:`, `/path` (not `//host`, not `/\host`, no `#anchor` in rich text).
      isAllowedUri: (url) => isSafeRichLinkHref(url),
      // Tiptap's defaults (`target=_blank`, `rel`, `class`) are not stored attributes of ours.
      HTMLAttributes: { target: null, rel: null, class: null },
    }),
    ...(full ? [Lead, ImageNode, EmbedNode] : []),
  ];
}
