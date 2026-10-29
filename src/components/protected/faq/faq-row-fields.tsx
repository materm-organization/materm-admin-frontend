"use client";

import { useTranslations } from "next-intl";

import { emptyRow, type FaqRowDraft } from "@/components/protected/faq/faq-draft";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_QUESTION, charCount } from "@/lib/faq";

// The two texts of one question in one language (doc/07 section 3.18): the question (<= 200) and the answer (rich text, profile `lite`).
// Used by the open question of the list and by the "Add question" dialog. Element ids are `<idPrefix>-question-<locale>` / `-answer-<locale>`.
export function FaqRowFields({
  idPrefix,
  locale,
  localeName,
  row,
  onChange,
  disabled,
  problems,
}: {
  idPrefix: string;
  locale: string;
  localeName: string;
  row: FaqRowDraft | undefined;
  onChange: (next: FaqRowDraft) => void;
  disabled: boolean;
  // Field key (`question.la`, `answer.en`) -> message.
  problems: Record<string, string>;
}) {
  const t = useTranslations("faq.row");
  const value = row ?? emptyRow();
  const qId = `${idPrefix}-question-${locale}`;
  const aId = `${idPrefix}-answer-${locale}`;
  const qProblem = problems[`question.${locale}`];
  const aProblem = problems[`answer.${locale}`];
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={qId}>{t("question", { language: localeName })}</Label>
        <Input id={qId} value={value.question} disabled={disabled} autoComplete="off" aria-invalid={qProblem ? true : undefined} onChange={(e) => onChange({ ...value, question: e.target.value })} />
        <p className="flex justify-between text-xs text-muted-foreground">
          <span role={qProblem ? "alert" : undefined} className={qProblem ? "text-destructive" : undefined}>{qProblem ?? ""}</span>
          <span className="tabular-nums">{charCount(value.question)} / {MAX_QUESTION}</span>
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={aId}>{t("answer", { language: localeName })}</Label>
        <RichTextEditor
          id={aId}
          // The editor reads `value` at mount and when it changes from OUTSIDE; a key per language gives each its own editor.
          key={aId}
          value={value.answer}
          profile="lite"
          disabled={disabled}
          invalid={Boolean(aProblem)}
          maxNodes={50}
          aria-label={t("answer", { language: localeName })}
          onChange={(doc) => onChange({ ...value, answer: doc ?? null })}
        />
        {aProblem ? <p role="alert" className="text-xs text-destructive">{aProblem}</p> : null}
      </div>
    </div>
  );
}
