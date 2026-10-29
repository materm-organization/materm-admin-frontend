"use client";

import { PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EditorLocaleSwitcher, type LocaleBadge } from "@/components/global/locale/editor-locale-switcher";
import { buildCreatePayload, draftFromFaqItem, validateItemDraft, type FaqItemDraft, type FaqRowDraft } from "@/components/protected/faq/faq-draft";
import { FaqRowFields } from "@/components/protected/faq/faq-row-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import type { Locale } from "@/types/locales";
import type { FaqItem } from "@/types/faq";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locales: Locale[];
  defaultLocale: string;
  initialLocale: string;
  add: (payload: ReturnType<typeof buildCreatePayload>, idempotencyKey: string | undefined) => Promise<{ item: FaqItem }>;
  onConflict: () => void;
  onAdded: (item: FaqItem) => void;
};

// SCR-30 "Add question" (doc/07 section 3.18): the default language needs the question AND the answer; another language is optional, but a
// language that has one text needs the other. One Idempotency-Key per open of the dialog. The new question goes to the end of the group.
export function FaqAddDialog(props: Props) {
  const t = useTranslations("faq.add");
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {props.open ? <AddForm {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AddForm({ open, onOpenChange, locales, defaultLocale, initialLocale, add, onConflict, onAdded }: Props) {
  const t = useTranslations("faq.add");
  const tProblem = useTranslations("faq.problems");
  const tErr = useTranslations("errors");
  const { toastError } = useApiErrorHandler();
  const idempotencyKey = useIdempotencyKey(open);
  const codes = useMemo(() => locales.map((l) => l.code), [locales]);
  const [draft, setDraft] = useState<FaqItemDraft>(() => draftFromFaqItem({ translations: {} }, codes));
  const [visible, setVisible] = useState(true);
  const [locale, setLocale] = useState(initialLocale);
  const [saving, setSaving] = useState(false);
  const [serverProblems, setServerProblems] = useState<Record<string, string>>({});

  const localeName = locales.find((l) => l.code === locale)?.native_name ?? locale;
  const clientProblems = useMemo(() => validateItemDraft(draft, null, defaultLocale, "full"), [draft, defaultLocale]);
  const problems = useMemo(() => {
    const out: Record<string, string> = { ...serverProblems };
    for (const [key, code] of Object.entries(clientProblems)) out[key] = tProblem(code, { max: 200 });
    return out;
  }, [clientProblems, serverProblems, tProblem]);
  const completeness = useMemo(() => {
    const out: Record<string, LocaleBadge> = {};
    for (const l of locales) {
      const row = draft.rows[l.code];
      const missing = (row?.question.trim() ? 0 : 1) + (row?.answer ? 0 : 1);
      out[l.code] = { missing, total: 2, status: missing === 0 ? "complete" : missing === 2 ? "missing" : "partial" };
    }
    return out;
  }, [draft, locales]);
  const [submitted, setSubmitted] = useState(false);

  const submit = async () => {
    setSubmitted(true);
    if (Object.keys(clientProblems).length > 0) {
      const first = Object.keys(clientProblems)[0].split(".")[1];
      if (first) setLocale(first);
      return;
    }
    setSaving(true);
    try {
      const result = await add(buildCreatePayload(draft, visible), idempotencyKey);
      toast.success(t("added"));
      onOpenChange(false);
      onAdded(result.item);
    } catch (error) {
      const parsed = parseApiError(error);
      if (isConflictError(error)) onConflict();
      else if ((parsed.status === 422 || parsed.status === 409) && parsed.fieldErrors.length > 0) {
        const mapped: Record<string, string> = {};
        for (const fe of parsed.fieldErrors) {
          const m = /^\/translations\/([^/]+)\/([a-z_]+)/.exec(fe.path);
          mapped[m ? `${m[2]}.${m[1]}` : "item"] = fe.code === "limit_exceeded" ? t("full") : translateFieldError(tErr as never, fe);
        }
        setServerProblems(mapped);
      } else toastError(error, t("failed"));
    } finally {
      setSaving(false);
    }
  };

  const shown = submitted ? problems : Object.fromEntries(Object.entries(problems).filter(([k]) => k in serverProblems));
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <EditorLocaleSwitcher locales={locales} value={locale} onChange={setLocale} completeness={completeness} />
      <FaqRowFields
        idPrefix="faq-add"
        locale={locale}
        localeName={localeName}
        row={draft.rows[locale]}
        disabled={saving}
        problems={shown}
        onChange={(row: FaqRowDraft) => {
          setServerProblems({});
          setDraft({ rows: { ...draft.rows, [locale]: row } });
        }}
      />
      {serverProblems.item ? <p role="alert" className="text-sm text-destructive">{serverProblems.item}</p> : null}
      <div className="flex items-center gap-2">
        <Switch id="faq-add-visible" checked={visible} onCheckedChange={setVisible} />
        <Label htmlFor="faq-add-visible" className="font-normal">{t("visible")}</Label>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner /> : <PlusIcon />}
          {t("submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
