"use client";

import { LanguagesIcon, LockIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ConflictDialog } from "@/components/global/conflict-dialog";
import { PublishBar, type PublishBarResult } from "@/components/global/publishing/publish-bar";
import { RevisionsTab, type RestoredRevision } from "@/components/global/revisions/revisions-tab";
import { EditorSkeleton } from "@/components/global/states/editor-skeleton";
import { AlbumDetailsTab, type AlbumFormProps } from "@/components/protected/albums/album-details-tab";
import {
  buildAlbumPatch,
  draftFromAlbum,
  draftsEqual,
  pointerTarget,
  problemKeyOf,
  validateDraft,
  type AlbumDraft,
  type AlbumEditMode,
  type AlbumProblemCode,
} from "@/components/protected/albums/album-draft";
import { AlbumItemSheet } from "@/components/protected/albums/album-item-sheet";
import { AlbumItemsTab } from "@/components/protected/albums/album-items-tab";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAlbumItems, useAlbumWrites, writeThroughAlbum } from "@/hooks/use-albums";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useLocales } from "@/hooks/use-locales";
import { useCan } from "@/hooks/use-permission";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { MAX_ALBUM_DESCRIPTION, MAX_ALBUM_TITLE } from "@/lib/albums";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { AlbumDetail } from "@/types/albums";
import type { PublishIssueTarget } from "@/types/publishing";

const TABS = ["items", "details", "revisions"] as const;
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

export type AlbumEditorProps = {
  album: AlbumDetail;
  etag: string | undefined;
  // Reads the server's version again and re-seeds the form from it (after a conflict, a discard, a restore).
  onReseed: (options?: { refetchAlbum?: boolean }) => Promise<void>;
};

// SCR-29 (doc/07 section 3.17): the album editor. PublishBar on top, then the tabs Pictures (the default), Details and History. The
// DETAILS (title, description, cover) are one draft saved with "Save draft" (PATCH of what changed); the PICTURES are written at once, each
// command with its own `If-Match` through one queue (`useAlbumWrites`): add, edit in the sheet, delete, one `PUT .../order` per move.
export function AlbumEditor({ album, etag, onReseed }: AlbumEditorProps) {
  const t = useTranslations("albums.editor");
  const tProblem = useTranslations("albums.problems");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const { toastError } = useApiErrorHandler();
  const albumId = album.id;
  const trashed = Boolean(album.deleted_at);

  // ---- rights (05 13.4.2) -------------------------------------------------------------------------------------------------------
  const canUpdate = useCan(PERMISSION_KEYS.CMS_GALLERIES, PERMISSION_ACTIONS.UPDATE);
  const canTranslate = useCan(PERMISSION_KEYS.CMS_GALLERIES, PERMISSION_ACTIONS.TRANSLATE);
  const canCreate = useCan(PERMISSION_KEYS.CMS_GALLERIES, PERMISSION_ACTIONS.CREATE);
  const canDelete = useCan(PERMISSION_KEYS.CMS_GALLERIES, PERMISSION_ACTIONS.DELETE);
  const mode: AlbumEditMode = trashed ? "none" : canUpdate ? "full" : canTranslate ? "translate" : "none";

  // ---- data ----------------------------------------------------------------------------------------------------------------------
  const writes = useAlbumWrites(albumId);
  const itemsQuery = useAlbumItems(albumId);
  const items = itemsQuery.data?.data.data;
  const localesQuery = useLocales();
  const locales = useMemo(() => (localesQuery.data?.data ?? []).filter((l) => l.is_active).sort((a, b) => a.sort_order - b.sort_order), [localesQuery.data]);
  const defaultLocale = (localesQuery.data?.data.find((l) => l.is_default) ?? locales[0])?.code ?? "";
  const ready = locales.length > 0 && defaultLocale !== "";

  // ---- URL state: ?tab= ?locale= ?item=<id> -------------------------------------------------------------------------------------
  const tabParam = search.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "items";
  const localeParam = search.get("locale");
  const locale = locales.some((l) => l.code === localeParam) ? (localeParam as string) : defaultLocale;
  const itemParam = Number(search.get("item"));
  const openItem = items?.find((i) => i.id === itemParam) ?? null;

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

  // ---- the details draft ------------------------------------------------------------------------------------------------------------
  const localeCodes = useMemo(() => locales.map((l) => l.code), [locales]);
  const baseline = useMemo(() => draftFromAlbum(album, localeCodes), [album, localeCodes]);
  // `null` = untouched: the baseline is derived from the album in the cache, so a saved album re-bases itself.
  const [edit, setEdit] = useState<AlbumDraft | null>(null);
  const draft = edit ?? baseline;
  const dirty = edit !== null && !draftsEqual(edit, baseline);
  const [serverProblems, setServerProblems] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [isReloading, setIsReloading] = useState(false);

  const clientProblems = useMemo<Record<string, AlbumProblemCode>>(() => (defaultLocale ? validateDraft(draft, baseline, defaultLocale) : {}), [draft, baseline, defaultLocale]);
  const problems = useMemo(() => {
    const messages: Record<string, string> = { ...serverProblems };
    for (const [key, code] of Object.entries(clientProblems)) messages[key] = tProblem(code, { max: key.startsWith("title") ? MAX_ALBUM_TITLE : MAX_ALBUM_DESCRIPTION });
    return messages;
  }, [clientProblems, serverProblems, tProblem]);

  const onChange = (next: AlbumDraft) => {
    setEdit(next);
    setServerProblems({});
  };

  const save = useCallback(async (): Promise<boolean> => {
    if (!edit || mode === "none" || draftsEqual(edit, baseline)) return true;
    const keys = Object.keys(clientProblems);
    if (keys.length > 0) {
      toast.error(t("fixFirst"));
      const code = keys[0].split(".")[1];
      setParams({ tab: "details", ...(code && localeCodes.includes(code) ? { locale: code } : {}) });
      return false;
    }
    const patch = buildAlbumPatch(baseline, edit, defaultLocale, mode);
    const sent = edit;
    if (!patch) {
      setEdit(null);
      return true;
    }
    setSaving(true);
    try {
      await writes.updateAlbum(patch);
      // Edits typed while it was being saved stay; what was sent is now the baseline (the album in the cache).
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
        for (const fe of parsed.fieldErrors) mapped[problemKeyOf(fe.path)] = translateFieldError(tErrors as never, fe);
        setServerProblems(mapped);
        toast.error(t("saveRefused"));
        const loc = /^\/translations\/([^/]+)/.exec(parsed.fieldErrors[0].path)?.[1];
        setParams({ tab: "details", ...(loc ? { locale: loc } : {}) });
      } else {
        toastError(error, t("saveFailed"));
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [baseline, clientProblems, defaultLocale, edit, localeCodes, mode, setParams, t, tErrors, toastError, writes]);

  useUnsavedChangesGuard(dirty && mode !== "none", { onSave: save });

  // ---- PublishBar ------------------------------------------------------------------------------------------------------------------
  const flush = async () => (dirty ? save() : true);
  const onResult = async (result: PublishBarResult) => {
    writeThroughAlbum(queryClient, albumId, { data: result.data as Partial<AlbumDetail>, etag: result.etag });
    // A discard changes the texts and the pictures: start over from the server's version.
    if (result.action === "discard") await onReseed({ refetchAlbum: false });
  };
  const onRestored = async (result: RestoredRevision) => {
    writeThroughAlbum(queryClient, albumId, { data: result.data, etag: result.etag });
    await onReseed({ refetchAlbum: false });
  };
  const reload = async () => {
    setIsReloading(true);
    try {
      await onReseed({ refetchAlbum: true });
    } finally {
      setIsReloading(false);
    }
  };

  // "Go to field": a blocker of a picture opens its sheet, a title / description focuses the input in its language, the cover its block.
  const goToField = (target: PublishIssueTarget) => {
    const where = pointerTarget(target.pointer, (publicId) => items?.find((i) => i.public_id === publicId)?.id);
    const itemId = target.itemId ?? where.itemId;
    if (where.tab === "items") {
      setParams({ tab: null, item: itemId !== undefined ? String(itemId) : null });
      return;
    }
    setParams({ tab: "details", item: null, ...(where.locale ? { locale: where.locale } : {}) });
    focusWhenPresent(where.field === "cover" ? "album-field-cover" : `album-field-${where.field.replace(".", "-")}`);
  };

  const formProps: AlbumFormProps = { album, draft, baseline, onChange, problems, locales, defaultLocale, mode };

  return (
    <div className="space-y-4">
      <PublishBar
        resource="albums"
        entity={{
          id: album.id,
          status: album.status,
          has_unpublished_changes: album.has_unpublished_changes,
          deleted_at: album.deleted_at,
          schedule: album.schedule,
          scheduled_at: album.scheduled_at,
          first_published_at: album.first_published_at,
        }}
        etag={etag}
        isDirty={dirty}
        flush={flush}
        onSaveDraft={mode !== "none" ? save : undefined}
        isSaving={saving}
        onResult={onResult}
        onRefresh={() => onReseed({ refetchAlbum: true })}
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

      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value === "items" ? null : value, item: null })}>
        <TabsList>
          <TabsTrigger value="items">{t("tabs.items")}</TabsTrigger>
          <TabsTrigger value="details">{t("tabs.details")}</TabsTrigger>
          <TabsTrigger value="revisions">{t("tabs.revisions")}</TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="pt-4">
          {ready ? (
            <AlbumItemsTab
              items={items}
              isLoading={itemsQuery.isLoading}
              canUpdate={mode === "full"}
              canCreate={mode === "full" && canCreate}
              canDelete={mode === "full" && canDelete}
              canEditTexts={mode !== "none"}
              locales={locales}
              defaultLocale={defaultLocale}
              locale={locale}
              onLocaleChange={(code) => setParams({ locale: code === defaultLocale ? null : code })}
              writes={writes}
              onConflict={() => setConflictOpen(true)}
              onOpenItem={(id) => setParams({ item: String(id) })}
            />
          ) : (
            <EditorSkeleton />
          )}
        </TabsContent>
        <TabsContent value="details" className="pt-4">
          {ready ? <AlbumDetailsTab {...formProps} locale={locale} onLocaleChange={(code) => setParams({ locale: code === defaultLocale ? null : code })} /> : <EditorSkeleton />}
        </TabsContent>
        <TabsContent value="revisions" className="pt-4">
          <RevisionsTab resource="albums" id={albumId} canRestore={canUpdate && !trashed} etag={etag} onRestored={onRestored} onRefresh={() => onReseed({ refetchAlbum: true })} />
        </TabsContent>
      </Tabs>

      {ready ? (
        <AlbumItemSheet
          item={openItem}
          position={openItem && items ? items.findIndex((i) => i.id === openItem.id) + 1 : 0}
          onClose={() => setParams({ item: null })}
          locales={locales}
          defaultLocale={defaultLocale}
          initialLocale={locale}
          mode={mode}
          save={(itemId, payload) => writes.updateItem(itemId, payload)}
          onConflict={() => setConflictOpen(true)}
          onStale={() => void onReseed({ refetchAlbum: true })}
        />
      ) : null}

      <ConflictDialog open={conflictOpen} onOpenChange={setConflictOpen} onReload={reload} isReloading={isReloading} />
    </div>
  );
}
