// The recipients tab's own state, pure (doc/05 13.6.4). The whole set is replaced at once, so the draft is the whole list.
import { EMAIL_RE, MAX_EMAIL, MAX_RECIPIENTS, hasCatchAllRecipient } from "@/lib/forms";
import type { FormRecipient, FormRecipientKind, RecipientInput } from "@/types/forms";

export type RecipientRow = { id: string; email: string; kind: FormRecipientKind; topic_value: string | null; is_active: boolean };

export type RecipientProblem = "required" | "invalid_format" | "too_long" | "duplicate";
export type RecipientsProblems = {
  rows: Record<string, RecipientProblem>;
  // Over 20.
  tooMany: boolean;
  // BR-34: no active `to` for every topic.
  noCatchAll: boolean;
};

let seq = 0;
export const newRow = (patch: Partial<RecipientRow> = {}): RecipientRow => ({ id: `r${(seq += 1)}`, email: "", kind: "to", topic_value: null, is_active: true, ...patch });

export const rowsFromRecipients = (list: FormRecipient[]): RecipientRow[] =>
  list.map((r) => ({ id: r.id !== undefined ? `s${r.id}` : `r${(seq += 1)}`, email: r.email, kind: r.kind, topic_value: r.topic_value, is_active: r.is_active }));

const keyOf = (r: RecipientRow) => `${r.email.trim().toLowerCase()}\u001f${r.kind}\u001f${r.topic_value ?? ""}`;

export const toPayload = (rows: RecipientRow[]): RecipientInput[] => rows.map((r) => ({ email: r.email.trim(), kind: r.kind, topic_value: r.topic_value, is_active: r.is_active }));

// Same "as sent" comparison for the dirty flag: row ids do not count, an address is compared trimmed.
export const rowsEqual = (a: RecipientRow[], b: RecipientRow[]) => JSON.stringify(toPayload(a)) === JSON.stringify(toPayload(b));

// `needsCatchAll`: the form is published, or it does not keep its submissions (05 13.6.4 BR-34).
export function validateRows(rows: RecipientRow[], needsCatchAll: boolean): RecipientsProblems {
  const problems: RecipientsProblems = { rows: {}, tooMany: rows.length > MAX_RECIPIENTS, noCatchAll: false };
  const seen = new Set<string>();
  for (const r of rows) {
    const email = r.email.trim();
    if (email === "") problems.rows[r.id] = "required";
    else if ([...email].length > MAX_EMAIL) problems.rows[r.id] = "too_long";
    else if (!EMAIL_RE.test(email)) problems.rows[r.id] = "invalid_format";
    else if (seen.has(keyOf(r))) problems.rows[r.id] = "duplicate";
    seen.add(keyOf(r));
  }
  problems.noCatchAll = needsCatchAll && !hasCatchAllRecipient(rows);
  return problems;
}

export const hasProblems = (p: RecipientsProblems) => Object.keys(p.rows).length > 0 || p.tooMany || p.noCatchAll;
