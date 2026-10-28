// A short text that tells sections of one type apart in the list (doc/07 SCR-20: the title in the chosen language,
// 40 characters). Props are free-form JSON; the first localized text found (`title`, `heading` first) is used.
const PREFERRED = ["title", "heading", "headline", "eyebrow", "label", "text", "description"];
const MAX = 40;

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

function plain(node: unknown): string {
  if (typeof node === "string") return node;
  if (isObject(node)) {
    if (typeof node.text === "string") return node.text;
    if (Array.isArray(node.content)) return node.content.map(plain).join(" ");
  }
  return "";
}

// A locale map: every value is a string or a rich-text document.
function localeText(value: unknown, locale: string, fallback: string): string {
  if (!isObject(value)) return "";
  const entry = value[locale] ?? value[fallback];
  return plain(entry).replace(/\s+/g, " ").trim();
}

export function sectionExcerpt(props: Record<string, unknown> | undefined, locale: string, fallbackLocale: string): string {
  if (!props) return "";
  const keys = [...PREFERRED.filter((k) => k in props), ...Object.keys(props).filter((k) => !PREFERRED.includes(k))];
  for (const key of keys) {
    const text = localeText(props[key], locale, fallbackLocale);
    if (text) return [...text].length > MAX ? `${[...text].slice(0, MAX - 1).join("")}…` : text;
  }
  return "";
}
