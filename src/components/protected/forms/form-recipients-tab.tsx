"use client";

import { InfoIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { hasProblems, newRow, rowsEqual, rowsFromRecipients, toPayload, validateRows, type RecipientRow } from "@/components/protected/forms/recipients-draft";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { MAX_RECIPIENTS, RECIPIENT_KINDS } from "@/lib/forms";
import type { FormDetail, ReplaceRecipientsPayload, RecipientsResult } from "@/types/forms";

const ALL = "__all__";

// The Recipients tab (doc/07 3.19, 05 13.6.4): who gets an e-mail for a new message. The WHOLE set is saved at once with its own
// validator (`recipients_etag`); it takes effect at once and does not wait for a publish. A published form (or one that does not
// keep its messages) must keep an active "To" recipient that gets every topic (BR-34). The state is local to this tab, so the
// editor keeps the tab mounted while another is shown.
export function FormRecipientsTab({
  form,
  canEdit,
  save,
  onConflict,
}: {
  form: FormDetail;
  canEdit: boolean;
  save: (payload: ReplaceRecipientsPayload) => Promise<RecipientsResult>;
  // 409 `CONFLICT_LOCK_VERSION`: somebody else changed the recipients (the editor offers to load them).
  onConflict: () => void;
}) {
  // A saved (or reloaded) set has a new validator: start again from it.
  return <RecipientsEditor key={form.recipients_etag} form={form} canEdit={canEdit} save={save} onConflict={onConflict} />;
}

function RecipientsEditor({ form, canEdit, save, onConflict }: Parameters<typeof FormRecipientsTab>[0]) {
  const t = useTranslations("forms.recipients");
  const tErrors = useTranslations("errors");
  const ui = useLocale();
  const { toastError } = useApiErrorHandler();
  const baseline = useMemo(() => rowsFromRecipients(form.recipients), [form.recipients]);
  const [rows, setRows] = useState<RecipientRow[]>(baseline);
  const [saving, setSaving] = useState(false);
  const [server, setServer] = useState<{ rows: Record<string, string>; whole?: string }>({ rows: {} });
  const needsCatchAll = form.status === "published" || !form.settings.store_submissions;
  const problems = useMemo(() => validateRows(rows, needsCatchAll), [rows, needsCatchAll]);
  const dirty = !rowsEqual(rows, baseline);
  const topicLabel = (value: string) => {
    const topic = form.topics.find((x) => x.value === value);
    return topic?.labels[ui] ?? Object.values(topic?.labels ?? {})[0] ?? value;
  };
  const edit = (id: string, patch: Partial<RecipientRow>) => {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setServer({ rows: {} });
  };

  const doSave = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (hasProblems(problems)) {
      toast.error(t("fixFirst"));
      return false;
    }
    setSaving(true);
    try {
      await save({ recipients: toPayload(rows) });
      toast.success(t("saved"));
      return true;
    } catch (error) {
      if (isConflictError(error)) {
        onConflict();
        return false;
      }
      const parsed = parseApiError(error);
      if (parsed.status === 422 && parsed.fieldErrors.length > 0) {
        const mapped: Record<string, string> = {};
        let whole: string | undefined;
        for (const fe of parsed.fieldErrors) {
          const m = /^\/recipients\/(\d+)/.exec(fe.path);
          const message = tErrors.has(`fields.${fe.code}`) ? tErrors(`fields.${fe.code}` as never, fe.params as never) : fe.message || tErrors("fields.invalid");
          if (m && rows[Number(m[1])]) mapped[rows[Number(m[1])].id] = message;
          else whole = message;
        }
        setServer({ rows: mapped, whole });
        toast.error(t("refused"));
      } else toastError(error, t("failed"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  useUnsavedChangesGuard(dirty && canEdit, { onSave: doSave });

  const rowMessage = (r: RecipientRow) => {
    const code = problems.rows[r.id];
    return code ? t(`problems.${code}`) : server.rows[r.id];
  };

  return (
    <div className="space-y-4" data-testid="form-recipients">
      <Alert>
        <InfoIcon />
        <AlertDescription>{t("immediate")}</AlertDescription>
      </Alert>
      <p className="text-sm text-muted-foreground">{t("explain")}</p>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground" data-testid="recipients-empty">
          {form.status === "published" ? t("emptyPublished") : t("empty")}
        </p>
      ) : (
        <ul className="space-y-3" data-testid="recipient-rows">
          {rows.map((r, i) => {
            const message = rowMessage(r);
            return (
              <li key={r.id} className="grid items-start gap-2 rounded-md border p-3 lg:grid-cols-[minmax(0,1fr)_7rem_14rem_auto_auto]" data-testid="recipient-row">
                <div className="space-y-1">
                  <Input
                    value={r.email}
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    disabled={!canEdit}
                    aria-label={t("email", { n: i + 1 })}
                    aria-invalid={message ? true : undefined}
                    placeholder="name@example.com"
                    onChange={(e) => edit(r.id, { email: e.target.value })}
                  />
                  {message ? <p role="alert" className="text-sm text-destructive">{message}</p> : null}
                </div>
                <Select value={r.kind} disabled={!canEdit} onValueChange={(v) => edit(r.id, { kind: v as RecipientRow["kind"] })}>
                  <SelectTrigger aria-label={t("kind", { n: i + 1 })} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RECIPIENT_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(`kinds.${k}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={r.topic_value ?? ALL} disabled={!canEdit} onValueChange={(v) => edit(r.id, { topic_value: v === ALL ? null : v })}>
                  <SelectTrigger aria-label={t("topic", { n: i + 1 })} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t("allTopics")}</SelectItem>
                    {form.topics.map((topic) => (
                      <SelectItem key={topic.value} value={topic.value}>
                        {topicLabel(topic.value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex h-9 items-center gap-2">
                  <Switch checked={r.is_active} disabled={!canEdit} aria-label={t("active", { n: i + 1 })} onCheckedChange={(v) => edit(r.id, { is_active: v })} />
                  <span className="text-sm text-muted-foreground" aria-hidden>
                    {r.is_active ? t("on") : t("off")}
                  </span>
                </div>
                {canEdit ? (
                  <Button type="button" variant="ghost" size="icon" aria-label={t("remove", { n: i + 1 })} onClick={() => setRows((current) => current.filter((x) => x.id !== r.id))}>
                    <Trash2Icon />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {problems.noCatchAll && (canEdit || rows.length > 0) ? (
        <p role="alert" className="text-sm text-destructive" data-testid="recipients-catch-all">
          {needsCatchAll && form.status === "published" ? t("needsCatchAllPublished") : t("needsCatchAll")}
        </p>
      ) : null}
      {problems.tooMany ? <p role="alert" className="text-sm text-destructive">{t("tooMany", { max: MAX_RECIPIENTS })}</p> : null}
      {server.whole ? <p role="alert" className="text-sm text-destructive">{server.whole}</p> : null}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={rows.length >= MAX_RECIPIENTS} onClick={() => setRows((current) => [...current, newRow()])}>
            <PlusIcon />
            {t("add")}
          </Button>
          <div className="ms-auto flex items-center gap-2">
            <Button type="button" variant="ghost" disabled={!dirty || saving} onClick={() => { setRows(baseline); setServer({ rows: {} }); }}>
              {t("reset")}
            </Button>
            <Button type="button" disabled={!dirty || saving} onClick={() => void doSave()}>
              {saving ? <Spinner /> : null}
              {t("save")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("readOnly")}</p>
      )}
    </div>
  );
}
