import type { FormDraft, FormEditMode } from "@/components/protected/forms/form-draft";
import type { FormDetail } from "@/types/forms";
import type { Locale } from "@/types/locales";

// What the Texts, Fields and Settings tabs of the form editor get: the shared draft (the editor owns it), the server's version it is
// compared with, the messages of the problems by key (`texts.la.title`, `fields.email.la.label`, `name`), and what the user may write.
export type FormTabProps = {
  form: FormDetail;
  draft: FormDraft;
  baseline: FormDraft;
  onChange: (next: FormDraft) => void;
  problems: Record<string, string>;
  // Active languages and the default one.
  locales: Locale[];
  defaultLocale: string;
  mode: FormEditMode;
};

export const shortLabel = (locales: Locale[], code: string) => locales.find((l) => l.code === code)?.short_label || code.toUpperCase();
