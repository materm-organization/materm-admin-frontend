// Pasted HTML is never trusted (doc/07 section 5.3, doc/04 section 3.7). Two layers: this function strips
// everything but the structure before ProseMirror sees it; the editor schema then drops every node / mark that
// is not in the profile's allow-list, and the Link extension refuses unsafe `href`s while parsing.

const DROP_WHOLE = new Set(["script", "style", "iframe", "object", "embed", "link", "meta", "svg", "math", "form", "input", "button", "textarea", "select", "noscript", "template", "head", "title", "img", "video", "audio", "canvas"]);
const KEEP_ATTRS: Record<string, string[]> = { a: ["href"], ol: ["start"] };

export function sanitizePastedHtml(html: string): string {
  if (typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const clean = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      const tag = child.tagName.toLowerCase();
      if (DROP_WHOLE.has(tag)) {
        child.remove();
        continue;
      }
      const keep = KEEP_ATTRS[tag] ?? [];
      for (const attr of Array.from(child.attributes)) {
        if (!keep.includes(attr.name.toLowerCase())) child.removeAttribute(attr.name);
      }
      clean(child);
    }
  };
  clean(doc.body);
  return doc.body.innerHTML;
}
