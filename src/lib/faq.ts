// Limits of the FAQ screens (doc/05 section 13.5, doc/07 section 3.18). Shared by the editor, the create dialog and the in-memory
// API model.
export { ALBUM_KEY_PATTERN as FAQ_KEY_PATTERN, MAX_ALBUM_KEY as MAX_FAQ_KEY, charCount, keyFromTitle as keyFromName, keyProblem } from "@/lib/albums";

// The internal label of a group (not translated, 04 C-05).
export const MAX_FAQ_NAME = 120;
export const MAX_QUESTION = 200;
// [proposal] in 05 13.5.4: more than 100 questions in a group is a 422 `limit_exceeded` when adding.
export const MAX_FAQ_ITEMS = 100;

// A rich text document (profile `lite`) without a text node that has text = empty: `{ type: "doc", content: [] }`.
export type RichDoc = { type: "doc"; content?: unknown[] } | Record<string, unknown>;

export const emptyDoc = (): RichDoc => ({ type: "doc", content: [] });

export function docHasText(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return false;
  const node = doc as { type?: unknown; text?: unknown; content?: unknown };
  if (node.type === "text" && typeof node.text === "string" && node.text.trim() !== "") return true;
  return Array.isArray(node.content) && node.content.some(docHasText);
}
