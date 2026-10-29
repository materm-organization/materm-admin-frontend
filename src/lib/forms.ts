// Limits and pure rules of the forms screens (doc/05 sections 13.6.1 - 13.6.4). Shared by the editor and the mock API, so app
// code never imports `@/mocks`. The numbers marked [proposal] in the doc are the ones the server may still change; the server
// decides for real (422).
export const MAX_FORM_NAME = 120;
export const MAX_FORM_TITLE = 120;
export const MAX_FORM_DESCRIPTION = 400;
export const MAX_SUBMIT_LABEL = 60;
export const MAX_SENDING_LABEL = 60;
export const MAX_SUCCESS_TITLE = 120;
export const MAX_SUCCESS_DESCRIPTION = 400;
export const MAX_SUCCESS_AGAIN = 60;
export const MAX_MESSAGES = 30;
export const MAX_MESSAGE_TEXT = 300;
export const MESSAGE_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
export const MAX_FIELD_LABEL = 120;
export const MAX_PLACEHOLDER = 200;
export const MAX_HELP = 300;
export const MAX_OPTION_LABEL = 120;

// Recipients (13.6.4).
export const MAX_RECIPIENTS = 20;
export const MAX_EMAIL = 254;
// The CHECK of `forms_form_recipients.email`.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const RECIPIENT_KINDS = ["to", "cc", "bcc"] as const;

// Settings (13.6.3): [min, max].
export const SETTING_RANGES = {
  retention_days: [30, 1095],
  rate_limit_max: [1, 1000],
  rate_limit_window_s: [10, 86400],
  rate_limit_daily_max: [1, 100000],
  min_fill_seconds: [0, 600],
} as const;
export const HONEYPOT_RE = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
export const MAX_REDIRECT_URL = 500;
export const REDIRECT_RE = /^(\/|https?:\/\/)/;

// The ETag of a form is `"<lock_version>"` (a list row has no header, so it is built from the row).
export const formEtag = (row: { lock_version: number }) => `"${row.lock_version}"`;

// The recipient set as the server sees it: a stable text for "same set" checks and for the mock's `recipients_etag`.
export function recipientKey(r: { email: string; kind: string; topic_value: string | null; is_active: boolean }): string {
  return `${r.email.trim().toLowerCase()}\u001f${r.kind}\u001f${r.topic_value ?? ""}\u001f${r.is_active ? 1 : 0}`;
}

// BR-34: a published form (or one that does not store submissions) needs an ACTIVE `to` recipient for every topic.
export function hasCatchAllRecipient(list: ReadonlyArray<{ kind: string; topic_value: string | null; is_active: boolean }>): boolean {
  return list.some((r) => r.kind === "to" && r.topic_value === null && r.is_active);
}
