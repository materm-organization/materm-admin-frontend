"use client";

import { LockIcon, RotateCcwIcon, SaveIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { ConflictDialog } from "@/components/global/conflict-dialog";
import { RevisionsTab, type RestoredRevision } from "@/components/global/revisions/revisions-tab";
import { AdvancedJson } from "@/components/protected/collections/advanced-json";
import {
  buildDefinitionPatch,
  builderView,
  draftFromCollection,
  isDirty,
  schemaDocs,
  schemaProblems,
  textsOf,
  validateSettings,
  type DefinitionDraft,
  type DefinitionSettings,
  type SchemaTexts,
} from "@/components/protected/collections/definition-draft";
import { EntityActivity } from "@/components/protected/collections/entity-activity";
import { FieldBuilder } from "@/components/protected/collections/field-builder";
import { SchemaBreaksDialog, type SchemaChangeRefusal } from "@/components/protected/collections/schema-breaks-dialog";
import { SchemaErrorList } from "@/components/protected/collections/schema-error-list";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useMutationDeleteCollection, useMutationRestoreCollection, useMutationUpdateCollection, writeThroughCollection } from "@/hooks/use-collections";
import { useCan } from "@/hooks/use-permission";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { MAX_COLLECTION_DESCRIPTION, MAX_COLLECTION_NAME } from "@/lib/collections/constants";
import { isSchemaError, fieldsWithErrors } from "@/lib/collections/schema-errors";
import { titleFieldOptions, type BuilderField } from "@/lib/collections/schema-builder";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { ApiFieldError } from "@/types/api";
import type { Collection, SchemaBreaksEntriesDetails } from "@/types/collections";
import { useQueryClient } from "@tanstack/react-query";

const TABS = ["details", "fields", "advanced", "revisions", "activity"] as const;
type Tab = (typeof TABS)[number];

// SCR-40 definition editor (doc/07 3.25, 05 17): Details (name, key, description, icon, switches, title field), Fields (the guided builder),
// Advanced JSON, Versions and Activity. One draft saved with ONE PATCH that carries only what changed. `manage_schema` edits; anyone with `read`
// sees the same screen read only. A schema change the server refuses because entries would no longer pass opens `SchemaBreaksDialog`.
export function DefinitionEditor({ collection, etag, onReseed }: { collection: Collection; etag: string | undefined; onReseed: () => Promise<void> }) {
  const t = useTranslations("collections.editor");
  const tErr = useTranslations("errors");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const { toastError } = useApiErrorHandler();
  const canEdit = useCan(PERMISSION_KEYS.CMS_COLLECTIONS, PERMISSION_ACTIONS.MANAGE_SCHEMA);
  const trashed = Boolean(collection.deleted_at);
  const editable = canEdit && !trashed;
  const ids = { name: useId(), description: useId(), icon: useId(), sort: useId(), title: useId() };

  const tabParam = search.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "fields";
  const setTab = (next: string) => {
    const params = new URLSearchParams(search.toString());
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const baseline = useMemo(() => draftFromCollection(collection), [collection]);
  // `null` = untouched: the baseline is derived from the definition in the cache, so a saved one re-bases itself.
  const [edit, setEdit] = useState<DefinitionDraft | null>(null);
  const draft = edit ?? baseline;
  const dirty = edit !== null && isDirty(collection, edit);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<ApiFieldError[]>([]);
  const [refusal, setRefusal] = useState<SchemaChangeRefusal | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [hasEntries, setHasEntries] = useState<number | null>(null);

  const update = useUpdateDefinition(collection.key);
  const deleteMutation = useMutationDeleteCollection();
  const restoreMutation = useMutationRestoreCollection();

  const view = useMemo(() => builderView(draft.schema), [draft.schema]);
  const settingsProblems = useMemo(() => validateSettings(draft.settings), [draft.settings]);
  const schemaProblemList = useMemo(() => schemaProblems(draft.schema), [draft.schema]);
  const fieldErrorNames = useMemo(() => fieldsWithErrors(serverErrors), [serverErrors]);
  const settingError = (key: string) => {
    const p = settingsProblems.find((x) => x.key === key);
    const server = serverErrors.find((e) => e.path === `/${key}`);
    if (server) return translateFieldError(tErr as never, server);
    return submitted && p ? t(`problems.${p.key}.${p.code}`, (p.params ?? {}) as Record<string, number>) : null;
  };

  const setSettings = (patch: Partial<DefinitionSettings>) => {
    setEdit({ ...draft, settings: { ...draft.settings, ...patch } });
    setServerErrors((list) => list.filter((e) => !Object.keys(patch).some((k) => e.path === `/${k}`)));
  };
  const setFields = (fields: BuilderField[]) => {
    setEdit({ ...draft, schema: { source: "builder", fields } });
    setServerErrors((list) => list.filter((e) => !isSchemaError(e)));
  };
  const setText = (key: keyof SchemaTexts, value: string) => {
    const current = draft.schema.source === "json" ? draft.schema.texts : textsOf(schemaDocsOrEmpty(draft));
    setEdit({ ...draft, schema: { source: "json", texts: { ...current, [key]: value } } });
    setServerErrors((list) => list.filter((e) => !isSchemaError(e)));
  };

  const save = useCallback(async (): Promise<boolean> => {
    if (!edit || !editable) return true;
    setSubmitted(true);
    if (settingsProblems.length > 0 || schemaProblemList.length > 0) {
      toast.error(t("fixFirst"));
      if (settingsProblems.length > 0) setTab("details");
      return false;
    }
    const patch = buildDefinitionPatch(collection, edit);
    if (!patch) {
      setEdit(null);
      return true;
    }
    const sent = edit;
    try {
      await update.mutateAsync({ payload: patch, etag });
      // Keep what was typed while the save was in flight; the baseline re-bases itself on the saved copy.
      setEdit((current) => (current && JSON.stringify(current) === JSON.stringify(sent) ? null : current));
      setServerErrors([]);
      setSubmitted(false);
      toast.success(t("saved"));
      return true;
    } catch (error) {
      if (isConflictError(error)) {
        setConflictOpen(true);
        return false;
      }
      const parsed = parseApiError(error);
      if (parsed.status === 409 && parsed.code === "INVALID_STATE") {
        const reason = parsed.details?.reason;
        if (reason === "schema_breaks_entries") setRefusal({ reason, details: parsed.details as unknown as SchemaBreaksEntriesDetails });
        else if (reason === "too_many_entries_to_verify") setRefusal({ reason, checked: typeof parsed.details?.checked === "number" ? parsed.details.checked : null });
        else toast.error(t("stale"));
        return false;
      }
      if (parsed.status === 422 && parsed.fieldErrors.length > 0) {
        setServerErrors(parsed.fieldErrors);
        toast.error(t("refused"));
        if (parsed.fieldErrors.some(isSchemaError)) setTab(draft.schema.source === "builder" ? "fields" : "advanced");
        else setTab("details");
      } else toastError(error, t("saveFailed"));
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, editable, settingsProblems, schemaProblemList, collection, etag, update, t, draft.schema.source]);

  useUnsavedChangesGuard(dirty && editable, { onSave: save });

  const doDelete = async () => {
    try {
      await deleteMutation.mutateAsync({ key: collection.key, etag });
      toast.success(t("deleted", { name: collection.name }));
      router.push("/admin/collections");
    } catch (error) {
      setDeleteOpen(false);
      const parsed = parseApiError(error);
      if (parsed.code === "ENTITY_REFERENCED" && parsed.details?.reason === "collection_has_entries") setHasEntries(Number(parsed.details.entry_count ?? 0));
      else if (isConflictError(error)) setConflictOpen(true);
      else toastError(error, t("deleteFailed"));
    }
  };
  const doRestore = async () => {
    try {
      const result = await restoreMutation.mutateAsync({ key: collection.key, etag });
      writeThroughCollection(queryClient, collection.key, { data: result.data.data, etag: result.etag });
      toast.success(t("restored", { name: collection.name }));
    } catch (error) {
      const parsed = parseApiError(error);
      if (parsed.code === "CONFLICT_DUPLICATE") toast.error(t("restoreDuplicate", { key: collection.key }));
      else if (isConflictError(error)) setConflictOpen(true);
      else toastError(error, t("restoreFailed"));
    }
  };
  const reload = async () => {
    setIsReloading(true);
    try {
      setEdit(null);
      await onReseed();
    } finally {
      setIsReloading(false);
    }
  };
  const onRestored = async (result: RestoredRevision) => {
    writeThroughCollection(queryClient, collection.key, { data: result.data as unknown as Collection, etag: result.etag });
    setEdit(null);
    await onReseed();
  };

  const titleOptions = view.locked ? Array.from(new Set(["title", collection.title_field])) : titleFieldOptions(view.fields);
  const docs = schemaDocs(draft.schema);
  const advancedTexts = draft.schema.source === "json" ? draft.schema.texts : textsOf(schemaDocsOrEmpty(draft));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {editable ? (
            <Button type="button" onClick={() => void save()} disabled={!dirty || update.isPending} data-testid="save-definition">
              {update.isPending ? <Spinner /> : <SaveIcon />}
              {t("save")}
            </Button>
          ) : null}
          {dirty ? <span className="text-sm text-amber-700 dark:text-amber-400">{t("unsaved")}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" asChild>
            <Link href={`/admin/collections/${encodeURIComponent(collection.key)}`}>{t("openEntries")}</Link>
          </Button>
          {canEdit && !trashed ? (
            <Button type="button" variant="outline" className="text-destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2Icon />
              {t("delete")}
            </Button>
          ) : null}
          {canEdit && trashed ? (
            <Button type="button" onClick={() => void doRestore()} disabled={restoreMutation.isPending}>
              <RotateCcwIcon />
              {t("restore")}
            </Button>
          ) : null}
        </div>
      </div>

      {trashed ? (
        <Alert>
          <AlertTitle>{t("trashedTitle")}</AlertTitle>
          <AlertDescription className="leading-snug">{t("trashedBody")}</AlertDescription>
        </Alert>
      ) : null}
      {!canEdit && !trashed ? (
        <Alert data-testid="read-only-note">
          <LockIcon />
          <AlertDescription>{t("readOnlyNote")}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          {TABS.map((x) => (
            <TabsTrigger key={x} value={x}>
              {t(`tabs.${x}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="details" className="pt-4">
          <div className="grid max-w-2xl gap-4" data-testid="definition-details">
            <div className="space-y-1.5">
              <Label htmlFor={ids.name}>{t("name")}</Label>
              <Input id={ids.name} value={draft.settings.name} maxLength={MAX_COLLECTION_NAME + 20} disabled={!editable} aria-invalid={Boolean(settingError("name"))} onChange={(e) => setSettings({ name: e.target.value })} />
              {settingError("name") ? <p role="alert" className="text-sm text-destructive">{settingError("name")}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label>{t("key")}</Label>
              <p className="font-mono text-sm" data-testid="definition-key">{collection.key}</p>
              <p className="text-xs text-muted-foreground">{t("keyHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={ids.description}>{t("description")}</Label>
              <Textarea id={ids.description} rows={3} className="leading-snug" value={draft.settings.description} disabled={!editable} aria-invalid={Boolean(settingError("description"))} onChange={(e) => setSettings({ description: e.target.value })} />
              <p className="text-right text-xs text-muted-foreground">{[...draft.settings.description].length}/{MAX_COLLECTION_DESCRIPTION}</p>
              {settingError("description") ? <p role="alert" className="text-sm text-destructive">{settingError("description")}</p> : null}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={ids.icon}>{t("icon")}</Label>
                <Input id={ids.icon} className="font-mono" spellCheck={false} value={draft.settings.icon} disabled={!editable} aria-invalid={Boolean(settingError("icon"))} onChange={(e) => setSettings({ icon: e.target.value })} />
                {settingError("icon") ? <p role="alert" className="text-sm text-destructive">{settingError("icon")}</p> : <p className="text-xs text-muted-foreground">{t("iconHint")}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={ids.sort}>{t("sortOrder")}</Label>
                <Input id={ids.sort} type="number" min={0} value={draft.settings.sort_order} disabled={!editable} aria-invalid={Boolean(settingError("sort_order"))} onChange={(e) => setSettings({ sort_order: e.target.value })} />
                {settingError("sort_order") ? <p role="alert" className="text-sm text-destructive">{settingError("sort_order")}</p> : null}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={ids.title}>{t("titleField")}</Label>
              <Select value={draft.settings.title_field} disabled={!editable} onValueChange={(v) => setSettings({ title_field: v })}>
                <SelectTrigger id={ids.title} className="w-full max-w-sm" aria-label={t("titleField")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {titleOptions.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o === "title" ? t("titleFieldDefault") : o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs leading-snug text-muted-foreground">{t("titleFieldHint")}</p>
              {serverErrors.find((e) => e.path === "/title_field") ? <p role="alert" className="text-sm text-destructive">{translateFieldError(tErr as never, serverErrors.find((e) => e.path === "/title_field")!)}</p> : null}
            </div>
            <div className="flex items-start gap-3">
              <Switch id="def-has-slug" checked={draft.settings.has_slug} disabled={!editable} onCheckedChange={(v) => setSettings({ has_slug: v })} />
              <div>
                <Label htmlFor="def-has-slug" className="font-normal">{t("hasSlug")}</Label>
                <p className="text-xs leading-snug text-muted-foreground">{t("hasSlugHint")}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Switch id="def-active" checked={draft.settings.is_active} disabled={!editable} onCheckedChange={(v) => setSettings({ is_active: v })} />
              <div>
                <Label htmlFor="def-active" className="font-normal">{t("isActive")}</Label>
                <p className="text-xs leading-snug text-muted-foreground">{t("isActiveHint")}</p>
              </div>
            </div>
            <ServerSettingsErrors errors={serverErrors} />
          </div>
        </TabsContent>

        <TabsContent value="fields" className="space-y-4 pt-4">
          <SchemaErrorList errors={serverErrors.filter(isSchemaError)} problems={submitted ? schemaProblemList : []} />
          {view.locked ? (
            <Alert data-testid="builder-locked">
              <LockIcon />
              <AlertTitle>{t("lockedTitle")}</AlertTitle>
              <AlertDescription className="leading-snug">
                {view.reason.reason === "invalid_json" ? t("lockedInvalid") : t("lockedBody", { document: view.reason.schema, path: view.reason.path || "/" })}
                <span className="mt-2 block">
                  <Button type="button" variant="outline" size="sm" onClick={() => setTab("advanced")}>{t("openAdvanced")}</Button>
                </span>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <p className="text-sm leading-snug text-muted-foreground">{t("fieldsIntro")}</p>
              <FieldBuilder fields={view.fields} onChange={setFields} disabled={!editable} serverFields={fieldErrorNames} />
            </>
          )}
        </TabsContent>

        <TabsContent value="advanced" className="space-y-4 pt-4">
          <SchemaErrorList errors={serverErrors.filter(isSchemaError)} problems={submitted ? schemaProblemList : []} />
          {!docs.ok ? <p role="alert" className="text-sm text-destructive">{docs.message}</p> : null}
          <AdvancedJson texts={advancedTexts} onChange={setText} disabled={!editable} />
        </TabsContent>

        <TabsContent value="revisions" className="pt-4">
          <RevisionsTab resource="collections" id={collection.key} canRestore={canEdit && !trashed} etag={etag} onRestored={onRestored} onRefresh={onReseed} />
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <EntityActivity entityType="cms.collection" entityId={collection.id} />
        </TabsContent>
      </Tabs>

      <SchemaBreaksDialog refusal={refusal} collectionKey={collection.key} onClose={() => setRefusal(null)} />
      <ConflictDialog open={conflictOpen} onOpenChange={setConflictOpen} onReload={reload} isReloading={isReloading} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteTitle", { name: collection.name })}
        description={t("deleteBody")}
        confirmLabel={t("deleteConfirm")}
        destructive
        isPending={deleteMutation.isPending}
        onConfirm={doDelete}
      />
      <ConfirmDialog
        open={hasEntries !== null}
        onOpenChange={(open) => !open && setHasEntries(null)}
        title={t("hasEntriesTitle")}
        description={t("hasEntriesBody", { count: hasEntries ?? 0 })}
        confirmLabel={t("openEntries")}
        onConfirm={() => router.push(`/admin/collections/${encodeURIComponent(collection.key)}`)}
      />
    </div>
  );
}

// A schema document for the draft when the builder is the source (never fails: the builder always generates).
function schemaDocsOrEmpty(draft: DefinitionDraft) {
  const docs = schemaDocs(draft.schema);
  if (docs.ok) return docs.docs as import("@/lib/collections/schema-builder").GeneratedSchemas;
  return { json_schema: {}, localized_schema: {}, ui_schema: {} } as import("@/lib/collections/schema-builder").GeneratedSchemas;
}

function useUpdateDefinition(key: string) {
  return useMutationUpdateCollection(key);
}

// Server errors on settings that have no field on the screen (`unknown_field`, `min_properties`).
function ServerSettingsErrors({ errors }: { errors: ApiFieldError[] }) {
  const tErr = useTranslations("errors");
  const known = ["/name", "/description", "/icon", "/sort_order", "/title_field"];
  const rest = errors.filter((e) => !isSchemaError(e) && !known.includes(e.path));
  if (rest.length === 0) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{rest.map((e) => `${e.path || "/"}: ${translateFieldError(tErr as never, e)}`).join(" ")}</AlertDescription>
    </Alert>
  );
}
