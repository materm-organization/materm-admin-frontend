"use client";

import { SaveIcon, Trash2Icon, RotateCcwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { ConflictDialog } from "@/components/global/conflict-dialog";
import { PreviewLinkDialog } from "@/components/global/publishing/preview-link-dialog";
import { PublishBar, type PublishBarResult } from "@/components/global/publishing/publish-bar";
import { RevisionsTab, type RestoredRevision } from "@/components/global/revisions/revisions-tab";
import { EditorSkeleton } from "@/components/global/states/editor-skeleton";
import { EntityActivity } from "@/components/protected/collections/entity-activity";
import { SectionEditor, type SectionEditorHandle, type SectionEditorState, type SectionFocusRequest } from "@/components/protected/pages/editor/section-editor";
import { MAX_SHARED_NAME } from "@/components/protected/sections/shared-section-create-dialog";
import { SharedPublishExtra, SharedReferencesList, SharedUnpublishExtra, SharedUsages } from "@/components/protected/sections/shared-usages";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useAutosavePreference } from "@/hooks/use-autosave";
import { useLocales } from "@/hooks/use-locales";
import { useCan } from "@/hooks/use-permission";
import { useSharedSectionWrites, writeThroughShared } from "@/hooks/use-shared-sections";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { SectionSummary, UpdateSectionPayload } from "@/types/pages";
import type { PublishIssueTarget } from "@/types/publishing";
import type { SharedSection, SharedSectionReference } from "@/types/shared-sections";

type Tab = "content" | "usage" | "revisions" | "history";

// The shared section as the page-section editor (SCR-21) wants it: no page, always visible, never a reference itself.
function asSection(s: SharedSection): SectionSummary {
  return {
    id: s.id,
    public_id: s.public_id,
    page_id: 0,
    section_type: s.section_type,
    variant: s.variant,
    effective_variant: s.effective_variant,
    sort_order: 0,
    is_visible: true,
    anchor_id: null,
    props_bytes: s.props_bytes,
    shared_section_id: null,
    required: false,
    unsupported: s.unsupported,
    translation_status: s.translation_status,
    props: s.props,
  };
}

export type SharedSectionEditorProps = {
  section: SharedSection;
  etag: string | undefined;
  // Reads the server's version again and re-seeds the form (after a conflict, a discard, a restore of a revision).
  onReseed: (options?: { refetch?: boolean }) => Promise<void>;
};

// SCR-22 editor (doc/07 3.14, 05 18): the name (inline), the kind and its version (read only, SS-13), PublishBar, and the tabs Content (the SAME
// `SectionEditor` as SCR-21, saving with the shared section's ETag), Usage, Revisions and History. There is no Preview here (SS-10). Everything that
// holds unsaved edits lives in THIS component so a tab switch loses nothing.
export function SharedSectionEditor({ section, etag, onReseed }: SharedSectionEditorProps) {
  const t = useTranslations("sharedSections.editor");
  const tTypes = useTranslations("publishing.sectionTypes");
  const tErr = useTranslations("errors");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toastError } = useApiErrorHandler();
  const id = section.id;
  const trashed = Boolean(section.deleted_at);

  // ---- rights (05 18.15) ---------------------------------------------------------------------------------------------
  const canUpdate = useCan(PERMISSION_KEYS.CMS_SECTIONS, PERMISSION_ACTIONS.UPDATE);
  const canTranslate = useCan(PERMISSION_KEYS.CMS_SECTIONS, PERMISSION_ACTIONS.TRANSLATE);
  const canDelete = useCan(PERMISSION_KEYS.CMS_SECTIONS, PERMISSION_ACTIONS.DELETE);
  const canEditContent = !trashed && (canUpdate || canTranslate);

  // ---- data ------------------------------------------------------------------------------------------------------------
  const writes = useSharedSectionWrites(id);
  const localesQuery = useLocales();
  const locales = useMemo(() => (localesQuery.data?.data ?? []).filter((l) => l.is_active).sort((a, b) => a.sort_order - b.sort_order), [localesQuery.data]);
  const defaultLocale = (localesQuery.data?.data.find((l) => l.is_default) ?? locales[0])?.code ?? "";
  const [localeChoice, setLocale] = useState<string | null>(null);
  const locale = localeChoice && locales.some((l) => l.code === localeChoice) ? localeChoice : defaultLocale;
  const [tab, setTab] = useState<Tab>("content");
  const [autosave, setAutosave] = useAutosavePreference();
  const [conflictOpen, setConflictOpen] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  // The page whose preview link is being made (SS-20: the shared section has none of its own; the page preview shows its working copy).
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [focusRequest, setFocusRequest] = useState<SectionFocusRequest | undefined>();
  const focusToken = useRef(0);

  // The page-section editor writes through ONE method; this adapter sends it to the shared section's PATCH (props + variant, the shared ETag).
  const sectionWrites = useMemo(
    () => ({
      updateSection: (_sectionId: number, payload: UpdateSectionPayload) =>
        writes.update({ ...(payload.props !== undefined ? { props: payload.props } : {}), ...(payload.variant !== undefined ? { variant: payload.variant } : {}) }),
    }),
    [writes]
  );
  const asSummary = useMemo(() => asSection(section), [section]);

  // ---- the name (inline) -----------------------------------------------------------------------------------------------
  // `null` = untouched. What is typed while a save runs stays typed: only the value that was sent becomes the baseline.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const draftName = nameDraft ?? section.name;
  const trimmedName = draftName.trim();
  const nameProblem = !trimmedName ? "required" : [...trimmedName].length > MAX_SHARED_NAME ? "too_long" : null;
  const nameDirty = nameDraft !== null && trimmedName !== section.name;

  const saveName = useCallback(async (): Promise<boolean> => {
    if (!nameDirty || nameProblem) return !nameDirty;
    const sent = trimmedName;
    setNameSaving(true);
    setNameError(null);
    try {
      await writes.update({ name: sent });
      setNameDraft((current) => (current !== null && current.trim() === sent ? null : current));
      return true;
    } catch (error) {
      if (isConflictError(error)) {
        setConflictOpen(true);
        return false;
      }
      const parsed = parseApiError(error);
      const fe = parsed.fieldErrors.find((e) => e.path === "/name");
      if (parsed.status === 422 && fe) setNameError(translateFieldError(tErr as never, fe));
      else toastError(error, t("nameFailed"));
      return false;
    } finally {
      setNameSaving(false);
    }
  }, [nameDirty, nameProblem, trimmedName, writes, tErr, toastError, t]);

  // ---- the open editor ---------------------------------------------------------------------------------------------------
  const sectionRef = useRef<SectionEditorHandle>(null);
  const [editorState, setEditorState] = useState<SectionEditorState>({ dirty: false, saving: false, blocked: false });
  const onEditorState = useCallback((next: SectionEditorState) => setEditorState((prev) => (prev.dirty === next.dirty && prev.saving === next.saving && prev.blocked === next.blocked ? prev : next)), []);
  const onIssueCount = useCallback(() => undefined, []);
  const onConflict = useCallback(() => setConflictOpen(true), []);

  const saveAll = useCallback(async (): Promise<boolean> => {
    let ok = true;
    if (nameDirty) ok = (await saveName()) && ok;
    if (sectionRef.current?.isDirty()) ok = (await sectionRef.current.save()) && ok;
    return ok;
  }, [nameDirty, saveName]);
  const isDirty = nameDirty || editorState.dirty;

  // ---- PublishBar ---------------------------------------------------------------------------------------------------------
  const onResult = async (result: PublishBarResult) => {
    writeThroughShared(queryClient, id, { data: result.data as Partial<SharedSection>, etag: result.etag });
    // A discard changes the props themselves: start the form over from the server's version.
    if (result.action === "discard") await onReseed({ refetch: true });
  };
  const onRestored = async (result: RestoredRevision) => {
    writeThroughShared(queryClient, id, { data: result.data as Partial<SharedSection>, etag: result.etag });
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
  // A blocker of the publish names `/props/...` (or `/variant`, `/section_type`): show the content tab, in the language it names, and put the cursor there.
  const goToField = (target: PublishIssueTarget) => {
    setTab("content");
    if (target.locale && locales.some((l) => l.code === target.locale)) setLocale(target.locale);
    if (target.pointer.startsWith("/props")) {
      focusToken.current += 1;
      setFocusRequest({ token: focusToken.current, errors: [{ in: "body", path: target.pointer, code: target.code || "required" }] });
    }
  };

  // ---- delete / restore (through the same write queue as the saves) -------------------------------------------------------------
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [blocked, setBlocked] = useState<{ references: SharedSectionReference[]; total: number } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const inUse = section.used_in_pages + section.used_in_trashed_pages;

  const doDelete = async () => {
    setDeleting(true);
    try {
      await writes.remove();
      toast.success(t("delete.done", { name: section.name }));
      setDeleteOpen(false);
      router.push("/admin/sections");
    } catch (error) {
      setDeleteOpen(false);
      if (isConflictError(error)) {
        setConflictOpen(true);
        return;
      }
      const parsed = parseApiError(error);
      if (parsed.code === "ENTITY_REFERENCED" && parsed.status === 409) {
        const details = (parsed.details ?? {}) as { references?: SharedSectionReference[]; total_references?: number };
        setBlocked({ references: details.references ?? [], total: details.total_references ?? details.references?.length ?? 0 });
      } else if (parsed.code === "INVALID_STATE") {
        toast.error(t("delete.stale"));
        await onReseed({ refetch: true });
      } else toastError(error, t("delete.failed"));
    } finally {
      setDeleting(false);
    }
  };
  const doRestore = async () => {
    setRestoring(true);
    try {
      await writes.restore();
      toast.success(t("restore.done", { name: section.name }));
      await onReseed({ refetch: false });
    } catch (error) {
      const parsed = parseApiError(error);
      if (isConflictError(error)) setConflictOpen(true);
      else if (parsed.code === "INVALID_STATE") {
        toast.error(t("delete.stale"));
        await onReseed({ refetch: true });
      } else toastError(error, t("restore.failed"));
    } finally {
      setRestoring(false);
    }
  };

  const typeName = tTypes.has(section.section_type.key) ? tTypes(section.section_type.key) : section.section_type.name;
  const ready = locales.length > 0 && defaultLocale !== "";

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-md">
            <Label htmlFor="shared-name">{t("nameLabel")}</Label>
            <div className="flex gap-2">
              <Input
                id="shared-name"
                value={draftName}
                maxLength={MAX_SHARED_NAME * 2}
                readOnly={trashed || !canUpdate}
                aria-invalid={Boolean(nameError) || (nameDirty && Boolean(nameProblem))}
                onChange={(e) => {
                  setNameDraft(e.target.value);
                  setNameError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveName();
                  }
                }}
              />
              {canUpdate && !trashed ? (
                <Button type="button" variant="outline" disabled={!nameDirty || Boolean(nameProblem) || nameSaving} onClick={() => void saveName()}>
                  {nameSaving ? <Spinner /> : <SaveIcon />}
                  {t("nameSave")}
                </Button>
              ) : null}
            </div>
            {nameError || (nameDirty && nameProblem) ? (
              <p role="alert" className="text-sm text-destructive">{nameError ?? t(`nameProblem.${nameProblem}`, { max: MAX_SHARED_NAME })}</p>
            ) : null}
          </div>
          <p className="pb-2 text-sm text-muted-foreground" data-testid="shared-type-line">
            {typeName} · {t("version", { version: section.section_type.version })}
          </p>
        </div>
        <p className="text-sm text-muted-foreground" data-testid="shared-used-line">
          {inUse === 0
            ? t("usedNone")
            : section.used_in_trashed_pages > 0
              ? t("usedWithTrash", { count: section.used_in_pages, trashed: section.used_in_trashed_pages })
              : t("used", { count: section.used_in_pages })}
        </p>
      </div>

      {trashed ? (
        <Alert data-testid="shared-trashed-banner">
          <AlertTitle>{t("trashedTitle")}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("trashedBody")}</span>
            {canDelete ? (
              <Button type="button" size="sm" variant="outline" disabled={restoring} onClick={() => void doRestore()} data-testid="restore-button">
                {restoring ? <Spinner /> : <RotateCcwIcon />}
                {t("restore.button")}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <PublishBar
        resource="shared-sections"
        entity={{ id, status: section.status, has_unpublished_changes: section.has_unpublished_changes, deleted_at: section.deleted_at }}
        etag={etag}
        isDirty={isDirty}
        flush={async () => (isDirty ? saveAll() : true)}
        onSaveDraft={canEditContent ? saveAll : undefined}
        isSaving={nameSaving || editorState.saving}
        onResult={onResult}
        onRefresh={() => onReseed({ refetch: true })}
        onGoToField={goToField}
        confirmExtras={{ publish: <SharedPublishExtra id={id} />, unpublish: <SharedUnpublishExtra id={id} /> }}
      />
      <p className="text-xs text-muted-foreground" data-testid="shared-preview-note">{t("previewNote")}</p>

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <TabsList>
            <TabsTrigger value="content">{t("tabs.content")}</TabsTrigger>
            <TabsTrigger value="usage">{t("tabs.usage")}</TabsTrigger>
            <TabsTrigger value="revisions">{t("tabs.revisions")}</TabsTrigger>
            <TabsTrigger value="history">{t("tabs.history")}</TabsTrigger>
          </TabsList>
          {canEditContent && tab === "content" ? (
            <div className="flex items-center gap-2">
              <Switch id="shared-autosave" checked={autosave} onCheckedChange={setAutosave} />
              <Label htmlFor="shared-autosave" className="text-sm font-normal">{t("autosave")}</Label>
            </div>
          ) : null}
        </div>

        {/* forceMount: the form keeps its unsaved edits while another tab is shown */}
        <TabsContent value="content" forceMount className="pt-2 data-[state=inactive]:hidden">
          {ready ? (
            <SectionEditor
              ref={sectionRef}
              section={asSummary}
              writes={sectionWrites}
              showVisibility={false}
              locales={locales}
              locale={locale}
              onLocaleChange={setLocale}
              canUpdate={canUpdate}
              canTranslate={canTranslate}
              readOnly={trashed}
              autosave={autosave}
              focusRequest={focusRequest}
              onState={onEditorState}
              onIssueCount={onIssueCount}
              onConflict={onConflict}
            />
          ) : (
            <EditorSkeleton />
          )}
        </TabsContent>
        <TabsContent value="usage" className="pt-2">
          <SharedUsages id={id} onPreview={(pageId) => setPreviewPage(pageId)} />
        </TabsContent>
        <TabsContent value="revisions" className="pt-2">
          <RevisionsTab resource="shared-sections" id={id} canRestore={canUpdate && !trashed} etag={etag} onRestored={onRestored} onRefresh={() => onReseed({ refetch: true })} />
        </TabsContent>
        <TabsContent value="history" className="pt-2">
          <EntityActivity entityType="cms.shared_section" entityId={id} />
        </TabsContent>
      </Tabs>

      {canDelete && !trashed ? (
        <section className="space-y-2 rounded-md border border-destructive/30 p-3" aria-label={t("delete.section")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <p className="font-medium">{t("delete.heading")}</p>
              <p className="text-muted-foreground" data-testid="delete-reason">{inUse > 0 ? t("delete.inUse", { count: section.used_in_pages, trashed: section.used_in_trashed_pages }) : t("delete.hint")}</p>
            </div>
            <Button type="button" variant="destructive" size="sm" disabled={inUse > 0 || deleting} onClick={() => setDeleteOpen(true)} data-testid="delete-button">
              <Trash2Icon />
              {t("delete.button")}
            </Button>
          </div>
          {inUse > 0 ? (
            <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setTab("usage")}>
              {t("delete.showPages")}
            </Button>
          ) : null}
        </section>
      ) : null}

      {!trashed && !canUpdate && !canTranslate ? <p className="text-xs text-muted-foreground">{t("readOnly")}</p> : null}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("delete.title", { name: section.name })}
        description={t("delete.description")}
        confirmLabel={t("delete.confirm")}
        destructive
        isPending={deleting}
        onConfirm={doDelete}
      />
      <Dialog open={blocked !== null} onOpenChange={(open) => !open && setBlocked(null)}>
        <DialogContent className="md:max-w-lg" data-testid="delete-blocked">
          <DialogHeader>
            <DialogTitle>{t("delete.blocked.title")}</DialogTitle>
            <DialogDescription>{t("delete.blocked.body", { count: blocked?.total ?? 0 })}</DialogDescription>
          </DialogHeader>
          {blocked ? <SharedReferencesList references={blocked.references} total={blocked.total} /> : null}
          {blocked?.references.some((r) => r.page_trashed) ? <p className="text-sm text-muted-foreground">{t("delete.blocked.trashedHint")}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBlocked(null)}>{t("delete.blocked.close")}</Button>
            <Button
              type="button"
              onClick={() => {
                setBlocked(null);
                setTab("usage");
                void queryClient.invalidateQueries({ queryKey: ["/shared-sections"] });
              }}
            >
              {t("delete.showPages")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* The link is frozen when it is made, so the shared section is saved first (the dialog asks the same of a page). */}
      <PreviewLinkDialog
        resource="pages"
        entityId={previewPage ?? 0}
        open={previewPage !== null}
        onOpenChange={(open) => !open && setPreviewPage(null)}
        isDirty={isDirty}
        flush={canEditContent ? async () => (isDirty ? saveAll() : true) : undefined}
        isSaving={nameSaving || editorState.saving}
      />
      <ConflictDialog open={conflictOpen} onOpenChange={setConflictOpen} onReload={reload} isReloading={isReloading} />
    </div>
  );
}
