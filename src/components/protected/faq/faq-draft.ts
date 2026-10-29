// The form model of one FAQ question (T1.5.6, doc/05 13.5): a question and an answer (rich text, profile `lite`) per language. A language
// row has BOTH texts (the columns are NOT NULL), so a row is either complete or not there. The visibility is NOT part of it: it is saved at once.
import { isRichTextEmpty, type RichTextDoc } from "@/components/schema-form/richtext-doc";
import { MAX_QUESTION, charCount } from "@/lib/faq";
import type { CreateFaqItemPayload, FaqAnswer, FaqItem, UpdateFaqItemPayload } from "@/types/faq";

export type FaqEditMode = "full" | "translate" | "none";
export type FaqRowDraft = { question: string; answer: RichTextDoc | null };
export type FaqItemDraft = { rows: Record<string, FaqRowDraft> };
export type FaqProblemCode = "required" | "too_long" | "bothRequired";

export const emptyRow = (): FaqRowDraft => ({ question: "", answer: null });

export function draftFromFaqItem(item: Pick<FaqItem, "translations">, localeCodes: readonly string[]): FaqItemDraft {
  const rows: Record<string, FaqRowDraft> = {};
  for (const code of localeCodes) {
    const t = item.translations[code];
    rows[code] = t ? { question: t.question, answer: isRichTextEmpty(t.answer) ? null : (t.answer as RichTextDoc) } : emptyRow();
  }
  return { rows };
}

const answerKey = (a: RichTextDoc | null) => (a === null || isRichTextEmpty(a) ? "" : JSON.stringify(a));
const rowFilled = (r: FaqRowDraft | undefined) => Boolean(r && (r.question.trim() !== "" || answerKey(r.answer) !== ""));

export function itemDraftsEqual(a: FaqItemDraft, b: FaqItemDraft): boolean {
  for (const code of new Set([...Object.keys(a.rows), ...Object.keys(b.rows)])) {
    const x = a.rows[code] ?? emptyRow();
    const y = b.rows[code] ?? emptyRow();
    if (x.question !== y.question || answerKey(x.answer) !== answerKey(y.answer)) return false;
  }
  return true;
}

// Keys: `question.<l>`, `answer.<l>`.
export function validateItemDraft(draft: FaqItemDraft, baseline: FaqItemDraft | null, defaultLocale: string, mode: FaqEditMode): Record<string, FaqProblemCode> {
  const problems: Record<string, FaqProblemCode> = {};
  for (const [code, row] of Object.entries(draft.rows)) {
    const q = row.question.trim();
    const hasAnswer = answerKey(row.answer) !== "";
    if (charCount(row.question) > MAX_QUESTION) problems[`question.${code}`] = "too_long";
    if (q === "" && !hasAnswer) {
      const existed = baseline ? rowFilled(baseline.rows[code]) : false;
      // The default language always has both; another language that was emptied is removed (`update`), a translator can not do that.
      if (code === defaultLocale && (existed || !baseline)) {
        problems[`question.${code}`] = "required";
        problems[`answer.${code}`] = "required";
      } else if (existed && mode !== "full") {
        problems[`question.${code}`] = "bothRequired";
      }
    } else if (q === "") problems[`question.${code}`] = "required";
    else if (!hasAnswer) problems[`answer.${code}`] = "required";
  }
  return problems;
}

// The `lite` editor can only produce the nodes the backend accepts for an answer (paragraph / bulletList / orderedList at the top,
// no headings), so the wire type is a narrowing of the editor's generic document.
const docOf = (a: RichTextDoc | null): FaqAnswer => (a ?? { type: "doc", content: [] }) as FaqAnswer;

// Only the languages and texts that changed; an emptied non-default language is removed (`null`, `update` only).
export function buildItemPatch(baseline: FaqItemDraft, edit: FaqItemDraft, defaultLocale: string, mode: FaqEditMode): UpdateFaqItemPayload | null {
  if (mode === "none") return null;
  const translations: NonNullable<UpdateFaqItemPayload["translations"]> = {};
  for (const [code, row] of Object.entries(edit.rows)) {
    const base = baseline.rows[code] ?? emptyRow();
    const sameQ = row.question === base.question;
    const sameA = answerKey(row.answer) === answerKey(base.answer);
    if (sameQ && sameA) continue;
    if (!rowFilled(row)) {
      if (mode === "full" && code !== defaultLocale && rowFilled(base)) translations[code] = null;
      continue;
    }
    const existed = rowFilled(base);
    const part: { question?: string; answer?: FaqAnswer } = {};
    if (!existed || !sameQ) part.question = row.question.trim();
    if (!existed || !sameA) part.answer = docOf(row.answer);
    translations[code] = part;
  }
  return Object.keys(translations).length > 0 ? { translations } : null;
}

// A new question: every language that has anything in it (the default language has both, see `validateItemDraft`).
export function buildCreatePayload(draft: FaqItemDraft, isVisible: boolean): CreateFaqItemPayload {
  const translations: CreateFaqItemPayload["translations"] = {};
  for (const [code, row] of Object.entries(draft.rows)) {
    if (rowFilled(row)) translations[code] = { question: row.question.trim(), answer: docOf(row.answer) };
  }
  return { translations, is_visible: isVisible };
}

export function problemKeyOf(path: string): string {
  const t = /^\/translations\/([^/]+)\/([a-z_]+)/.exec(path);
  if (t) return `${t[2]}.${t[1]}`;
  if (path.startsWith("/name")) return "name";
  return path.replace(/^\//, "") || "item";
}

// "Go to field": the question a blocker pointer names (`/items/<public_id>/translations/la/answer`).
export function pointerTarget(pointer: string): { publicId?: string; locale?: string; field?: "question" | "answer" } {
  const m = /^\/items\/([^/]+)\/translations\/([^/]+)\/(question|answer)/.exec(pointer);
  if (m) return { publicId: m[1], locale: m[2], field: m[3] as "question" | "answer" };
  const item = /^\/items\/([^/]+)/.exec(pointer);
  return { publicId: item?.[1] };
}
