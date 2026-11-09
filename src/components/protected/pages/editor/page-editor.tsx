"use client";

import { ArrowLeftIcon, MousePointerClickIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { ConflictDialog } from "@/components/global/conflict-dialog";
import { PreviewLinkDialog } from "@/components/global/publishing/preview-link-dialog";
import { PublishBar, type PublishBarResult } from "@/components/global/publishing/publish-bar";
import { RevisionsTab, type RestoredRevision } from "@/components/global/revisions/revisions-tab";
import { EditorSkeleton } from "@/components/global/states/editor-skeleton";
import { ErrorState } from "@/components/global/states/error-state";
import { NoPermission } from "@/components/layout/no-permission";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useAutosave, useAutosavePreference } from "@/hooks/use-autosave";
import { useLocales } from "@/hooks/use-locales";
import { refetchPageSections, usePageSections, usePageWrites } from "@/hooks/use-page-sections";
import { usePageTemplates, writeThroughPage } from "@/hooks/use-pages";
import { useCan } from "@/hooks/use-permission";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { isConflictError, isNoPermissionError, parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import { cn } from "@/lib/utils";
import type { PageDetail, SectionSummary } from "@/types/pages";
import type { PublishIssueTarget } from "@/types/publishing";

import { PageCompleteness } from "./page-completeness";
import { buildPatch, draftFromPage, fieldsEqual, pagePointerFieldId, pagePointerTab, validateFields, type PageFieldsDraft } from "./page-fields";
import { PageDetailsTab, PageSeoTab, type PageFieldsFormProps } from "./page-fields-form";
import { SectionEditor, type SectionEditorHandle, type SectionEditorState, type SectionFocusRequest } from "./section-editor";
import { SectionList } from "./section-list";
import { SharedReferencePanel } from "./shared-reference-panel";
import { SectionTypePicker } from "./section-type-picker";

const TABS = ["content", "details", "seo", "revisions"] as const;
type Tab = (typeof TABS)[number];

// Focuses the element with this id as soon as it exists (a tab or a section may still be mounting).
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

const STRUCTURE_RULES = new Set(["hero_first", "after_hero", "max_per_page", "section_not_allowed", "shared_in_required_slot"]);

export type PageEditorProps = {
  page: PageDetail;
  etag: string | undefined;
  // Reads the server's version again and re-seeds every form from it (after a conflict, a discard, a restore).
  onReseed: (options?: { refetchPage?: boolean }) => Promise<void>;
};

// SCR-20 (doc/07 section 3.12): the page editor. PublishBar on top, the languages' completeness, then the tabs
// Content (section list + section editor SCR-21), Details, SEO and History. Everything that holds unsaved edits lives
// HERE (not in a tab), so a tab switch loses nothing and `PublishBar` sees the real `isDirty` / `flush` / `onSaveDraft`.
export function PageEditor({ page, etag, onReseed }: PageEditorProps) {
  const t = useTranslations("pages.editor");
  const tDialogs = useTranslations("dialogs.unsavedChanges");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const { toastError } = useApiErrorHandler();
  const pageId = page.id;
  const trashed = Boolean(page.deleted_at);

  // ---- rights --------------------------------------------------------------------------------------------------
  const canUpdatePage = useCan(PERMISSION_KEYS.CMS_PAGES, PERMISSION_ACTIONS.UPDATE);
  const canTranslatePage = useCan(PERMISSION_KEYS.CMS_PAGES, PERMISSION_ACTIONS.TRANSLATE);
  const canSeoUpdate = useCan(PERMISSION_KEYS.CMS_SEO, PERMISSION_ACTIONS.UPDATE);
  const canSeoTranslate = useCan(PERMISSION_KEYS.CMS_SEO, PERMISSION_ACTIONS.TRANSLATE);
  const canSecRead = useCan(PERMISSION_KEYS.CMS_SECTIONS, PERMISSION_ACTIONS.READ);
  const canSecCreate = useCan(PERMISSION_KEYS.CMS_SECTIONS, PERMISSION_ACTIONS.CREATE);
  const canSecUpdate = useCan(PERMISSION_KEYS.CMS_SECTIONS, PERMISSION_ACTIONS.UPDATE);
  const canSecDelete = useCan(PERMISSION_KEYS.CMS_SECTIONS, PERMISSION_ACTIONS.DELETE);
  const canSecTranslate = useCan(PERMISSION_KEYS.CMS_SECTIONS, PERMISSION_ACTIONS.TRANSLATE);
  const canStructure = canUpdatePage;
  const canTexts = canUpdatePage || canTranslatePage;
  const canSeoFlags = canSeoUpdate || canUpdatePage;
  const canSeoTexts = canSeoUpdate || canSeoTranslate || canUpdatePage || canTranslatePage;
  const canEditFields = !trashed && (canTexts || canSeoTexts);

  // ---- data ----------------------------------------------------------------------------------------------------
  const writes = usePageWrites(pageId);
  const localesQuery = useLocales();
  const templatesQuery = usePageTemplates();
  const sectionsQuery = usePageSections(pageId, canSecRead);
  const locales = useMemo(() => (localesQuery.data?.data ?? []).filter((l) => l.is_active).sort((a, b) => a.sort_order - b.sort_order), [localesQuery.data]);
  const defaultLocale = (localesQuery.data?.data.find((l) => l.is_default) ?? locales[0])?.code ?? "";
  const template = templatesQuery.data?.data.find((x) => x.key === page.template);
  const sections = useMemo(() => (sectionsQuery.data?.data.data ?? []).slice().sort((a, b) => a.sort_order - b.sort_order), [sectionsQuery.data]);

  // ---- URL state: ?tab=  ?section=<id>  ?locale=  (+ ?field= from "Go to field") ----------------------------------------
  const tabParam = search.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "content";
  const sectionParam = search.get("section");
  const selectedId = sectionParam && /^[1-9]\d{0,17}$/.test(sectionParam) ? Number(sectionParam) : null;
  const localeParam = search.get("locale");
  const locale = locales.some((l) => l.code === localeParam) ? (localeParam as string) : defaultLocale;
  // The SEO tab has its OWN language (?seoLocale=, default = the default language): picking English in the section editor
  // must not hide the required default-language SEO title (B6). Only an explicit pick in the SEO tab (or "Go to field")
  // changes it.
  const seoLocaleParam = search.get("seoLocale");
  const seoLocale = locales.some((l) => l.code === seoLocaleParam) ? (seoLocaleParam as string) : defaultLocale;
  const fieldParam = search.get("field");
  const selected = selectedId !== null ? (sections.find((s) => s.id === selectedId) ?? null) : null;

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

  // ---- page fields (Details + SEO) ---------------------------------------------------------------------------------
  const localeCodes = useMemo(() => locales.map((l) => l.code), [locales]);
  const baselineDraft = useMemo(() => draftFromPage(page, localeCodes), [page, localeCodes]);
  const [edit, setEdit] = useState<PageFieldsDraft | null>(null);
  const [serverProblems, setServerProblems] = useState<Record<string, string>>({});
  const draft = edit ?? baselineDraft;
  const fieldsDirty = edit !== null && !fieldsEqual(edit, baselineDraft);
  const clientProblems = useMemo(() => (defaultLocale ? validateFields(draft, baselineDraft, defaultLocale) : {}), [draft, baselineDraft, defaultLocale]);
  const tProblem = useTranslations("pages.editor.problems");
  const problems = useMemo(() => {
    const messages: Record<string, string> = { ...serverProblems };
    for (const [key, code] of Object.entries(clientProblems)) {
      messages[key] = tProblem(code, { max: key.startsWith("title") ? 120 : key === "name" ? 120 : key.startsWith("seo_title") ? 120 : key.startsWith("seo_description") ? 320 : 200 });
    }
    return messages;
  }, [clientProblems, serverProblems, tProblem]);
  const [savingFields, setSavingFields] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isReloading, setIsReloading] = useState(false);

  const onFieldsChange = (next: PageFieldsDraft) => {
    setEdit(next);
    setServerProblems({});
  };

  const saveFields = useCallback(async (): Promise<boolean> => {
    if (!fieldsDirty || !edit) return true;
    if (Object.keys(clientProblems).length > 0) {
      toast.error(t("fixFirst"));
      const first = Object.keys(clientProblems)[0];
      setParams({ tab: /^(seo_|canonical)/.test(first) ? "seo" : "details" });
      return false;
    }
    const payload = buildPatch(baselineDraft, edit, defaultLocale);
    if (!payload) {
      setEdit(null);
      return true;
    }
    setSavingFields(true);
    try {
      await writes.updatePage(payload);
      // Edits typed while it was being saved stay; what was sent is now the baseline (the page in the cache).
      setEdit((current) => (current && fieldsEqual(current, edit) ? null : current));
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
        for (const fe of parsed.fieldErrors) {
          const m = /^\/translations\/([^/]+)\/([a-z_]+)$/.exec(fe.path);
          const key = m ? `${m[2]}.${m[1]}` : fe.path.replace(/^\//, "");
          mapped[key] = translateFieldError(tErrors as never, fe);
        }
        setServerProblems(mapped);
        toast.error(t("saveRefused"));
        const first = parsed.fieldErrors[0].path;
        const target = pagePointerTab(first);
        if (target) setParams({ tab: target });
      } else {
        toastError(error, t("saveFailed"));
      }
      return false;
    } finally {
      setSavingFields(false);
    }
  }, [baselineDraft, clientProblems, defaultLocale, edit, fieldsDirty, setParams, t, tErrors, toastError, writes]);

  // ---- the open section ------------------------------------------------------------------------------------------------
  const sectionRef = useRef<SectionEditorHandle>(null);
  const [sectionState, setSectionState] = useState<SectionEditorState>({ dirty: false, saving: false, blocked: false });
  const onSectionState = useCallback((next: SectionEditorState) => setSectionState((prev) => (prev.dirty === next.dirty && prev.saving === next.saving && prev.blocked === next.blocked ? prev : next)), []);
  const [issueCounts, setIssueCounts] = useState<Record<number, number>>({});
  const onIssueCount = useCallback(
    (id: number, count: number) =>
      setIssueCounts((prev) => {
        if ((prev[id] ?? 0) === count) return prev;
        const { [id]: _drop, ...rest } = prev;
        void _drop;
        return count > 0 ? { ...rest, [id]: count } : rest;
      }),
    []
  );
  const onConflict = useCallback(() => setConflictOpen(true), []);
  const [focusRequest, setFocusRequest] = useState<SectionFocusRequest | undefined>();
  const [autosave, setAutosave] = useAutosavePreference();

  const saveAll = useCallback(async (): Promise<boolean> => {
    let ok = true;
    if (fieldsDirty) ok = (await saveFields()) && ok;
    if (sectionRef.current?.isDirty()) ok = (await sectionRef.current.save()) && ok;
    return ok;
  }, [fieldsDirty, saveFields]);

  const isDirty = fieldsDirty || sectionState.dirty;
  useUnsavedChangesGuard(fieldsDirty && canEditFields, { onSave: saveFields });
  const fieldsAuto = useAutosave({
    enabled: autosave && canEditFields,
    isDirty: fieldsDirty,
    blocked: Object.keys(clientProblems).length > 0 || conflictOpen,
    save: async () => {
      if (!(await saveFields())) throw new Error("not saved");
    },
    changeToken: edit,
  });

  // ---- switching sections with unsaved edits ----------------------------------------------------------------------------
  const [switchTo, setSwitchTo] = useState<number | null>(null);
  const requestSelect = (id: number | null) => {
    if (id === selectedId) return;
    if (sectionState.dirty) setSwitchTo(id ?? -1);
    else setParams({ section: id === null ? null : String(id) });
  };
  const finishSwitch = (id: number) => {
    setSwitchTo(null);
    setParams({ section: id < 0 ? null : String(id) });
  };

  // ---- add / hide / delete / reorder ---------------------------------------------------------------------------------------
  const [picker, setPicker] = useState<{ position: number } | null>(null);
  const [deleting, setDeleting] = useState<SectionSummary | null>(null);
  const [detaching, setDetaching] = useState<SectionSummary | null>(null);

  // A refused structure change (422 `template_violation`) is said in words; the rest goes through the common handler.
  const explain = (error: unknown, fallback: string) => {
    if (isConflictError(error)) {
      setConflictOpen(true);
      return;
    }
    const parsed = parseApiError(error);
    const violation = parsed.fieldErrors.find((e) => e.code === "template_violation");
    const rule = String(violation?.params?.rule ?? "");
    if (violation && STRUCTURE_RULES.has(rule)) {
      toast.error(t(`sections.reorderRefused.${rule}`));
      return;
    }
    if (parsed.status === 409 && parsed.code === "INVALID_STATE" && parsed.details?.reason === "section_required") {
      toast.error(t("sections.deleteRequired"));
      return;
    }
    if (parsed.status === 409 && parsed.code === "INVALID_STATE" && parsed.details?.reason === "trashed") {
      toast.error(t("sections.trashed"));
      return;
    }
    // Placing a shared section that is gone / of the wrong kind (05 18.9.1): said in words.
    const sharedProblem = parsed.fieldErrors.find((e) => e.path === "/shared_section_id" && e.code !== "template_violation");
    if (parsed.status === 422 && sharedProblem) {
      toast.error(t(`sections.sharedRefused.${sharedProblem.code === "unknown_reference" ? "unknown_reference" : "other"}`));
      return;
    }
    if (parsed.status === 422 && parsed.fieldErrors[0]?.code === "limit_exceeded") {
      toast.error(t("sections.limit", { max: Number(parsed.fieldErrors[0].params?.max ?? 60) }));
      return;
    }
    toastError(error, fallback);
  };

  const addSection = async (typeKey: string, position: number, key: string) => {
    try {
      const result = await writes.createSection({ section_type_key: typeKey, position }, key);
      toast.success(t("sections.added"));
      setParams({ tab: null, section: sectionState.dirty ? search.get("section") : String(result.section.id) });
      return result;
    } catch (error) {
      explain(error, t("sections.addFailed"));
      throw error;
    }
  };

  // The "Shared" tab of the picker (05 18.9.1): a reference to a shared section, no type, no props, no variant. A shared section that is not
  // published yet can be placed; the answer's warning says the page publish is blocked until it is.
  const addSharedSection = async (sharedId: number, _typeKey: string, position: number, key: string) => {
    void _typeKey;
    try {
      const result = await writes.createSection({ shared_section_id: sharedId, position }, key);
      toast.success(t("sections.added"));
      if (result.warnings.some((w) => w.code === "shared_section_not_live")) toast.warning(t("sections.sharedNotLiveToast"));
      setParams({ tab: null, section: sectionState.dirty ? search.get("section") : String(result.section.id) });
      return result;
    } catch (error) {
      explain(error, t("sections.addFailed"));
      throw error;
    }
  };

  // Detach (05 18.10, SS-5): the shared section's working copy (a draft too) becomes the section's own; the editor on the right is then the
  // ordinary one (its key changes with the reference). Warning `shared_draft_copied` is said once.
  const detachSection = async () => {
    const target = detaching;
    if (!target) return;
    try {
      const result = await writes.detachSection(target.id);
      toast.success(t("sections.detached"));
      if (result.warnings.some((w) => w.code === "shared_draft_copied")) toast.info(t("sections.detachedDraft"));
    } catch (error) {
      explain(error, t("sections.detachFailed"));
    } finally {
      setDetaching(null);
    }
  };

  const toggleVisible = async (section: SectionSummary) => {
    try {
      await writes.updateSection(section.id, { is_visible: !section.is_visible });
      // A hidden section the template requires (the hero) blocks publishing: say it now, not at the 422 of Publish.
      if (section.is_visible && section.required) toast.warning(t("sections.hideRequiredWarning"));
    } catch (error) {
      explain(error, t("sections.toggleFailed"));
    }
  };

  const deleteSection = async () => {
    const target = deleting;
    if (!target) return;
    try {
      await writes.deleteSection(target.id);
      toast.success(t("sections.deleted"));
      onIssueCount(target.id, 0);
      if (target.id === selectedId) setParams({ section: null });
    } catch (error) {
      explain(error, t("sections.deleteFailed"));
    } finally {
      setDeleting(null);
    }
  };

  const reorder = async (ids: number[]) => {
    try {
      return await writes.reorderSections(ids);
    } catch (error) {
      explain(error, t("sections.reorderFailed"));
      throw error;
    }
  };

  // ---- "Go to field" -------------------------------------------------------------------------------------------------
  const focusToken = useRef(0);
  const [handledField, setHandledField] = useState<string | null>(null);

  // The PublishBar hands over a pointer; it goes into the URL (`?field=` + the section it names) in ONE replace, and the
  // effect below opens the tab / section and puts the cursor in the field (so a link with `?field=` works as well).
  const goToField = (target: PublishIssueTarget) => {
    const bySection = target.sectionPublicId ?? target.pointer.startsWith("/sections/");
    setParams({
      field: target.pointer,
      sectionKey: target.sectionKey ?? null,
      sectionIndex: target.sectionIndex !== undefined ? String(target.sectionIndex) : null,
      tab: bySection || pagePointerTab(target.pointer) === null ? null : pagePointerTab(target.pointer),
      // a section pointer picks the SECTION editor's language; a page pointer picks the SEO tab's (the effect below)
      locale: bySection ? (target.locale ?? search.get("locale")) : search.get("locale"),
      fieldCode: target.code || null,
    });
  };

  if (!fieldParam && handledField !== null) setHandledField(null);

  const sectionsReady = !canSecRead || sectionsQuery.data !== undefined;
  useEffect(() => {
    if (!fieldParam || handledField === fieldParam || !sectionsReady || !defaultLocale) return;
    const sectionMatch = /^\/sections\/([^/]+)(\/.*)?$/.exec(fieldParam);
    const clear = { field: null, sectionKey: null, sectionIndex: null, fieldCode: null } as const;
    const idx = search.get("sectionIndex");
    if (sectionMatch) {
      const found = sections.find((s) => s.public_id === sectionMatch[1]) ?? (idx !== null ? sections[Number(idx)] : undefined);
      const rest = sectionMatch[2] ?? "";
      const inProps = /^\/props(\/.*)?$/.exec(rest);
      focusToken.current += 1;
      setHandledField(fieldParam);
      if (found && inProps) setFocusRequest({ token: focusToken.current, errors: [{ in: "body", path: `/props${inProps[1] ?? ""}`, code: search.get("fieldCode") ?? "required" }] });
      setParams({ ...clear, tab: null, section: found ? String(found.id) : search.get("section") });
      if (found && rest === "/shared_section_id") focusWhenPresent("shared-reference-panel");
      else if (!found || !inProps) focusWhenPresent("add-section-button");
      return;
    }
    setHandledField(fieldParam);
    const target = pagePointerTab(fieldParam);
    const id = pagePointerFieldId(fieldParam);
    const pointerLocale = /^\/translations\/([^/]+)\//.exec(fieldParam)?.[1];
    const seoPick: Record<string, string> = target === "seo" && pointerLocale && locales.some((l) => l.code === pointerLocale) ? { seoLocale: pointerLocale } : {};
    setParams({ ...clear, ...seoPick, tab: target });
    if (fieldParam === "/sections" || !target) focusWhenPresent("add-section-button");
    else if (id) focusWhenPresent(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldParam, handledField, sectionsReady, defaultLocale, sections]);

  // ---- PublishBar ---------------------------------------------------------------------------------------------------
  const onResult = async (result: PublishBarResult) => {
    writeThroughPage(queryClient, pageId, { data: result.data as Partial<PageDetail>, etag: result.etag });
    // A discard changes the props themselves: read them again and start the forms over from them.
    if (result.action === "discard") await onReseed({ refetchPage: false });
    else void refetchPageSections(queryClient, pageId);
  };
  const onRestored = async (result: RestoredRevision) => {
    writeThroughPage(queryClient, pageId, { data: result.data, etag: result.etag });
    await onReseed({ refetchPage: false });
  };

  const reload = async () => {
    setIsReloading(true);
    try {
      await onReseed({ refetchPage: true });
    } finally {
      setIsReloading(false);
    }
  };

  const formProps: PageFieldsFormProps = {
    page,
    draft,
    baseline: baselineDraft,
    onChange: onFieldsChange,
    problems,
    locales,
    defaultLocale,
    readOnly: trashed,
    canStructure,
    canTexts,
    canSeoFlags,
    canSeoTexts,
  };

  const editor = canSecUpdate || canSecTranslate;
  const sectionsFailed = sectionsQuery.error && !sectionsQuery.data;
  const ready = locales.length > 0 && defaultLocale !== "";

  return (
    <div className="space-y-4">
      <PublishBar
        resource="pages"
        entity={{ id: page.id, status: page.status, has_unpublished_changes: page.has_unpublished_changes, deleted_at: page.deleted_at, is_home: page.is_home, is_system: page.is_system }}
        etag={etag}
        isDirty={isDirty}
        flush={async () => (isDirty ? saveAll() : true)}
        onSaveDraft={canEditFields || editor ? saveAll : undefined}
        isSaving={savingFields || sectionState.saving}
        onResult={onResult}
        onRefresh={() => onReseed({ refetchPage: true })}
        onGoToField={goToField}
        onCreatePreviewLink={() => setPreviewOpen(true)}
      />
      <PreviewLinkDialog
        resource="pages"
        entityId={pageId}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        isDirty={isDirty}
        flush={canEditFields || editor ? async () => (isDirty ? saveAll() : true) : undefined}
        isSaving={savingFields || sectionState.saving}
      />

      {ready ? <PageCompleteness page={page} sections={canSecRead ? sections : undefined} locales={locales} /> : null}

      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value === "content" ? null : value })}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <TabsList>
            <TabsTrigger value="content">{t("tabs.content")}</TabsTrigger>
            <TabsTrigger value="details">{t("tabs.details")}</TabsTrigger>
            <TabsTrigger value="seo">{t("tabs.seo")}</TabsTrigger>
            <TabsTrigger value="revisions">{t("tabs.revisions")}</TabsTrigger>
          </TabsList>
          {(canEditFields || editor) && tab !== "revisions" ? (
            <div className="flex items-center gap-2">
              <Switch id="autosave-switch" checked={autosave} onCheckedChange={setAutosave} />
              <Label htmlFor="autosave-switch" className="text-sm font-normal">{t("autosave")}</Label>
              {autosave && fieldsAuto.status === "saving" ? <span className="text-xs text-muted-foreground" role="status">{t("autosaving")}</span> : null}
            </div>
          ) : null}
        </div>

        {/* forceMount: the open section keeps its unsaved edits while another tab is shown */}
        <TabsContent value="content" forceMount className="pt-2 data-[state=inactive]:hidden">
          {!canSecRead ? (
            <NoPermission />
          ) : sectionsFailed ? (
            isNoPermissionError(sectionsQuery.error) ? <NoPermission /> : <ErrorState error={sectionsQuery.error} onRetry={() => void sectionsQuery.refetch()} isRetrying={sectionsQuery.isFetching} />
          ) : !sectionsQuery.data || !ready ? (
            <EditorSkeleton />
          ) : (
            <div className="grid gap-6 lg:grid-cols-[22.5rem_minmax(0,1fr)]">
              <div className={cn("min-w-0", selected && "hidden lg:block")}>
                <SectionList
                  sections={sections}
                  template={template}
                  locales={locales}
                  locale={locale}
                  defaultLocale={defaultLocale}
                  selectedId={selected?.id ?? null}
                  onSelect={requestSelect}
                  canCreate={canSecCreate}
                  canUpdate={canSecUpdate}
                  canDelete={canSecDelete}
                  readOnly={trashed}
                  issueCounts={issueCounts}
                  dirtyId={sectionState.dirty ? (selected?.id ?? null) : null}
                  onAdd={(position) => setPicker({ position })}
                  onToggleVisible={toggleVisible}
                  onDelete={setDeleting}
                  onDetach={setDetaching}
                  onReorder={reorder}
                />
              </div>
              <div className={cn("min-w-0", !selected && "hidden lg:block")}>
                {selected ? (
                  <div className="space-y-3">
                    <Button type="button" variant="ghost" size="sm" className="lg:hidden" onClick={() => requestSelect(null)}>
                      <ArrowLeftIcon className="rtl:rotate-180" />
                      {t("sections.back")}
                    </Button>
                    {selected.shared_section_id !== null && selected.shared_section_id !== undefined ? (
                    <SharedReferencePanel
                      key={`${selected.id}:shared`}
                      section={selected}
                      writes={writes}
                      locales={locales}
                      locale={locale}
                      onLocaleChange={(code) => setParams({ locale: code })}
                      canUpdate={canSecUpdate}
                      canReadShared={canSecRead}
                      readOnly={trashed}
                      onDetach={setDetaching}
                      onConflict={onConflict}
                    />
                    ) : (
                    <SectionEditor
                      key={`${selected.id}:own`}
                      ref={sectionRef}
                      section={selected}
                      writes={writes}
                      locales={locales}
                      locale={locale}
                      onLocaleChange={(code) => setParams({ locale: code })}
                      canUpdate={canSecUpdate}
                      canTranslate={canSecTranslate}
                      readOnly={trashed}
                      autosave={autosave}
                      focusRequest={focusRequest}
                      onState={onSectionState}
                      onIssueCount={onIssueCount}
                      onConflict={onConflict}
                    />
                    )}
                  </div>
                ) : (
                  <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                    <MousePointerClickIcon className="size-6" aria-hidden />
                    {t("sections.choose")}
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="details" className="pt-2">
          {ready ? <PageDetailsTab {...formProps} /> : <EditorSkeleton />}
        </TabsContent>
        <TabsContent value="seo" className="pt-2">
          {ready ? <PageSeoTab {...formProps} locale={seoLocale} onLocaleChange={(code) => setParams({ seoLocale: code === defaultLocale ? null : code })} /> : <EditorSkeleton />}
        </TabsContent>
        <TabsContent value="revisions" className="pt-2">
          <RevisionsTab resource="pages" id={pageId} canRestore={canUpdatePage && !trashed} etag={etag} onRestored={onRestored} onRefresh={() => onReseed({ refetchPage: true })} />
        </TabsContent>
      </Tabs>

      <SectionTypePicker
        open={picker !== null}
        onOpenChange={(open) => !open && setPicker(null)}
        template={template}
        sections={sections}
        position={picker?.position ?? 0}
        onPick={addSection}
        pageId={canSecRead ? pageId : undefined}
        onPickShared={canSecRead ? addSharedSection : undefined}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("sections.deleteTitle")}
        description={deleting?.shared_section_id != null ? t("sections.deleteSharedDescription") : t("sections.deleteDescription")}
        confirmLabel={t("sections.deleteConfirm")}
        destructive
        onConfirm={deleteSection}
      />

      <ConfirmDialog
        open={detaching !== null}
        onOpenChange={(open) => !open && setDetaching(null)}
        title={t("sections.detachTitle")}
        description={t("sections.detachDescription")}
        confirmLabel={t("sections.detachConfirm")}
        onConfirm={detachSection}
      />

      <ConflictDialog open={conflictOpen} onOpenChange={setConflictOpen} onReload={reload} isReloading={isReloading} />

      <AlertDialog open={switchTo !== null} onOpenChange={(open) => !open && setSwitchTo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tDialogs("title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("sections.switchDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tDialogs("stay")}</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                sectionRef.current?.discard();
                if (switchTo !== null) finishSwitch(switchTo);
              }}
            >
              {tDialogs("discard")}
            </Button>
            <Button
              type="button"
              onClick={async () => {
                const ok = (await sectionRef.current?.save()) ?? true;
                if (ok && switchTo !== null) finishSwitch(switchTo);
                else if (!ok) setSwitchTo(null);
              }}
            >
              {t("sections.saveAndOpen")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
