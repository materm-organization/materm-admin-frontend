"use client";

import { AlertTriangleIcon, LanguagesIcon, LockIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { ConflictDialog } from "@/components/global/conflict-dialog";
import { EditorLocaleSwitcher, type LocaleBadge } from "@/components/global/locale/editor-locale-switcher";
import { PublishBar, type PublishBarResult } from "@/components/global/publishing/publish-bar";
import { RevisionsTab, type RestoredRevision } from "@/components/global/revisions/revisions-tab";
import { EditorSkeleton } from "@/components/global/states/editor-skeleton";
import { EntityActivity } from "@/components/protected/collections/entity-activity";
import {
  buildEntryPatch,
  draftFromEntry,
  draftsEqual,
  emptyRow,
  pointerTarget,
  validateDraft,
  type EntryDraft,
  type EntryEditMode,
  type EntryRow,
} from "@/components/protected/collections/entry-draft";
import { SchemaForm, type SchemaFormHandle } from "@/components/schema-form/schema-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { entryQueryKey, useEntryWrites, useMutationDeleteEntry, useMutationRestoreEntry, writeThroughEntry } from "@/hooks/use-collections";
import { useLocales } from "@/hooks/use-locales";
import { useCan } from "@/hooks/use-permission";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { entryRef } from "@/lib/collections/ref";
import { MAX_ENTRY_SLUG, MAX_ENTRY_TITLE } from "@/lib/collections/constants";
import { createCollectionValidator } from "@/lib/collections/validator";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import { slugify } from "@/lib/posts";
import { entryEtag } from "@/services/collections.api";
import type { ApiFieldError } from "@/types/api";
import type { JsonSchema, UiSchemaNode } from "@/types/cms";
import type { Collection, CollectionEntryDetail } from "@/types/collections";
import type { PublishIssueTarget } from "@/types/publishing";

const TABS = ["content", "revisions", "activity"] as const;
type Tab = (typeof TABS)[number];
const hasFields = (schema: JsonSchema) => Object.keys(schema.properties ?? {}).length > 0;

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

// SCR-41 entry editor (doc/07 3.25, 05 17.7-17.10). PublishBar on top (publish with a dry run and blockers, unpublish, discard the draft, save), a
// banner when the collection's schema changed since the entry was last checked, then Content / History / Activity. Content = the shared fields
// (a SchemaForm over `json_schema`), the sort order, and one language at a time: title, address, "show this language" and a SchemaForm over
// `localized_schema`. Both forms use the hand-written checker (`createCollectionValidator`), never Ajv, so they work under the production CSP.
export function EntryEditor({ collection, entry, etag, onReseed }: { collection: Collection; entry: CollectionEntryDetail; etag: string | undefined; onReseed: (options?: { refetch?: boolean }) => Promise<void> }) {
  const t = useTranslations("collections.entries.editor");
  const tProblem = useTranslations("collections.entries.problems");
  const tErr = useTranslations("errors");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const { toastError } = useApiErrorHandler();
  const key = collection.key;
  const trashed = Boolean(entry.deleted_at);

  const canUpdate = useCan(PERMISSION_KEYS.CMS_COLLECTIONS, PERMISSION_ACTIONS.UPDATE);
  const canTranslate = useCan(PERMISSION_KEYS.CMS_COLLECTIONS, PERMISSION_ACTIONS.TRANSLATE);
  const canDelete = useCan(PERMISSION_KEYS.CMS_COLLECTIONS, PERMISSION_ACTIONS.DELETE);
  const mode: EntryEditMode = trashed ? "none" : canUpdate ? "full" : canTranslate ? "translate" : "none";

  const writes = useEntryWrites(key, entry.id);
  const deleteMutation = useMutationDeleteEntry(key);
  const restoreMutation = useMutationRestoreEntry(key);
  const localesQuery = useLocales();
  const locales = useMemo(() => (localesQuery.data?.data ?? []).filter((l) => l.is_active).sort((a, b) => a.sort_order - b.sort_order), [localesQuery.data]);
  const defaultLocale = (localesQuery.data?.data.find((l) => l.is_default) ?? locales[0])?.code ?? "";
  const ready = locales.length > 0 && defaultLocale !== "";
  const localeCodes = useMemo(() => locales.map((l) => l.code), [locales]);

  // ---- URL state: ?tab= ?locale= -----------------------------------------------------------------------------------------------
  const tabParam = search.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "content";
  const localeParam = search.get("locale");
  const locale = locales.some((l) => l.code === localeParam) ? (localeParam as string) : defaultLocale;
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

  // ---- the draft ------------------------------------------------------------------------------------------------------------------
  const baseline = useMemo(() => draftFromEntry(entry, localeCodes), [entry, localeCodes]);
  const [edit, setEdit] = useState<EntryDraft | null>(null);
  const draft = edit ?? baseline;
  const dirty = edit !== null && !draftsEqual(edit, baseline);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // 422 errors of the last save / blocker, by form; each is an array KEPT in state (a new instance = a new batch for the SchemaForm).
  const [sharedErrors, setSharedErrors] = useState<ApiFieldError[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, ApiFieldError[]>>({});
  const [fieldProblems, setFieldProblems] = useState<Record<string, string>>({});
  const sharedRef = useRef<SchemaFormHandle>(null);
  const localizedRef = useRef<SchemaFormHandle>(null);

  const ids = { sort: useId() };
  const sharedType = useMemo(() => ({ key: `collection:${key}:data`, version: collection.schema_version, json_schema: collection.json_schema, ui_schema: collection.ui_schema as UiSchemaNode, schema_hash: null }), [collection, key]);
  const localizedType = useMemo(() => ({ key: `collection:${key}:translation`, version: collection.schema_version, json_schema: collection.localized_schema, ui_schema: collection.ui_schema as UiSchemaNode, schema_hash: null }), [collection, key]);
  const sharedValidator = useMemo(() => createCollectionValidator(collection.json_schema), [collection.json_schema]);
  const localizedValidator = useMemo(() => createCollectionValidator(collection.localized_schema), [collection.localized_schema]);
  const sharedFields = hasFields(collection.json_schema);
  const localizedFields = hasFields(collection.localized_schema);

  const clientProblems = useMemo(() => (ready ? validateDraft(draft, defaultLocale, collection.has_slug) : {}), [draft, defaultLocale, collection.has_slug, ready]);
  const problemText = (field: string): string | null => {
    const server = fieldProblems[field];
    if (server) return server;
    const code = clientProblems[field];
    return submitted && code ? tProblem(code, { max: field.startsWith("title") ? MAX_ENTRY_TITLE : field.startsWith("slug") ? MAX_ENTRY_SLUG : 1_000_000 }) : null;
  };

  const onChange = (next: EntryDraft) => {
    setEdit(next);
    setFieldProblems({});
  };
  const setRow = (code: string, patch: Partial<EntryRow>) => onChange({ ...draft, rows: { ...draft.rows, [code]: { ...(draft.rows[code] ?? emptyRow()), ...patch } } });

  // Sends the 422 errors to the form / field they belong to and moves the user to the first one.
  const routeServerErrors = (errors: ApiFieldError[]) => {
    const shared: ApiFieldError[] = [];
    const rows: Record<string, ApiFieldError[]> = {};
    const fields: Record<string, string> = {};
    let firstLocale: string | null = null;
    for (const e of errors) {
      const target = pointerTarget(e.path);
      if (target.kind === "shared") shared.push(e);
      else if (target.kind === "localized") {
        (rows[target.locale] ??= []).push(e);
        firstLocale ??= target.locale;
      } else if (target.kind === "row") {
        const text = e.code === "duplicate" ? tProblem("slugTaken") : translateFieldError(tErr as never, e);
        fields[`${target.field}.${target.locale}`] = text;
        firstLocale ??= target.locale;
      } else if (target.kind === "sort_order") fields.sort_order = translateFieldError(tErr as never, e);
      else fields.other = [fields.other, translateFieldError(tErr as never, e)].filter(Boolean).join(" ");
    }
    setSharedErrors(shared);
    setRowErrors(rows);
    setFieldProblems(fields);
    if (firstLocale && localeCodes.includes(firstLocale)) setParams({ tab: null, locale: firstLocale === defaultLocale ? null : firstLocale });
  };

  const save = useCallback(async (): Promise<boolean> => {
    if (!edit || mode === "none" || draftsEqual(edit, baseline)) return true;
    setSubmitted(true);
    const badKey = Object.keys(clientProblems)[0];
    if (badKey) {
      toast.error(t("fixFirst"));
      const code = badKey.split(".")[1];
      if (code && localeCodes.includes(code)) setParams({ tab: null, locale: code === defaultLocale ? null : code });
      return false;
    }
    const patch = buildEntryPatch(baseline, edit, mode);
    if (!patch) {
      setEdit(null);
      return true;
    }
    const sent = edit;
    setSaving(true);
    try {
      await writes.update(patch);
      setEdit((current) => (current && draftsEqual(current, sent) ? null : current));
      setSharedErrors([]);
      setRowErrors({});
      setFieldProblems({});
      return true;
    } catch (error) {
      if (isConflictError(error)) {
        setConflictOpen(true);
        return false;
      }
      const parsed = parseApiError(error);
      if ((parsed.status === 422 || parsed.status === 409) && parsed.fieldErrors.length > 0) {
        routeServerErrors(parsed.fieldErrors);
        toast.error(t("saveRefused"));
      } else toastError(error, t("saveFailed"));
      return false;
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline, clientProblems, defaultLocale, edit, localeCodes, mode, t, writes]);

  useUnsavedChangesGuard(dirty && mode !== "none", { onSave: save });

  // ---- PublishBar -----------------------------------------------------------------------------------------------------------------
  const flush = async () => (dirty ? save() : true);
  const onResult = async (result: PublishBarResult) => {
    writeThroughEntry(queryClient, key, entry.id, { data: result.data as Partial<CollectionEntryDetail>, etag: result.etag });
    if (result.action === "discard") await onReseed({ refetch: true });
  };
  const onRestored = async (result: RestoredRevision) => {
    writeThroughEntry(queryClient, key, entry.id, { data: result.data as Partial<CollectionEntryDetail>, etag: result.etag });
    await onReseed({ refetch: true });
  };
  const reload = async () => {
    setIsReloading(true);
    try {
      await onReseed({ refetch: true });
    } finally {
      setIsReloading(false);
    }
  };

  // "Go to field" of a publish blocker: the shared form / the language form get the blocker as a server error (they focus it), a title or an
  // address is focused by id.
  const goToField = (target: PublishIssueTarget) => {
    const where = pointerTarget(target.pointer);
    const fake: ApiFieldError = { in: "body", path: target.pointer, code: target.code ?? "invalid" };
    setParams({ tab: null });
    if (where.kind === "shared") setSharedErrors([fake]);
    else if (where.kind === "localized") {
      setParams({ tab: null, locale: where.locale === defaultLocale ? null : where.locale });
      setRowErrors({ [where.locale]: [fake] });
    } else if (where.kind === "row") {
      setParams({ tab: null, locale: where.locale === defaultLocale ? null : where.locale });
      focusWhenPresent(where.field === "slug" ? `entry-field-slug-${where.locale}` : `entry-field-title-${where.locale}`);
    } else if (where.kind === "sort_order") focusWhenPresent(ids.sort);
  };

  const doDelete = async () => {
    try {
      await deleteMutation.mutateAsync({ id: entry.id, etag });
      toast.success(t("deleted"));
      router.push(`/admin/collections/${encodeURIComponent(key)}`);
    } catch (error) {
      setDeleteOpen(false);
      if (isConflictError(error)) setConflictOpen(true);
      else toastError(error, t("deleteFailed"));
    }
  };
  const doRestore = async () => {
    try {
      const result = await restoreMutation.mutateAsync({ id: entry.id, etag });
      writeThroughEntry(queryClient, key, entry.id, { data: result.data.data, etag: result.etag });
      await queryClient.invalidateQueries({ queryKey: entryQueryKey(key, entry.id) });
      await onReseed({ refetch: false });
      toast.success(t("restored"));
    } catch (error) {
      const parsed = parseApiError(error);
      if (parsed.code === "CONFLICT_DUPLICATE") toast.error(t("restoreDuplicate"));
      else if (parsed.status === 422) toast.error(t("restoreInvalid", { path: parsed.fieldErrors[0]?.path || "/" }));
      else if (isConflictError(error)) setConflictOpen(true);
      else toastError(error, t("restoreFailed"));
    }
  };

  const completeness = useMemo(() => {
    const out: Record<string, LocaleBadge> = {};
    for (const l of locales) {
      const row = draft.rows[l.code];
      const missing = row?.exists && row.title.trim() !== "" ? 0 : 1;
      out[l.code] = { missing, total: 1, status: missing === 0 ? "complete" : "missing" };
    }
    return out;
  }, [draft, locales]);

  const row = draft.rows[locale] ?? emptyRow();
  const baseRow = baseline.rows[locale] ?? emptyRow();
  const localeName = locales.find((l) => l.code === locale)?.native_name ?? locale;
  const rowEditable = mode === "full" || (mode === "translate" && baseRow.exists);
  const sharedEditable = mode === "full";
  const titleProblem = problemText(`title.${locale}`);
  const slugProblem = problemText(`slug.${locale}`);

  return (
    <div className="space-y-4">
      <PublishBar
        resource="collection-entries"
        entity={{ id: entryRef(key, entry.id), status: entry.status, has_unpublished_changes: entry.has_unpublished_changes, deleted_at: entry.deleted_at }}
        etag={etag}
        isDirty={dirty}
        flush={flush}
        onSaveDraft={mode !== "none" ? save : undefined}
        isSaving={saving}
        onResult={onResult}
        onRefresh={() => onReseed({ refetch: true })}
        onGoToField={goToField}
      />

      {entry.schema_stale && !trashed ? (
        <Alert data-testid="schema-stale-banner">
          <AlertTriangleIcon />
          <AlertTitle>{t("staleTitle")}</AlertTitle>
          <AlertDescription className="leading-snug">{t("staleBody", { entry: entry.schema_version, current: collection.schema_version })}</AlertDescription>
        </Alert>
      ) : null}
      {mode === "translate" ? (
        <Alert data-testid="translate-mode-note">
          <LanguagesIcon />
          <AlertDescription>{t("translateNote")}</AlertDescription>
        </Alert>
      ) : null}
      {mode === "none" && !trashed ? (
        <Alert data-testid="read-only-note">
          <LockIcon />
          <AlertDescription>{t("readOnlyNote")}</AlertDescription>
        </Alert>
      ) : null}
      {entry.missing_locales.length > 0 && !trashed ? (
        <p className="text-sm leading-snug text-muted-foreground" data-testid="missing-locales">{t("missingLocales", { languages: entry.missing_locales.map((c) => c.toUpperCase()).join(", ") })}</p>
      ) : null}
      {fieldProblems.other ? <Alert variant="destructive"><AlertDescription>{fieldProblems.other}</AlertDescription></Alert> : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {trashed && canDelete ? (
          <Button type="button" onClick={() => void doRestore()} disabled={restoreMutation.isPending}>
            {restoreMutation.isPending ? <Spinner /> : <RotateCcwIcon />}
            {t("restore")}
          </Button>
        ) : null}
        {!trashed && canDelete ? (
          <Button type="button" variant="outline" className="text-destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2Icon />
            {t("delete")}
          </Button>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value === "content" ? null : value })}>
        <TabsList>
          <TabsTrigger value="content">{t("tabs.content")}</TabsTrigger>
          <TabsTrigger value="revisions">{t("tabs.revisions")}</TabsTrigger>
          <TabsTrigger value="activity">{t("tabs.activity")}</TabsTrigger>
        </TabsList>

        <TabsContent value="content" className="space-y-8 pt-4">
          {!ready ? (
            <EditorSkeleton />
          ) : (
            <>
              <section className="space-y-4" aria-labelledby="entry-shared-heading">
                <h2 id="entry-shared-heading" className="text-lg font-semibold">{t("sharedHeading")}</h2>
                <div className="grid max-w-xs gap-1.5">
                  <Label htmlFor={ids.sort}>{t("sortOrder")}</Label>
                  <Input id={ids.sort} type="number" min={0} value={draft.sort_order} disabled={!sharedEditable} aria-invalid={Boolean(problemText("sort_order"))} onChange={(e) => onChange({ ...draft, sort_order: e.target.value })} />
                  {problemText("sort_order") ? <p role="alert" className="text-sm text-destructive">{problemText("sort_order")}</p> : <p className="text-xs leading-snug text-muted-foreground">{t("sortOrderHint")}</p>}
                </div>
                {sharedFields ? (
                  <div data-testid="shared-form">
                    <SchemaForm
                      ref={sharedRef}
                      sectionType={sharedType}
                      value={draft.data}
                      onChange={(data) => onChange({ ...draft, data })}
                      locales={locales}
                      mode="draft"
                      serverErrors={sharedErrors}
                      serverErrorPrefix="/data"
                      disabled={!sharedEditable}
                      validator={sharedValidator}
                      showLocaleSwitcher={false}
                      validationDelayMs={150}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("noSharedFields")}</p>
                )}
              </section>

              <section className="space-y-4" aria-labelledby="entry-lang-heading">
                <h2 id="entry-lang-heading" className="text-lg font-semibold">{t("languageHeading")}</h2>
                <EditorLocaleSwitcher locales={locales} value={locale} onChange={(code) => setParams({ locale: code === defaultLocale ? null : code })} completeness={completeness} />
                {!row.exists ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-4" data-testid="language-missing">
                    <p className="text-sm leading-snug text-muted-foreground">{mode === "full" ? t("languageMissing", { language: localeName }) : t("newLanguageNeedsUpdate", { language: localeName })}</p>
                    {mode === "full" ? (
                      <Button type="button" variant="outline" onClick={() => setRow(locale, { exists: true })}>
                        <PlusIcon />
                        {t("addLanguage", { language: localeName })}
                      </Button>
                    ) : null}
                    {titleProblem ? <p role="alert" className="w-full text-sm text-destructive">{titleProblem}</p> : null}
                  </div>
                ) : (
                  <div className="space-y-4" data-testid="language-form">
                    <div className="grid max-w-2xl gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor={`entry-field-title-${locale}`}>{t("titleLabel", { language: localeName })}</Label>
                        <Input
                          id={`entry-field-title-${locale}`}
                          lang={locale}
                          autoComplete="off"
                          value={row.title}
                          disabled={!rowEditable}
                          aria-invalid={titleProblem ? true : undefined}
                          onChange={(e) => {
                            const title = e.target.value;
                            // The address follows the title until somebody typed their own (Latin titles only: all-Lao gives "").
                            const follows = collection.has_slug && row.slug === slugify(row.title);
                            setRow(locale, { title, ...(follows ? { slug: slugify(title) } : {}) });
                          }}
                        />
                        <p className="flex justify-between text-xs text-muted-foreground">
                          <span>{titleProblem ? <span role="alert" className="text-destructive">{titleProblem}</span> : null}</span>
                          <span>{[...row.title].length}/{MAX_ENTRY_TITLE}</span>
                        </p>
                      </div>
                      {collection.has_slug ? (
                        <div className="space-y-1.5">
                          <Label htmlFor={`entry-field-slug-${locale}`}>{t("slugLabel", { language: localeName })}</Label>
                          <Input
                            id={`entry-field-slug-${locale}`}
                            className="font-mono"
                            spellCheck={false}
                            autoComplete="off"
                            value={row.slug}
                            disabled={!rowEditable}
                            aria-invalid={slugProblem ? true : undefined}
                            onChange={(e) => setRow(locale, { slug: e.target.value })}
                          />
                          {slugProblem ? <p role="alert" className="text-sm text-destructive">{slugProblem}</p> : <p className="text-xs leading-snug text-muted-foreground">{t("slugHint")}</p>}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Switch id={`entry-enabled-${locale}`} checked={row.is_enabled} disabled={mode !== "full"} onCheckedChange={(v) => setRow(locale, { is_enabled: v })} />
                          <Label htmlFor={`entry-enabled-${locale}`} className="font-normal">{t("enabled", { language: localeName })}</Label>
                        </div>
                        {mode === "full" && locale !== defaultLocale ? (
                          <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setRow(locale, { ...emptyRow() })}>
                            <Trash2Icon />
                            {t("removeLanguage", { language: localeName })}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {localizedFields ? (
                      <div data-testid="localized-form" key={locale}>
                        <SchemaForm
                          ref={localizedRef}
                          sectionType={localizedType}
                          value={row.data}
                          onChange={(data) => setRow(locale, { data })}
                          locales={locales}
                          mode="draft"
                          serverErrors={rowErrors[locale]}
                          serverErrorPrefix={`/translations/${locale}/data`}
                          disabled={!rowEditable}
                          validator={localizedValidator}
                          showLocaleSwitcher={false}
                          validationDelayMs={150}
                        />
                      </div>
                    ) : null}
                  </div>
                )}
              </section>
            </>
          )}
        </TabsContent>

        <TabsContent value="revisions" className="pt-4">
          <RevisionsTab resource="collection-entries" id={entryRef(key, entry.id)} canRestore={canUpdate && !trashed} etag={etag} onRestored={onRestored} onRefresh={() => onReseed({ refetch: true })} />
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <EntityActivity entityType="cms.collection_entry" entityId={entry.id} />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteTitle", { title: entry.title ?? `#${entry.id}` })}
        description={<><span>{t("deleteBody")}</span>{entry.status === "published" ? <span className="mt-2 block">{t("deletePublishedNote")}</span> : null}</>}
        confirmLabel={t("deleteConfirm")}
        destructive
        isPending={deleteMutation.isPending}
        onConfirm={doDelete}
      />
      <ConflictDialog open={conflictOpen} onOpenChange={setConflictOpen} onReload={reload} isReloading={isReloading} />
    </div>
  );
}

// Used by tests and the host to compare an entry's ETag with the cached one.
export { entryEtag };
