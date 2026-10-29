"use client";

import { LanguagesIcon, LockIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ConflictDialog } from "@/components/global/conflict-dialog";
import { PublishBar, type PublishBarResult } from "@/components/global/publishing/publish-bar";
import { RevisionsTab, type RestoredRevision } from "@/components/global/revisions/revisions-tab";
import { EditorSkeleton } from "@/components/global/states/editor-skeleton";
import { FormFieldsTab } from "@/components/protected/forms/form-fields-tab";
import {
  buildFormPatch,
  draftFromForm,
  draftsEqual,
  formPointerTarget,
  problemKeyOf,
  problemTab,
  validateDraft,
  type FormDraft,
  type FormEditMode,
  type FormProblemCode,
} from "@/components/protected/forms/form-draft";
import { FormRecipientsTab } from "@/components/protected/forms/form-recipients-tab";
import { FormSettingsTab } from "@/components/protected/forms/form-settings-tab";
import type { FormTabProps } from "@/components/protected/forms/form-tab-props";
import { FormTextsTab } from "@/components/protected/forms/form-texts-tab";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useFormWrites, writeThroughForm } from "@/hooks/use-forms";
import { useLocales } from "@/hooks/use-locales";
import { useCan } from "@/hooks/use-permission";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { FormDetail } from "@/types/forms";
import type { PublishIssueTarget } from "@/types/publishing";

const TABS = ["texts", "fields", "recipients", "settings", "history"] as const;
type Tab = (typeof TABS)[number];

function focusWhenPresent(id: string, tries = 20) {
  const attempt = (left: number) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView?.({ block: "center" });
      el.focus({ preventScroll: true });
      return;
    }
    if (left > 0) requestAnimationFrame(() => attempt(left - 1));
  };
  requestAnimationFrame(() => attempt(tries));
}

export type FormEditorProps = {
  form: FormDetail;
  etag: string | undefined;
  // Reads the server's version again and re-seeds every form from it (after a conflict, a discard, a restore).
  onReseed: (options?: { refetchForm?: boolean }) => Promise<void>;
};

// SCR-31 (doc/07 section 3.19): the form editor. PublishBar on top (the texts and settings are a DRAFT that goes live when published),
// then the tabs Texts, Fields, Recipients (NOT part of the draft: they apply at once), Settings and History. The texts, field texts
// and settings are ONE `FormDraft` held here, so a tab switch loses nothing and `PublishBar` sees the real `isDirty` / `flush`.
export function FormEditor({ form, etag, onReseed }: FormEditorProps) {
  const t = useTranslations("forms.editor");
  const tProblem = useTranslations("forms.problems");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const { toastError } = useApiErrorHandler();
  const formId = form.id;

  // ---- rights (05 13.6): `update` = everything; `translate` = the texts and labels in every language (the default too) ----------
  const canUpdate = useCan(PERMISSION_KEYS.FORMS_MANAGE, PERMISSION_ACTIONS.UPDATE);
  const canTranslate = useCan(PERMISSION_KEYS.FORMS_MANAGE, PERMISSION_ACTIONS.TRANSLATE);
  const mode: FormEditMode = canUpdate ? "full" : canTranslate ? "translate" : "none";

  const writes = useFormWrites(formId);
  const localesQuery = useLocales();
  const locales = useMemo(() => (localesQuery.data?.data ?? []).filter((l) => l.is_active).sort((a, b) => a.sort_order - b.sort_order), [localesQuery.data]);
  const defaultLocale = (localesQuery.data?.data.find((l) => l.is_default) ?? locales[0])?.code ?? "";
  const ready = locales.length > 0 && defaultLocale !== "";

  // ---- URL state: ?tab=  ?locale=  (+ ?field= from "Go to field") ---------------------------------------------------------------
  const tabParam = search.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "texts";
  const localeParam = search.get("locale");
  const locale = locales.some((l) => l.code === localeParam) ? (localeParam as string) : defaultLocale;
  const fieldParam = search.get("field");

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(search.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, search]
  );

  // ---- the draft ---------------------------------------------------------------------------------------------------------------
  const localeCodes = useMemo(() => locales.map((l) => l.code), [locales]);
  const baseline = useMemo(() => draftFromForm(form, localeCodes), [form, localeCodes]);
  // `null` = untouched: the baseline is derived from the form in the cache, so a saved form re-bases itself.
  const [edit, setEdit] = useState<FormDraft | null>(null);
  const draft = edit ?? baseline;
  const dirty = edit !== null && !draftsEqual(edit, baseline);
  const [serverProblems, setServerProblems] = useState<Record<string, string>>({});
  const fieldKeys = useMemo(() => form.fields.map((f) => f.key), [form.fields]);

  const clientProblems = useMemo(
    () => (defaultLocale && mode !== "none" ? validateDraft(draft, { defaultLocale, fieldKeys, mode, baseline }) : {}),
    [draft, baseline, defaultLocale, fieldKeys, mode]
  );
  const problems = useMemo(() => {
    const messages: Record<string, string> = { ...serverProblems };
    for (const [key, code] of Object.entries(clientProblems as Record<string, FormProblemCode>)) messages[key] = tProblem(code);
    return messages;
  }, [clientProblems, serverProblems, tProblem]);

  const [saving, setSaving] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [recipientsConflict, setRecipientsConflict] = useState(false);
  const [isReloading, setIsReloading] = useState(false);

  const onChange = (next: FormDraft) => {
    setEdit(next);
    setServerProblems({});
  };

  // One save: the PATCH of what changed. A published form keeps the live copy and holds the edit as a draft (PublishBar publishes it).
  const save = useCallback(async (): Promise<boolean> => {
    if (!edit || mode === "none" || draftsEqual(edit, baseline)) return true;
    const keys = Object.keys(clientProblems);
    if (keys.length > 0) {
      toast.error(t("fixFirst"));
      const where = problemTab(keys[0]);
      setParams({ tab: where.tab === "texts" ? null : where.tab, ...(where.locale && localeCodes.includes(where.locale) ? { locale: where.locale } : {}) });
      return false;
    }
    const patch = buildFormPatch(baseline, edit, defaultLocale, mode);
    const sent = edit;
    setSaving(true);
    try {
      if (patch) await writes.updateForm(patch);
      // Edits typed while it was being saved stay; what was sent is now the baseline (the form in the cache).
      setEdit((current) => (current && draftsEqual(current, sent) ? null : current));
      setServerProblems({});
      return true;
    } catch (error) {
      if (isConflictError(error)) {
        setConflictOpen(true);
        return false;
      }
      const parsed = parseApiError(error);
      if ((parsed.status === 422 || parsed.status === 409) && parsed.fieldErrors.length > 0) {
        const mapped: Record<string, string> = {};
        for (const fe of parsed.fieldErrors) mapped[problemKeyOf(fe.path, sent)] = translateFieldError(tErrors as never, fe);
        setServerProblems(mapped);
        toast.error(t("saveRefused"));
        const where = problemTab(problemKeyOf(parsed.fieldErrors[0].path, sent));
        setParams({ tab: where.tab === "texts" ? null : where.tab, ...(where.locale && localeCodes.includes(where.locale) ? { locale: where.locale } : {}) });
      } else {
        toastError(error, t("saveFailed"));
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [baseline, clientProblems, defaultLocale, edit, localeCodes, mode, setParams, t, tErrors, toastError, writes]);

  useUnsavedChangesGuard(dirty && mode !== "none", { onSave: save });

  // ---- "Go to field" -----------------------------------------------------------------------------------------------------------
  const handledField = useRef<string | null>(null);
  const goToField = (target: PublishIssueTarget) => {
    const where = formPointerTarget(target.pointer);
    setParams({ field: target.pointer, tab: where.tab === "texts" ? null : where.tab, locale: where.locale ?? target.locale ?? search.get("locale") });
  };
  useEffect(() => {
    if (!fieldParam) {
      handledField.current = null;
      return;
    }
    if (handledField.current === fieldParam || !ready) return;
    handledField.current = fieldParam;
    setParams({ field: null });
    const id = formPointerTarget(fieldParam).id;
    if (id) focusWhenPresent(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldParam, ready]);

  // ---- PublishBar ----------------------------------------------------------------------------------------------------------------
  const flush = async () => (dirty ? save() : true);
  const onResult = async (result: PublishBarResult) => {
    writeThroughForm(queryClient, formId, { data: result.data as Partial<FormDetail>, etag: result.etag });
    // A discard changes the texts themselves: start the forms over from the server's version.
    if (result.action === "discard") await onReseed({ refetchForm: false });
  };
  const onRestored = async (result: RestoredRevision) => {
    writeThroughForm(queryClient, formId, { data: result.data, etag: result.etag });
    await onReseed({ refetchForm: false });
  };
  const reload = async () => {
    setIsReloading(true);
    try {
      await onReseed({ refetchForm: true });
      setRecipientsConflict(false);
    } finally {
      setIsReloading(false);
    }
  };

  const tabProps: FormTabProps = { form, draft, baseline, onChange, problems, locales, defaultLocale, mode };
  const onLocaleChange = (code: string) => setParams({ locale: code === defaultLocale ? null : code });
  const tabIssues = (name: Tab) => Object.keys(problems).filter((k) => problemTab(k).tab === name).length;

  return (
    <div className="space-y-4">
      <PublishBar
        resource="forms"
        entity={{ id: form.id, status: form.status, has_unpublished_changes: form.has_unpublished_changes }}
        etag={etag}
        isDirty={dirty}
        flush={flush}
        onSaveDraft={mode !== "none" ? save : undefined}
        isSaving={saving}
        onResult={onResult}
        onRefresh={() => onReseed({ refetchForm: true })}
        onGoToField={goToField}
      />

      {mode === "translate" ? (
        <Alert data-testid="translate-mode-note">
          <LanguagesIcon />
          <AlertDescription>{t("translateNote")}</AlertDescription>
        </Alert>
      ) : null}
      {mode === "none" ? (
        <Alert data-testid="read-only-note">
          <LockIcon />
          <AlertDescription>{t("readOnlyNote")}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value === "texts" ? null : value })}>
        <TabsList className="h-auto flex-wrap justify-start">
          {TABS.map((name) => (
            <TabsTrigger key={name} value={name}>
              {t(`tabs.${name}`)}
              {tabIssues(name) > 0 ? <span className="ms-1.5 rounded bg-destructive px-1.5 text-[10px] text-destructive-foreground" aria-label={t("tabProblems", { count: tabIssues(name) })}>{tabIssues(name)}</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="texts" className="pt-4">
          {ready ? <FormTextsTab {...tabProps} locale={locale} onLocaleChange={onLocaleChange} /> : <EditorSkeleton />}
        </TabsContent>
        <TabsContent value="fields" className="pt-4">
          {ready ? <FormFieldsTab {...tabProps} locale={locale} onLocaleChange={onLocaleChange} /> : <EditorSkeleton />}
        </TabsContent>
        {/* Kept mounted: the rows hold edits that are NOT in the draft and must survive a tab switch. */}
        <TabsContent value="recipients" forceMount className="pt-4 data-[state=inactive]:hidden">
          <FormRecipientsTab form={form} canEdit={canUpdate} save={writes.replaceRecipients} onConflict={() => setRecipientsConflict(true)} />
        </TabsContent>
        <TabsContent value="settings" className="pt-4">
          {ready ? <FormSettingsTab {...tabProps} /> : <EditorSkeleton />}
        </TabsContent>
        <TabsContent value="history" className="pt-4">
          <RevisionsTab resource="forms" id={formId} canRestore={canUpdate} etag={etag} onRestored={onRestored} onRefresh={() => onReseed({ refetchForm: true })} />
        </TabsContent>
      </Tabs>

      <ConflictDialog open={conflictOpen} onOpenChange={setConflictOpen} onReload={reload} isReloading={isReloading} />
      <ConflictDialog open={recipientsConflict} onOpenChange={setRecipientsConflict} onReload={reload} isReloading={isReloading} />
    </div>
  );
}
