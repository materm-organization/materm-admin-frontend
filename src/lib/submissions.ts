// Pure rules of the submissions inbox (doc/05 section 13.7; diagram 01 6d). Shared by the screens and the mock API.
import type { SubmissionStatus } from "@/types/submissions";

export const SUBMISSION_STATUSES = ["new", "read", "replied", "archived", "spam"] as const satisfies readonly SubmissionStatus[];

// The status table of 13.7.4 ("same status" is not a move). The UI offers only the moves that are allowed from the CURRENT
// status; the server still decides (409 `INVALID_STATE` `invalid_transition`).
export const SUBMISSION_TRANSITIONS: Record<SubmissionStatus, readonly SubmissionStatus[]> = {
  new: ["read", "replied", "archived", "spam"],
  read: ["replied", "archived", "spam"],
  replied: ["archived"],
  archived: ["read"],
  spam: ["new"],
};

export const canMoveSubmission = (from: SubmissionStatus, to: SubmissionStatus) => SUBMISSION_TRANSITIONS[from].includes(to);

export const MAX_NOTE = 2000;
export const MAX_BULK_IDS = 100;
export const MAX_SUBMISSION_KEYWORD = 100;
// A keyword search needs a window of at most 366 days; none given = the last 90 days (13.7.2).
export const KEYWORD_MAX_WINDOW_DAYS = 366;
export const KEYWORD_DEFAULT_WINDOW_DAYS = 90;
export const EXPORT_MAX_ROWS = 50_000;
// The inbox is held in the cache for a minute only (PII; doc/07 3.20).
export const SUBMISSION_GC_TIME = 60_000;

const DAY_MS = 86_400_000;

export type WindowProblem = "from_after_to" | "too_large";

// Client check of the date window before a request is sent: `from > to` is 422 `out_of_range`; with a keyword the window may
// not exceed 366 days (a missing end counts up to `now`, a missing start 90 days before the end).
export function windowProblem(args: { from?: string; to?: string; keyword?: string }, now: number = Date.now()): WindowProblem | null {
  const from = args.from ? Date.parse(args.from) : undefined;
  const to = args.to ? Date.parse(args.to) : undefined;
  if (from !== undefined && to !== undefined && Number.isFinite(from) && Number.isFinite(to) && from > to) return "from_after_to";
  if (!args.keyword) return null;
  if (from === undefined && to === undefined) return null;
  const end = to !== undefined && Number.isFinite(to) ? to : now;
  const start = from !== undefined && Number.isFinite(from) ? from : end - KEYWORD_DEFAULT_WINDOW_DAYS * DAY_MS;
  return end - start > KEYWORD_MAX_WINDOW_DAYS * DAY_MS ? "too_large" : null;
}

// The address the "Reply" button opens. Both parts are encoded; an address without an `@` gets no link at all.
export function replyMailto(email: string | null, topic: string | null): string | null {
  if (!email || !email.includes("@") || /[\r\n]/.test(email)) return null;
  const subject = `Re: ${(topic ?? "").replace(/[\r\n]+/g, " ").trim() || "your message"}`;
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}`;
}

// Spreadsheet formula injection (05 13.7.6 does it on the server; the client uses it for nothing it writes itself). Kept here
// for the mock's CSV so the file it produces behaves like the real one.
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
