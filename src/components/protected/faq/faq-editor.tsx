"use client";

import { LanguagesIcon, LockIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { ConflictDialog } from "@/components/global/conflict-dialog";
import { PublishBar, type PublishBarResult } from "@/components/global/publishing/publish-bar";
import { RevisionsTab, type RestoredRevision } from "@/components/global/revisions/revisions-tab";
import { EditorSkeleton } from "@/components/global/states/editor-skeleton";
import { FaqAddDialog } from "@/components/protected/faq/faq-add-dialog";
import {
  buildItemPatch,
  draftFromFaqItem,
  itemDraftsEqual,
  pointerTarget,
  problemKeyOf,
  validateItemDraft,
  type FaqEditMode,
  type FaqItemDraft,
} from "@/components/protected/faq/faq-draft";
import { FaqItems } from "@/components/protected/faq/faq-items";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useFaqItems, useFaqWrites, writeThroughFaqGroup } from "@/hooks/use-faq";
import { useLocales } from "@/hooks/use-locales";
import { useCan } from "@/hooks/use-permission";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import { MAX_FAQ_NAME, charCount } from "@/lib/faq";
import type { FaqGroupDetail, FaqItem } from "@/types/faq";
import type { PublishIssueTarget } from "@/types/publishing";

const TABS = ["items", "settings", "revisions"] as const;
type Tab = (typeof TABS)[number];

export type FaqEditorProps = {
  group: FaqGroupDetail;
  etag: string | undefined;
  onReseed: (options?: { refetchGroup?: boolean }) => Promise<void>;
};

// SCR-30 (doc/07 section 3.18): the FAQ group editor. PublishBar on top, then the tabs Questions (the default), Settings (the internal name)
// and History. EVERYTHING that holds unsaved edits lives here: the name and one `FaqItemDraft` per open question, so a tab switch loses nothing and
// the bar's `isDirty` / `flush` / "Save draft" see all of it. Reorder, hide, add and delete are written at once (each with `If-Match`, one queue).
export function FaqEditor({ group, etag, onReseed }: FaqEditorProps) {
  const t = useTranslations("faq.editor");
  const tProblem = useTranslations("faq.problems");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const { toastError } = useApiErrorHandler();
  const groupId = group.id;
  const trashed = Boolean(group.deleted_at);

  // ---- rights (05 13.5.2) ----------------------------------------------------------------------------------------------------------
  const canUpdate = useCan(PERMISSION_KEYS.CMS_FAQ, PERMISSION_ACTIONS.UPDATE);
  const canTranslate = useCan(PERMISSION_KEYS.CMS_FAQ, PERMISSION_ACTIONS.TRANSLATE);
  const canCreate = useCan(PERMISSION_KEYS.CMS_FAQ, PERMISSION_ACTIONS.CREATE);
  const canDelete = useCan(PERMISSION_KEYS.CMS_FAQ, PERMISSION_ACTIONS.DELETE);
  const mode: FaqEditMode = trashed ? "none" : canUpdate ? "full" : canTranslate ? "translate" : "none";

  // ---- data ----------------------------------------------------------------------------------------------------------------------
  const writes = useFaqWrites(groupId);
  const itemsQuery = useFaqItems(groupId);
  const items = itemsQuery.data?.data.data;
  const localesQuery = useLocales();
  const locales = useMemo(() => (localesQuery.data?.data ?? []).filter((l) => l.is_active).sort((a, b) => a.sort_order - b.sort_order), [localesQuery.data]);
  const defaultLocale = (localesQuery.data?.data.find((l) => l.is_default) ?? locales[0])?.code ?? "";
  const ready = locales.length > 0 && defaultLocale !== "";
  const localeCodes = useMemo(() => locales.map((l) => l.code), [locales]);

  // ---- URL state: ?tab= ?locale= ----------------------------------------------------------------------------------------------------
  const tabParam = search.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "items";
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

  // ---- drafts: the name, one per edited question ----------------------------------------------------------------------------------
  const baselineOf = useCallback((item: FaqItem) => draftFromFaqItem(item, localeCodes), [localeCodes]);
  const [edits, setEdits] = useState<Record<number, FaqItemDraft>>({});
  const [serverProblems, setServerProblems] = useState<Record<number, Record<string, string>>>({});
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [nameServerProblem, setNameServerProblem] = useState<string | undefined>();
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [savingId, setSavingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [toDelete, setToDelete] = useState<{ item: FaqItem; position: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const name = nameEdit ?? group.name;
  const nameDirty = nameEdit !== null && nameEdit !== group.name;
  const nameProblem = nameDirty ? (nameEdit.trim() === "" ? tProblem("nameRequired") : charCount(nameEdit) > MAX_FAQ_NAME ? tProblem("too_long", { max: MAX_FAQ_NAME }) : undefined) : undefined;

  const itemOf = (id: number) => items?.find((i) => i.id === id);
  const dirtyIds = useMemo(
    () => (items ?? []).filter((i) => edits[i.id] && !itemDraftsEqual(edits[i.id], baselineOf(i))).map((i) => i.id),
    [items, edits, baselineOf]
  );
  const dirty = nameDirty || dirtyIds.length > 0;

  const clientProblemsOf = useCallback(
    (item: FaqItem) => (edits[item.id] ? validateItemDraft(edits[item.id], baselineOf(item), defaultLocale, mode) : {}),
    [edits, baselineOf, defaultLocale, mode]
  );
  const problemsOf = (id: number): Record<string, string> => {
    const item = itemOf(id);
    const out: Record<string, string> = { ...(serverProblems[id] ?? {}) };
    if (item && edits[id]) for (const [key, code] of Object.entries(clientProblemsOf(item))) out[key] = tProblem(code, { max: 200 });
    return out;
  };

  // ---- saving ---------------------------------------------------------------------------------------------------------------------------
  const clearEdit = (id: number, sent: FaqItemDraft) =>
    setEdits((all) => {
      if (!all[id] || !itemDraftsEqual(all[id], sent)) return all;
      const { [id]: _gone, ...rest } = all;
      void _gone;
      return rest;
    });

  const handleSaveError = (error: unknown, id: number | null): false => {
    if (isConflictError(error)) {
      setConflictOpen(true);
      return false;
    }
    const parsed = parseApiError(error);
    if ((parsed.status === 422 || parsed.status === 409) && parsed.fieldErrors.length > 0) {
      const mapped: Record<string, string> = {};
      for (const fe of parsed.fieldErrors) mapped[problemKeyOf(fe.path)] = translateFieldError(tErrors as never, fe);
      if (id !== null) setServerProblems((all) => ({ ...all, [id]: mapped }));
      else if (mapped.name) setNameServerProblem(mapped.name);
      toast.error(t("saveRefused"));
      const loc = /^\/translations\/([^/]+)/.exec(parsed.fieldErrors[0].path)?.[1];
      if (loc) setParams({ locale: loc });
    } else if (parsed.status === 404) {
      toast.error(t("gone"));
      void onReseed({ refetchGroup: true });
    } else toastError(error, t("saveFailed"));
    return false;
  };

  const saveItem = useCallback(
    async (item: FaqItem): Promise<boolean> => {
      const edit = edits[item.id];
      if (!edit || mode === "none") return true;
      const base = baselineOf(item);
      if (itemDraftsEqual(edit, base)) return true;
      if (Object.keys(clientProblemsOf(item)).length > 0) {
        toast.error(t("fixFirst"));
        setExpanded((s) => new Set(s).add(item.id));
        const loc = Object.keys(clientProblemsOf(item))[0].split(".")[1];
        if (loc && localeCodes.includes(loc)) setParams({ tab: null, locale: loc });
        return false;
      }
      const patch = buildItemPatch(base, edit, defaultLocale, mode);
      if (!patch) {
        clearEdit(item.id, edit);
        return true;
      }
      setSavingId(item.id);
      try {
        await writes.updateItem(item.id, patch);
        clearEdit(item.id, edit);
        setServerProblems((all) => {
          const { [item.id]: _gone, ...rest } = all;
          void _gone;
          return rest;
        });
        return true;
      } catch (error) {
        return handleSaveError(error, item.id);
      } finally {
        setSavingId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edits, mode, baselineOf, clientProblemsOf, defaultLocale, writes, localeCodes, t]
  );

  const saveName = useCallback(async (): Promise<boolean> => {
    if (!nameDirty || mode !== "full") return true;
    if (nameProblem) return false;
    try {
      await writes.updateGroup({ name: nameEdit!.trim() });
      setNameEdit(null);
      setNameServerProblem(undefined);
      return true;
    } catch (error) {
      return handleSaveError(error, null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameDirty, nameEdit, nameProblem, mode, writes]);

  // "Save draft": the name, then every edited question, one after the other (the ETag moves with each).
  const saveAll = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      if (!(await saveName())) return false;
      for (const id of dirtyIds) {
        const item = items?.find((i) => i.id === id);
        if (item && !(await saveItem(item))) return false;
      }
      return true;
    } finally {
      setSaving(false);
    }
  }, [dirtyIds, items, saveItem, saveName]);

  useUnsavedChangesGuard(dirty && mode !== "none", { onSave: saveAll });

  // ---- commands written at once ---------------------------------------------------------------------------------------------------------
  const toggleVisible = async (item: FaqItem, visible: boolean) => {
    try {
      await writes.updateItem(item.id, { is_visible: visible });
    } catch (error) {
      handleSaveError(error, null);
    }
  };
  const move = async (from: number, to: number) => {
    if (!items) return;
    const ids = items.map((i) => i.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    try {
      await writes.reorder(ids);
    } catch (error) {
      if (isConflictError(error)) setConflictOpen(true);
      else toastError(error, t("reorderFailed"));
    }
  };
  const remove = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await writes.deleteItem(toDelete.item.id);
      toast.success(t("deleted", { n: toDelete.position }));
      setEdits((all) => {
        const { [toDelete.item.id]: _gone, ...rest } = all;
        void _gone;
        return rest;
      });
      setToDelete(null);
    } catch (error) {
      setToDelete(null);
      if (isConflictError(error)) setConflictOpen(true);
      else toastError(error, t("deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  // ---- PublishBar ------------------------------------------------------------------------------------------------------------------------
  const flush = async () => (dirty ? saveAll() : true);
  const onResult = async (result: PublishBarResult) => {
    writeThroughFaqGroup(queryClient, groupId, { data: result.data as Partial<FaqGroupDetail>, etag: result.etag });
    if (result.action === "discard") await onReseed({ refetchGroup: false });
  };
  const onRestored = async (result: RestoredRevision) => {
    writeThroughFaqGroup(queryClient, groupId, { data: result.data, etag: result.etag });
    await onReseed({ refetchGroup: false });
  };
  const reload = async () => {
    setIsReloading(true);
    try {
      await onReseed({ refetchGroup: true });
    } finally {
      setIsReloading(false);
    }
  };

  // "Go to field": a blocker names a question (by public id) and a language; the question opens in that language.
  const goToField = (target: PublishIssueTarget) => {
    const where = pointerTarget(target.pointer);
    const item = items?.find((i) => i.id === target.itemId || i.public_id === where.publicId);
    setParams({ tab: null, ...(where.locale ? { locale: where.locale } : {}) });
    if (!item) return;
    setExpanded((s) => new Set(s).add(item.id));
    const id = `faq-item-${item.id}-${where.field ?? "question"}-${where.locale ?? locale}`;
    const attempt = (left: number) => {
      const el = document.getElementById(id) ?? document.getElementById(`faq-item-${item.id}-question-${where.locale ?? locale}`);
      if (el) {
        el.scrollIntoView?.({ block: "center" });
        (el.querySelector?.<HTMLElement>("[contenteditable=true]") ?? el).focus({ preventScroll: true });
      } else if (left > 0) requestAnimationFrame(() => attempt(left - 1));
    };
    requestAnimationFrame(() => attempt(20));
  };

  return (
    <div className="space-y-4">
      <PublishBar
        resource="faq-groups"
        entity={{ id: group.id, status: group.status, has_unpublished_changes: group.has_unpublished_changes, deleted_at: group.deleted_at }}
        etag={etag}
        isDirty={dirty}
        flush={flush}
        onSaveDraft={mode !== "none" ? saveAll : undefined}
        isSaving={saving}
        onResult={onResult}
        onRefresh={() => onReseed({ refetchGroup: true })}
        onGoToField={goToField}
      />

      {mode === "translate" && !trashed ? (
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

      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value === "items" ? null : value })}>
        <TabsList>
          <TabsTrigger value="items">{t("tabs.items")}</TabsTrigger>
          <TabsTrigger value="settings">{t("tabs.settings")}</TabsTrigger>
          <TabsTrigger value="revisions">{t("tabs.revisions")}</TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="pt-4">
          {ready ? (
            <FaqItems
              items={items}
              isLoading={itemsQuery.isLoading}
              mode={mode}
              canCreate={mode === "full" && canCreate}
              canDelete={mode === "full" && canDelete}
              locales={locales}
              defaultLocale={defaultLocale}
              locale={locale}
              onLocaleChange={(code) => setParams({ locale: code === defaultLocale ? null : code })}
              edits={edits}
              baselineOf={baselineOf}
              problemsOf={problemsOf}
              onEdit={(id, draft) => {
                setEdits((all) => ({ ...all, [id]: draft }));
                setServerProblems((all) => {
                  const { [id]: _gone, ...rest } = all;
                  void _gone;
                  return rest;
                });
              }}
              onDiscard={(id) => {
                setEdits((all) => {
                  const { [id]: _gone, ...rest } = all;
                  void _gone;
                  return rest;
                });
                setServerProblems((all) => {
                  const { [id]: _gone, ...rest } = all;
                  void _gone;
                  return rest;
                });
              }}
              onSave={(item) => void saveItem(item)}
              savingId={savingId}
              expanded={expanded}
              onToggle={(id) =>
                setExpanded((s) => {
                  const next = new Set(s);
                  if (!next.delete(id)) next.add(id);
                  return next;
                })
              }
              onToggleVisible={(item, visible) => void toggleVisible(item, visible)}
              onAdd={() => setAddOpen(true)}
              onDelete={(item, position) => setToDelete({ item, position })}
              onMove={(from, to) => void move(from, to)}
            />
          ) : (
            <EditorSkeleton />
          )}
        </TabsContent>
        <TabsContent value="settings" className="pt-4">
          <div className="max-w-xl space-y-6" data-testid="faq-settings">
            <div className="space-y-1.5">
              <Label htmlFor="faq-field-name">{t("settings.name")}</Label>
              <Input
                id="faq-field-name"
                value={name}
                disabled={mode !== "full"}
                autoComplete="off"
                aria-invalid={nameProblem || nameServerProblem ? true : undefined}
                onChange={(e) => {
                  setNameEdit(e.target.value);
                  setNameServerProblem(undefined);
                }}
              />
              <p className="flex justify-between text-xs text-muted-foreground">
                <span role={nameProblem || nameServerProblem ? "alert" : undefined} className={nameProblem || nameServerProblem ? "text-destructive" : undefined}>{nameProblem ?? nameServerProblem ?? t("settings.nameHint")}</span>
                <span className="tabular-nums">{charCount(name)} / {MAX_FAQ_NAME}</span>
              </p>
            </div>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t("settings.key")}</dt>
              <dd className="font-mono" data-testid="faq-key">{group.key}</dd>
              <dt className="text-muted-foreground">{t("settings.usage")}</dt>
              <dd>{group.usage_count > 0 ? t("settings.usedIn", { count: group.usage_count }) : t("settings.unused")}</dd>
            </dl>
            <p className="text-xs text-muted-foreground">{t("settings.keyHint")}</p>
          </div>
        </TabsContent>
        <TabsContent value="revisions" className="pt-4">
          <RevisionsTab resource="faq-groups" id={groupId} canRestore={canUpdate && !trashed} etag={etag} onRestored={onRestored} onRefresh={() => onReseed({ refetchGroup: true })} />
        </TabsContent>
      </Tabs>

      {ready ? (
        <FaqAddDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          locales={locales}
          defaultLocale={defaultLocale}
          initialLocale={locale}
          add={(payload, key) => writes.addItem(payload, key)}
          onConflict={() => setConflictOpen(true)}
          onAdded={(item) => {
            setExpanded((s) => new Set(s).add(item.id));
            setParams({ tab: null });
          }}
        />
      ) : null}
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t("deleteDialog.title", { n: toDelete?.position ?? 0 })}
        description={t("deleteDialog.description")}
        confirmLabel={t("deleteDialog.confirm")}
        destructive
        isPending={deleting}
        onConfirm={remove}
      />
      <ConflictDialog open={conflictOpen} onOpenChange={setConflictOpen} onReload={reload} isReloading={isReloading} />
    </div>
  );
}
