"use client";

import { LanguagesIcon, LockIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ConflictDialog } from "@/components/global/conflict-dialog";
import { PreviewLinkDialog } from "@/components/global/publishing/preview-link-dialog";
import { PublishBar, type PublishBarResult } from "@/components/global/publishing/publish-bar";
import { RevisionsTab, type RestoredRevision } from "@/components/global/revisions/revisions-tab";
import { EditorSkeleton } from "@/components/global/states/editor-skeleton";
import { PostContentTab } from "@/components/protected/posts/post-content-tab";
import { PostDetailsTab, type PostDateControl } from "@/components/protected/posts/post-details-tab";
import {
  buildMediaPayload,
  buildPostPatch,
  dateProblem,
  draftFromPost,
  draftsEqual,
  galleryStructureChanged,
  postPointerFieldId,
  postPointerLocale,
  postPointerTab,
  validateDraft,
  type PostDraft,
  type PostEditMode,
  type PostProblemCode,
} from "@/components/protected/posts/post-draft";
import type { PostFormProps } from "@/components/protected/posts/post-form-props";
import { PostSeoTab } from "@/components/protected/posts/post-seo-tab";
import type { SlugStatus } from "@/components/protected/posts/slug-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useAutosave, useAutosavePreference } from "@/hooks/use-autosave";
import { useLocales } from "@/hooks/use-locales";
import { useCan } from "@/hooks/use-permission";
import { usePostWrites, writeThroughPost } from "@/hooks/use-posts";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import { MAX_EXCERPT, MAX_GALLERY_ALT, MAX_GALLERY_CAPTION, MAX_GALLERY_DESCRIPTION, MAX_GALLERY_HEADING, MAX_GALLERY_ITEMS, MAX_HERO_ALT, MAX_LABEL, MAX_LOCATION_LABEL, MAX_POST_TITLE, MAX_SEO_DESCRIPTION, MAX_SEO_TITLE, MAX_SLUG, MAX_TAGS } from "@/lib/posts";
import type { PostDetail } from "@/types/posts";
import type { PublishIssueTarget } from "@/types/publishing";

const TABS = ["content", "details", "seo", "revisions"] as const;
type Tab = (typeof TABS)[number];

// Focuses the element with this id as soon as it exists (a tab may still be mounting).
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

// The longest value a field may have, from its problem key (`title.la` -> 150).
function maxOfKey(key: string): number {
  const field = key.split(".")[0];
  const maxes: Record<string, number> = {
    title: MAX_POST_TITLE,
    slug: MAX_SLUG,
    excerpt: MAX_EXCERPT,
    label: MAX_LABEL,
    location_label: MAX_LOCATION_LABEL,
    gallery_heading: MAX_GALLERY_HEADING,
    gallery_description: MAX_GALLERY_DESCRIPTION,
    hero_alt: MAX_HERO_ALT,
    seo_title: MAX_SEO_TITLE,
    seo_description: MAX_SEO_DESCRIPTION,
    tag_ids: MAX_TAGS,
    gallery: key.includes(".caption.") ? MAX_GALLERY_CAPTION : key.includes(".alt.") ? MAX_GALLERY_ALT : MAX_GALLERY_ITEMS,
  };
  return maxes[field] ?? 200;
}

// Where a server field error belongs in the form: `/translations/la/slug` -> `slug.la`.
function problemKeyOf(path: string): string {
  const row = /^\/media_translations\/(\d+)\/([^/]+)\/(alt|caption)/.exec(path);
  if (row) return `gallery.${row[1]}.${row[3]}.${row[2]}`;
  const t = /^\/translations\/([^/]+)\/([a-z_]+)/.exec(path);
  if (t) return `${t[2]}.${t[1]}`;
  if (path.startsWith("/tag_ids")) return "tag_ids";
  if (path.startsWith("/media")) return "gallery";
  return path.replace(/^\//, "") || "post";
}

export type PostEditorProps = {
  post: PostDetail;
  etag: string | undefined;
  // Reads the server's version again and re-seeds every form from it (after a conflict, a discard, a restore).
  onReseed: (options?: { refetchPost?: boolean }) => Promise<void>;
};

// SCR-25 (doc/07 section 3.15): the post editor. PublishBar on top, then the tabs Content (texts, pictures, gallery), Details
// (category, tags, author, display date, languages), SEO and History. EVERYTHING that holds unsaved edits lives here (one
// `PostDraft`), not in a tab, so a tab switch loses nothing and `PublishBar` sees the real `isDirty` / `flush` / `onSaveDraft`.
export function PostEditor({ post, etag, onReseed }: PostEditorProps) {
  const t = useTranslations("posts.editor");
  const tProblem = useTranslations("posts.problems");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const { toastError } = useApiErrorHandler();
  const postId = post.id;
  const trashed = Boolean(post.deleted_at);

  // ---- rights (05 13.3.2, 13.3.3) ------------------------------------------------------------------------------------------------
  // `update`, or `update_own` of my own post: everything. `translate`: the texts of the languages that are not the default one.
  const canUpdate = useCan(PERMISSION_KEYS.CMS_BLOG, PERMISSION_ACTIONS.UPDATE, { ownerId: post.created_by?.id });
  const canTranslate = useCan(PERMISSION_KEYS.CMS_BLOG, PERMISSION_ACTIONS.TRANSLATE);
  const mode: PostEditMode = trashed ? "none" : canUpdate ? "full" : canTranslate ? "translate" : "none";

  // ---- data ----------------------------------------------------------------------------------------------------------------------
  const writes = usePostWrites(postId);
  const localesQuery = useLocales();
  const locales = useMemo(() => (localesQuery.data?.data ?? []).filter((l) => l.is_active).sort((a, b) => a.sort_order - b.sort_order), [localesQuery.data]);
  const defaultLocale = (localesQuery.data?.data.find((l) => l.is_default) ?? locales[0])?.code ?? "";
  const ready = locales.length > 0 && defaultLocale !== "";

  // ---- URL state: ?tab=  ?locale= (Content)  ?seoLocale= (SEO)  (+ ?field= from "Go to field") --------------------------------------
  const tabParam = search.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "content";
  const localeParam = search.get("locale");
  const locale = locales.some((l) => l.code === localeParam) ? (localeParam as string) : defaultLocale;
  // The SEO tab has its OWN language: choosing English in the Content tab must not hide the default-language SEO title.
  const seoLocaleParam = search.get("seoLocale");
  const seoLocale = locales.some((l) => l.code === seoLocaleParam) ? (seoLocaleParam as string) : defaultLocale;
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

  // ---- the draft ------------------------------------------------------------------------------------------------------------------
  const localeCodes = useMemo(() => locales.map((l) => l.code), [locales]);
  const baseline = useMemo(() => draftFromPost(post, localeCodes), [post, localeCodes]);
  // `null` = untouched: the baseline is derived from the post in the cache, so a saved post re-bases itself.
  const [edit, setEdit] = useState<PostDraft | null>(null);
  const draft = edit ?? baseline;
  const dirty = edit !== null && !draftsEqual(edit, baseline);
  const [serverProblems, setServerProblems] = useState<Record<string, string>>({});
  const [slugStatus, setSlugStatus] = useState<Record<string, SlugStatus>>({});
  const onSlugStatus = useCallback((code: string, status: SlugStatus) => setSlugStatus((prev) => (prev[code] === status ? prev : { ...prev, [code]: status })), []);

  const clientProblems = useMemo(() => {
    const found: Record<string, PostProblemCode> = defaultLocale ? validateDraft(draft, defaultLocale) : {};
    // A slug the check says is taken holds the save back (the server would answer 409 anyway).
    for (const [code, status] of Object.entries(slugStatus)) if (status === "taken" && draft.translations[code]?.slug.trim() !== baseline.translations[code]?.slug) found[`slug.${code}`] = "taken";
    return found;
  }, [draft, baseline, defaultLocale, slugStatus]);
  const problems = useMemo(() => {
    const messages: Record<string, string> = { ...serverProblems };
    // A taken slug holds the save back but is SAID by the slug field itself (its status line), not twice.
    for (const [key, code] of Object.entries(clientProblems)) if (code !== "taken") messages[key] = tProblem(code, { max: maxOfKey(key) });
    return messages;
  }, [clientProblems, serverProblems, tProblem]);

  // The display date: its own control and its own save (a PATCH that carries nothing else; on a published post it goes live at once).
  const [dateEdit, setDateEdit] = useState<{ value: string | null } | null>(null);
  const [dateSaving, setDateSaving] = useState(false);
  const [dateServerProblem, setDateServerProblem] = useState<string | undefined>();
  const dateValue = dateEdit ? dateEdit.value : post.published_at;
  const dateDirty = dateEdit !== null && dateEdit.value !== post.published_at;
  const dateCode = dateDirty ? dateProblem(dateValue, post.status === "published") : null;
  const dateText = dateCode ? tProblem(dateCode === "future" ? "future" : "dateRequired") : dateServerProblem;
  const [saving, setSaving] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [autosave, setAutosave] = useAutosavePreference();

  const onChange = (next: PostDraft) => {
    setEdit(next);
    setServerProblems({});
  };

  // One save: the PATCH of what changed, then (only when the order / set / pictures of the gallery changed) the PUT of the whole
  // gallery. The two run through the serialized write queue, so the second carries the ETag the first answered. A failure of the
  // second keeps the edits: the next save sends only what is still different.
  const save = useCallback(async (): Promise<boolean> => {
    if (!edit || mode === "none" || draftsEqual(edit, baseline)) return true;
    const keys = Object.keys(clientProblems);
    if (keys.length > 0) {
      toast.error(t("fixFirst"));
      // Show the first problem: its tab and, for a per-language field, its language.
      const [field, code] = keys[0].split(".");
      if (/^seo_/.test(field)) setParams({ tab: "seo", ...(code ? { seoLocale: code } : {}) });
      else if (field === "tag_ids") setParams({ tab: "details" });
      else setParams({ tab: null, ...(code && localeCodes.includes(code) ? { locale: code } : {}) });
      return false;
    }
    const viaPut = mode === "full" && galleryStructureChanged(baseline, edit);
    const patch = buildPostPatch(baseline, edit, defaultLocale, mode, { galleryViaPut: viaPut });
    const sent = edit;
    setSaving(true);
    try {
      if (patch) await writes.updatePost(patch);
      if (viaPut) await writes.replaceMedia({ media: buildMediaPayload(sent) });
      // Edits typed while it was being saved stay; what was sent is now the baseline (the post in the cache).
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
        for (const fe of parsed.fieldErrors) {
          const key = problemKeyOf(fe.path);
          mapped[key] = key.startsWith("slug.") && fe.code === "duplicate" ? tProblem("taken") : translateFieldError(tErrors as never, fe);
        }
        setServerProblems(mapped);
        toast.error(t("saveRefused"));
        const first = parsed.fieldErrors[0].path;
        const where = postPointerTab(first);
        const loc = postPointerLocale(first);
        if (where) setParams({ tab: where === "content" ? null : where, ...(loc && where === "content" ? { locale: loc } : {}), ...(loc && where === "seo" ? { seoLocale: loc } : {}) });
      } else {
        toastError(error, t("saveFailed"));
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [baseline, clientProblems, defaultLocale, edit, localeCodes, mode, setParams, t, tErrors, tProblem, toastError, writes]);

  const saveDate = useCallback(async (): Promise<boolean> => {
    if (!dateEdit || dateProblem(dateEdit.value, post.status === "published")) return false;
    setDateSaving(true);
    try {
      await writes.updatePost({ published_at: dateEdit.value });
      setDateEdit(null);
      setDateServerProblem(undefined);
      toast.success(post.status === "published" ? t("dateSavedLive") : t("dateSaved"));
      return true;
    } catch (error) {
      if (isConflictError(error)) setConflictOpen(true);
      else {
        const fe = parseApiError(error).fieldErrors[0];
        if (fe) setDateServerProblem(fe.code === "out_of_range" ? tProblem("future") : fe.code === "required" ? tProblem("dateRequired") : translateFieldError(tErrors as never, fe));
        else toastError(error, t("saveFailed"));
      }
      return false;
    } finally {
      setDateSaving(false);
    }
  }, [dateEdit, post.status, t, tErrors, tProblem, toastError, writes]);
  const dateControl: PostDateControl = {
    value: dateValue,
    dirty: dateDirty,
    saving: dateSaving,
    problem: dateText,
    onChange: (value) => {
      setDateEdit({ value });
      setDateServerProblem(undefined);
    },
    onSave: () => void saveDate(),
  };

  useUnsavedChangesGuard((dirty || dateDirty) && mode !== "none", { onSave: async () => (dirty ? await save() : true) && (dateDirty ? await saveDate() : true) });
  const auto = useAutosave({
    enabled: autosave && mode !== "none",
    isDirty: dirty,
    blocked: Object.keys(clientProblems).length > 0 || conflictOpen,
    save: async () => {
      if (!(await save())) throw new Error("not saved");
    },
    changeToken: edit,
  });

  // ---- "Go to field" -----------------------------------------------------------------------------------------------------------------
  const handledField = useRef<string | null>(null);

  // The PublishBar hands over a pointer; it goes into the URL (`?field=`, the tab, the language) in ONE replace and the effect below
  // opens the tab and puts the cursor in the field (so a link with `?field=` works as well).
  const goToField = (target: PublishIssueTarget) => {
    const where = postPointerTab(target.pointer);
    const loc = target.locale ?? postPointerLocale(target.pointer);
    setParams({
      field: target.pointer,
      tab: where === null || where === "content" ? null : where,
      locale: where === "content" && loc ? loc : search.get("locale"),
      seoLocale: where === "seo" && loc ? loc : search.get("seoLocale"),
    });
  };

  useEffect(() => {
    if (!fieldParam) {
      handledField.current = null;
      return;
    }
    if (handledField.current === fieldParam || !ready) return;
    handledField.current = fieldParam;
    setParams({ field: null });
    const id = postPointerFieldId(fieldParam, baseline.gallery.map((r) => r.key));
    if (id) focusWhenPresent(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldParam, ready]);

  // ---- PublishBar ---------------------------------------------------------------------------------------------------------------------
  const flush = async () => (dirty ? save() : true);
  const onResult = async (result: PublishBarResult) => {
    writeThroughPost(queryClient, postId, { data: result.data as Partial<PostDetail>, etag: result.etag });
    // A discard changes the texts themselves: start the forms over from the server's version.
    if (result.action === "discard") await onReseed({ refetchPost: false });
  };
  const onRestored = async (result: RestoredRevision) => {
    writeThroughPost(queryClient, postId, { data: result.data, etag: result.etag });
    await onReseed({ refetchPost: false });
  };
  const reload = async () => {
    setIsReloading(true);
    try {
      await onReseed({ refetchPost: true });
    } finally {
      setIsReloading(false);
    }
  };

  const formProps: PostFormProps = { post, draft, baseline, onChange, problems, locales, defaultLocale, mode, onSlugStatus };
  const ownerName = post.created_by?.name ?? t("noOwner");

  return (
    <div className="space-y-4">
      <PublishBar
        resource="posts"
        entity={{ id: post.id, status: post.status, has_unpublished_changes: post.has_unpublished_changes, deleted_at: post.deleted_at, owner_id: post.created_by?.id ?? null }}
        etag={etag}
        isDirty={dirty}
        flush={flush}
        onSaveDraft={mode !== "none" ? save : undefined}
        isSaving={saving}
        onResult={onResult}
        onRefresh={() => onReseed({ refetchPost: true })}
        onGoToField={goToField}
        onCreatePreviewLink={() => setPreviewOpen(true)}
      />
      <PreviewLinkDialog resource="posts" entityId={postId} open={previewOpen} onOpenChange={setPreviewOpen} isDirty={dirty} flush={mode !== "none" ? flush : undefined} isSaving={saving} />

      {mode === "translate" && !trashed ? (
        <Alert data-testid="translate-mode-note">
          <LanguagesIcon />
          <AlertDescription>{canUpdate ? t("translateOnlyNote") : t("translateNote", { owner: ownerName })}</AlertDescription>
        </Alert>
      ) : null}
      {mode === "none" && !trashed ? (
        <Alert data-testid="read-only-note">
          <LockIcon />
          <AlertDescription>{t("readOnlyNote", { owner: ownerName })}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value === "content" ? null : value })}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <TabsList>
            <TabsTrigger value="content">{t("tabs.content")}</TabsTrigger>
            <TabsTrigger value="details">{t("tabs.details")}</TabsTrigger>
            <TabsTrigger value="seo">{t("tabs.seo")}</TabsTrigger>
            <TabsTrigger value="revisions">{t("tabs.revisions")}</TabsTrigger>
          </TabsList>
          {mode !== "none" && tab !== "revisions" ? (
            <div className="flex items-center gap-2">
              <Switch id="autosave-switch" checked={autosave} onCheckedChange={setAutosave} />
              <Label htmlFor="autosave-switch" className="text-sm font-normal">
                {t("autosave")}
              </Label>
              {autosave && auto.status === "saving" ? (
                <span className="text-xs text-muted-foreground" role="status">
                  {t("autosaving")}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <TabsContent value="content" className="pt-4">
          {ready ? <PostContentTab {...formProps} locale={locale} onLocaleChange={(code) => setParams({ locale: code === defaultLocale ? null : code })} /> : <EditorSkeleton />}
        </TabsContent>
        <TabsContent value="details" className="pt-4">
          {ready ? <PostDetailsTab {...formProps} date={dateControl} /> : <EditorSkeleton />}
        </TabsContent>
        <TabsContent value="seo" className="pt-4">
          {ready ? <PostSeoTab {...formProps} locale={seoLocale} onLocaleChange={(code) => setParams({ seoLocale: code === defaultLocale ? null : code })} /> : <EditorSkeleton />}
        </TabsContent>
        <TabsContent value="revisions" className="pt-4">
          <RevisionsTab resource="posts" id={postId} canRestore={canUpdate && !trashed} etag={etag} onRestored={onRestored} onRefresh={() => onReseed({ refetchPost: true })} />
        </TabsContent>
      </Tabs>

      <ConflictDialog open={conflictOpen} onOpenChange={setConflictOpen} onReload={reload} isReloading={isReloading} />
    </div>
  );
}
