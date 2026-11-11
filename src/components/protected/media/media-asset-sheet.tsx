"use client";

import { ArchiveRestoreIcon, FileUpIcon, SaveIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { ConflictDialog, type ConflictChange } from "@/components/global/conflict-dialog";
import { EditorLocaleSwitcher, type LocaleBadge } from "@/components/global/locale/editor-locale-switcher";
import { RevisionsTab } from "@/components/global/revisions/revisions-tab";
import { ErrorState } from "@/components/global/states/error-state";
import { NotFoundState } from "@/components/global/states/not-found-state";
import { NoPermission } from "@/components/layout/no-permission";
import { assetSnapshot } from "@/components/protected/media/asset-snapshot";
import {
  MAX_ALT,
  MAX_CAPTION,
  MAX_CREDIT,
  buildPayload,
  changedFields,
  draftFromAsset,
  type AssetDraft,
} from "@/components/protected/media/asset-draft";
import { FocalPointPicker } from "@/components/protected/media/focal-point-picker";
import { MediaThumb } from "@/components/protected/media/media-thumb";
import { MediaVideoPlayer } from "@/components/protected/media/media-video-player";
import { ReplaceFileDialog } from "@/components/protected/media/replace-file-dialog";
import { UsageList } from "@/components/protected/media/usage-list";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useLocales } from "@/hooks/use-locales";
import {
  mediaAssetKey,
  useMediaAssetDetail,
  useMediaFolders,
  useMediaUsages,
  useMutationDeleteMediaAsset,
  useMutationRestoreMediaAsset,
  useMutationUpdateMediaAsset,
} from "@/hooks/use-media";
import { useCan } from "@/hooks/use-permission";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { isConflictError, isNoPermissionError, parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import { formatBytes, formatDuration } from "@/lib/media";
import type { ApiFieldError } from "@/types/api";
import type { Locale } from "@/types/locales";
import type { MediaAssetDetail, MediaInUseDetails, SaveLiveWarning } from "@/types/media";
import { useQueryClient } from "@tanstack/react-query";

const NO_FOLDER = "__none__";

// SCR-35/36 detail (doc/07 section 3.22): a sheet on the library (`?asset=<id>`). It loads the asset with its
// ETag and mounts the editor keyed by that ETag, so a saved asset (new ETag in the cache) or a reload from the
// ConflictDialog starts a fresh draft - no effect-driven state sync.
export function MediaAssetSheet({ assetId, onClose }: { assetId: number; onClose: () => void }) {
  const t = useTranslations("media.sheet");
  const { data, isLoading, isFetching, error, refetch } = useMediaAssetDetail(assetId);
  const locales = useLocales();
  const [warnings, setWarnings] = useState<SaveLiveWarning[]>([]);
  // The chosen language and tab outlive the editor, which remounts after every save / reload (new ETag).
  const [locale, setLocale] = useState<string | null>(null);
  const [tab, setTab] = useState("details");
  // The editor registers its "close, but ask first when there are unsaved edits" here: Escape, the X and a click on the
  // overlay all arrive as `onOpenChange(false)`, and a plain `router.push` is not stopped by the navigation guard.
  const requestCloseRef = useRef<(() => void) | null>(null);

  const asset = data?.data.data;
  // The editor languages: the active ones. A user without `cms.locales:read` (a media-only editor) gets the
  // languages the asset already has text in, or just the default language.
  const editorLocales = useMemo<EditorLocale[]>(() => {
    if (locales.data) {
      return locales.data.data.filter((l) => l.is_active).sort((a, b) => a.sort_order - b.sort_order);
    }
    const codes = Object.keys(asset?.translations ?? {});
    return (codes.length > 0 ? codes : ["la"]).map((code, i) => ({
      code,
      name: code.toUpperCase(),
      native_name: code.toUpperCase(),
      short_label: code.toUpperCase(),
      is_default: i === 0,
      sort_order: i,
    }));
  }, [locales.data, asset]);
  const localesSettled = !locales.isLoading;
  return (
    <Sheet open onOpenChange={(open) => (!open ? (requestCloseRef.current ?? onClose)() : undefined)}>
      <SheetContent className="w-full gap-0 overflow-hidden sm:max-w-3xl" aria-describedby={undefined}>
        {error && isNoPermissionError(error) ? (
          <>
            <SheetHeader>
              <SheetTitle>{t("title")}</SheetTitle>
            </SheetHeader>
            <div className="px-4">
              <NoPermission className="min-h-40 py-8" />
            </div>
          </>
        ) : error && parseApiError(error).status === 404 ? (
          <>
            <SheetHeader>
              <SheetTitle>{t("title")}</SheetTitle>
            </SheetHeader>
            <div className="px-4">
              <NotFoundState title={t("notFound")} backHref="/admin/media" backLabel={t("backToLibrary")} className="min-h-40 py-8" />
            </div>
          </>
        ) : error && !data ? (
          <>
            <SheetHeader>
              <SheetTitle>{t("title")}</SheetTitle>
            </SheetHeader>
            <div className="px-4">
              <ErrorState error={error} onRetry={() => void refetch()} isRetrying={isFetching} className="min-h-40 py-8" />
            </div>
          </>
        ) : isLoading || !asset || !localesSettled ? (
          <>
            <SheetHeader>
              <SheetTitle>{t("title")}</SheetTitle>
              <SheetDescription>{t("loading")}</SheetDescription>
            </SheetHeader>
            <div className="space-y-3 px-4" aria-busy="true">
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-8 w-full" />
            </div>
          </>
        ) : (
          <AssetEditor
            key={`${asset.id}|${data?.etag ?? ""}`}
            asset={asset}
            etag={data?.etag}
            locales={editorLocales}
            locale={locale}
            onLocaleChange={setLocale}
            tab={tab}
            onTabChange={setTab}
            closeRef={requestCloseRef}
            warnings={warnings}
            onSaved={setWarnings}
            onReload={() => refetch()}
            onClose={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

type EditorLocale = Pick<Locale, "code" | "name" | "native_name" | "short_label" | "is_default" | "sort_order">;

function AssetEditor({
  asset,
  etag,
  locales: activeLocales,
  locale,
  onLocaleChange: setLocale,
  tab,
  onTabChange: setTab,
  closeRef,
  warnings,
  onSaved,
  onReload,
  onClose,
}: {
  asset: MediaAssetDetail;
  etag: string | undefined;
  locales: EditorLocale[];
  locale: string | null;
  onLocaleChange: (code: string) => void;
  tab: string;
  onTabChange: (tab: string) => void;
  closeRef: { current: (() => void) | null };
  warnings: SaveLiveWarning[];
  onSaved: (warnings: SaveLiveWarning[]) => void;
  onReload: () => Promise<unknown>;
  onClose: () => void;
}) {
  const t = useTranslations("media.sheet");
  const tCommon = useTranslations("common");
  const tErr = useTranslations("errors");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const { toastError } = useApiErrorHandler();
  const folders = useMediaFolders();
  const update = useMutationUpdateMediaAsset(asset.id);
  const remove = useMutationDeleteMediaAsset();
  const restore = useMutationRestoreMediaAsset();
  const decorativeId = useId();
  const folderId = useId();
  const altId = useId();
  const captionId = useId();
  const creditId = useId();

  const trashed = Boolean(asset.deleted_at);
  const isVideo = asset.kind === "video";
  // `update` (or `update_own` on an upload of mine) edits everything; `translate` only alt / caption / credit.
  const canUpdate = useCan(PERMISSION_KEYS.MEDIA_LIBRARY, PERMISSION_ACTIONS.UPDATE, { ownerId: asset.created_by?.id });
  const canTranslate = useCan(PERMISSION_KEYS.MEDIA_LIBRARY, PERMISSION_ACTIONS.TRANSLATE);
  const canDelete = useCan(PERMISSION_KEYS.MEDIA_LIBRARY, PERMISSION_ACTIONS.DELETE, { ownerId: asset.created_by?.id });
  const canEditStructure = canUpdate && !trashed;
  const canEditText = (canUpdate || canTranslate) && !trashed;

  const defaultLocale = activeLocales.find((l) => l.is_default)?.code ?? activeLocales[0]?.code ?? "la";
  const localeCodes = useMemo(() => activeLocales.map((l) => l.code), [activeLocales]);
  const [draft, setDraft] = useState<AssetDraft>(() => draftFromAsset(asset, localeCodes));

  const activeLocale = locale && localeCodes.includes(locale) ? locale : defaultLocale;
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflictOpen, setConflictOpen] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [inUse, setInUse] = useState<{ details: MediaInUseDetails; draftOnly: boolean } | null>(null);

  const changes = changedFields(asset, draft);
  const dirty = changes.length > 0;
  const current = draft.translations[activeLocale] ?? { alt: "", caption: "", credit: "" };

  const usages = useMediaUsages(asset.id, { limit: 50 }, tab === "usage" || asset.usage_count > 0);
  const when = (iso: string | null | undefined) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" }) : "—";

  const completeness = useMemo(() => {
    const map: Record<string, LocaleBadge> = {};
    for (const code of localeCodes) {
      const filled = isVideo || draft.is_decorative || (draft.translations[code]?.alt ?? "").trim() !== "";
      map[code] = { missing: filled ? 0 : 1, total: 1, status: filled ? "complete" : "missing" };
    }
    return map;
  }, [draft, localeCodes, isVideo]);

  const setTranslation = (patch: Partial<AssetDraft["translations"][string]>) => {
    setFieldErrors({});
    setDraft((d) => ({
      ...d,
      translations: { ...d.translations, [activeLocale]: { ...(d.translations[activeLocale] ?? { alt: "", caption: "", credit: "" }), ...patch } },
    }));
  };

  const save = async (): Promise<boolean> => {
    const payload = buildPayload(asset, draft);
    if (Object.keys(payload).length === 0) return true;
    setFieldErrors({});
    try {
      const result = await update.mutateAsync({ payload, etag });
      onSaved(result.data.data.warnings ?? []);
      toast.success(t("toast.saved"));
      return true;
    } catch (error) {
      if (isConflictError(error)) {
        setConflictOpen(true);
        return false;
      }
      const parsed = parseApiError(error);
      if (parsed.status === 422 && parsed.fieldErrors.length > 0) {
        const placed: Record<string, string> = {};
        const unplaced: ApiFieldError[] = [];
        for (const fe of parsed.fieldErrors) {
          // `/translations/la/alt` -> the field under that language; `/focal/x` -> focal; `/folder_id` -> folder.
          const m = /^\/translations\/([^/]+)\/(alt|caption|credit)$/.exec(fe.path);
          if (m) placed[`${m[1]}.${m[2]}`] = translateFieldError(tErr, fe);
          else if (fe.path === "/folder_id") placed.folder_id = translateFieldError(tErr, fe);
          else if (fe.path.startsWith("/focal")) placed.focal = translateFieldError(tErr, fe);
          else unplaced.push(fe);
        }
        setFieldErrors(placed);
        // Jump to the first language with a problem.
        const first = Object.keys(placed).find((k) => k.includes("."))?.split(".")[0];
        if (first && first !== activeLocale) setLocale(first);
        if (unplaced.length > 0) toast.error(translateFieldError(tErr, unplaced[0]));
        return false;
      }
      toastError(error, t("toast.saveError"));
      return false;
    }
  };

  useUnsavedChangesGuard(dirty && (canEditText || canEditStructure), { onSave: save });

  const myChanges: ConflictChange[] = changes.map((c) => {
    const label = c.localeCode ? `${t(`fields.${c.field}`)} (${c.localeCode})` : t(`fields.${c.field}`);
    let value = "";
    if (c.field === "folder_id") value = folderName(draft.folder_id);
    else if (c.field === "is_decorative") value = draft.is_decorative ? t("yes") : t("no");
    else if (c.field === "focal") value = draft.focal ? `${Math.round(draft.focal.x * 1000) / 10}%, ${Math.round(draft.focal.y * 1000) / 10}%` : t("noFocal");
    else value = draft.translations[c.localeCode ?? ""]?.[c.field as "alt" | "caption" | "credit"] ?? "";
    return { label, value: value || t("emptyValue") };
  });

  function folderName(id: number | null): string {
    if (id === null) return t("noFolder");
    return folders.data?.data.find((f) => f.id === id)?.path ?? `#${id}`;
  }

  const reload = async () => {
    setIsReloading(true);
    try {
      await onReload();
    } finally {
      setIsReloading(false);
    }
  };

  const requestClose = () => {
    if (dirty && (canEditText || canEditStructure)) setConfirmDiscard(true);
    else onClose();
  };
  useEffect(() => {
    closeRef.current = requestClose;
    return () => {
      closeRef.current = null;
    };
  });

  const doDelete = async () => {
    try {
      await remove.mutateAsync({ id: asset.id, etag });
      toast.success(t("toast.deleted"));
      onClose();
    } catch (error) {
      const parsed = parseApiError(error);
      if (parsed.status === 409 && parsed.code === "MEDIA_IN_USE") {
        setInUse({ details: (parsed.details ?? {}) as MediaInUseDetails, draftOnly: false });
        void queryClient.invalidateQueries({ queryKey: mediaAssetKey(asset.id) });
        return;
      }
      if (parsed.status === 409 && parsed.code === "ENTITY_REFERENCED") {
        setInUse({ details: (parsed.details ?? {}) as MediaInUseDetails, draftOnly: true });
        return;
      }
      if (isConflictError(error)) {
        setConflictOpen(true);
        return;
      }
      toastError(error, t("toast.deleteError"));
    }
  };

  const doRestore = async () => {
    try {
      await restore.mutateAsync({ id: asset.id, etag });
      toast.success(t("toast.restored"));
    } catch (error) {
      if (isConflictError(error)) setConflictOpen(true);
      else toastError(error, t("toast.restoreError"));
    }
  };

  const busy = update.isPending || remove.isPending || restore.isPending;
  const inUseRows = inUse ? (inUse.draftOnly ? inUse.details.references : inUse.details.usages) ?? [] : [];
  const inUseTotal = inUse ? (inUse.draftOnly ? inUse.details.total_references : inUse.details.total_usages) ?? inUseRows.length : 0;
  const altMissingWarning = warnings.find((w) => w.code === "alt_missing_default_locale");
  const filename = asset.original_filename;
  const isImage = asset.kind === "image" || asset.kind === "brand";

  return (
    <>
      <SheetHeader className="pr-12">
        <SheetTitle className="flex flex-wrap items-center gap-2 break-all">
          {filename}
          {trashed ? <Badge variant="destructive">{t("trashedBadge")}</Badge> : null}
          {asset.status !== "ready" ? <Badge variant="outline">{asset.status}</Badge> : null}
        </SheetTitle>
        <SheetDescription>
          {asset.mime_type} · {formatBytes(asset.bytes)}
          {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
          {isVideo && asset.duration_ms ? ` · ${formatDuration(asset.duration_ms)}` : ""}
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {trashed ? (
          <Alert variant="destructive" className="mb-4">
            <TriangleAlertIcon />
            <AlertTitle>{t("trashed.title")}</AlertTitle>
            <AlertDescription>
              {t("trashed.body", { date: when(asset.purge_at) })}
              {canDelete ? "" : ` ${t("trashed.noRestore")}`}
            </AlertDescription>
          </Alert>
        ) : null}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="details">{t("tabs.details")}</TabsTrigger>
            <TabsTrigger value="usage">{t("tabs.usage", { count: asset.usage_count })}</TabsTrigger>
            <TabsTrigger value="history">{t("tabs.history")}</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-5 pt-4">
            {isImage && asset.url ? (
              <FocalPointPicker
                asset={asset}
                alt={current.alt || filename}
                focal={draft.focal}
                onChange={(focal) => setDraft((d) => ({ ...d, focal }))}
                disabled={!canEditStructure}
              />
            ) : isVideo ? (
              <MediaVideoPlayer asset={asset} label={filename} />
            ) : (
              <div className="aspect-video max-w-xl overflow-hidden rounded-md border">
                <MediaThumb asset={asset} alt={filename} fill={false} />
              </div>
            )}
            {canEditStructure ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" size="sm" disabled={dirty || busy} onClick={() => setReplaceOpen(true)}>
                  <FileUpIcon />
                  {t("replace.button")}
                </Button>
                {dirty ? <span className="text-xs text-muted-foreground">{t("replace.saveFirst")}</span> : null}
              </div>
            ) : null}
            {fieldErrors.focal ? <p role="alert" className="text-sm text-destructive">{fieldErrors.focal}</p> : null}

            <section className="space-y-3" aria-label={t("text.title")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{t("text.title")}</h3>
                {activeLocales.length > 0 ? (
                  <EditorLocaleSwitcher
                    locales={activeLocales}
                    value={activeLocale}
                    onChange={setLocale}
                    completeness={completeness}
                  />
                ) : null}
              </div>
              {isVideo ? <p className="text-xs text-muted-foreground">{t("text.videoNoAlt")}</p> : null}
              {!isVideo ? (
                <>
                <div className="flex items-center gap-2">
                  <Switch
                    id={decorativeId}
                    checked={draft.is_decorative}
                    disabled={!canEditStructure}
                    onCheckedChange={(checked) => setDraft((d) => ({ ...d, is_decorative: checked }))}
                  />
                  <Label htmlFor={decorativeId} className="font-normal">
                    {t("text.decorative")}
                  </Label>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={altId}>{t("text.alt")}</Label>
                  <Input
                    id={altId}
                    lang={activeLocale}
                    maxLength={MAX_ALT}
                    value={current.alt}
                    disabled={!canEditText}
                    aria-invalid={fieldErrors[`${activeLocale}.alt`] ? true : undefined}
                    onChange={(e) => setTranslation({ alt: e.target.value })}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{draft.is_decorative ? t("text.altOptional") : t("text.altHelp")}</span>
                    <span>
                      {current.alt.length}/{MAX_ALT}
                    </span>
                  </div>
                  {fieldErrors[`${activeLocale}.alt`] ? (
                    <p role="alert" className="text-sm text-destructive">{fieldErrors[`${activeLocale}.alt`]}</p>
                  ) : null}
                </div>
                </>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor={captionId}>{t("text.caption")}</Label>
                <Textarea
                  id={captionId}
                  lang={activeLocale}
                  maxLength={MAX_CAPTION}
                  value={current.caption}
                  disabled={!canEditText}
                  aria-invalid={fieldErrors[`${activeLocale}.caption`] ? true : undefined}
                  onChange={(e) => setTranslation({ caption: e.target.value })}
                />
                {fieldErrors[`${activeLocale}.caption`] ? (
                  <p role="alert" className="text-sm text-destructive">{fieldErrors[`${activeLocale}.caption`]}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={creditId}>{t("text.credit")}</Label>
                <Input
                  id={creditId}
                  lang={activeLocale}
                  maxLength={MAX_CREDIT}
                  value={current.credit}
                  disabled={!canEditText}
                  aria-invalid={fieldErrors[`${activeLocale}.credit`] ? true : undefined}
                  onChange={(e) => setTranslation({ credit: e.target.value })}
                />
                {fieldErrors[`${activeLocale}.credit`] ? (
                  <p role="alert" className="text-sm text-destructive">{fieldErrors[`${activeLocale}.credit`]}</p>
                ) : null}
              </div>
              {!canEditText && !trashed ? <p className="text-xs text-muted-foreground">{t("readOnly")}</p> : null}
              {canTranslate && !canUpdate ? <p className="text-xs text-muted-foreground">{t("translateOnly")}</p> : null}
            </section>

            <section className="space-y-1.5">
              <Label htmlFor={folderId}>{t("folder.label")}</Label>
              <Select
                value={draft.folder_id === null ? NO_FOLDER : String(draft.folder_id)}
                disabled={!canEditStructure}
                onValueChange={(v) => setDraft((d) => ({ ...d, folder_id: v === NO_FOLDER ? null : Number(v) }))}
              >
                <SelectTrigger id={folderId} className="w-full max-w-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_FOLDER}>{t("noFolder")}</SelectItem>
                  {(folders.data?.data ?? []).map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.folder_id ? <p role="alert" className="text-sm text-destructive">{fieldErrors.folder_id}</p> : null}
            </section>

            {altMissingWarning && !isVideo ? (
              <Alert>
                <TriangleAlertIcon />
                <AlertTitle>{t("warning.altMissing.title")}</AlertTitle>
                <AlertDescription>{t("warning.altMissing.body")}</AlertDescription>
              </Alert>
            ) : null}

            <section aria-label={t("file.title")}>
              <h3 className="mb-1 text-sm font-semibold">{t("file.title")}</h3>
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
                <dt className="text-muted-foreground">{t("file.name")}</dt>
                <dd className="break-all">{filename}</dd>
                <dt className="text-muted-foreground">{t("file.type")}</dt>
                <dd>{asset.mime_type}</dd>
                <dt className="text-muted-foreground">{t("file.size")}</dt>
                <dd>{formatBytes(asset.bytes)}</dd>
                {asset.width && asset.height ? (
                  <>
                    <dt className="text-muted-foreground">{t("file.dimensions")}</dt>
                    <dd>
                      {asset.width} × {asset.height}
                    </dd>
                  </>
                ) : null}
                {isVideo && asset.duration_ms ? (
                  <>
                    <dt className="text-muted-foreground">{t("file.duration")}</dt>
                    <dd>{formatDuration(asset.duration_ms)}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">{t("file.checksum")}</dt>
                <dd className="font-mono text-xs break-all" title={asset.checksum_sha256 ?? undefined}>
                  {asset.checksum_sha256 ? `${asset.checksum_sha256.slice(0, 12)}…` : "—"}
                </dd>
                <dt className="text-muted-foreground">{t("file.source")}</dt>
                <dd>{t(`file.sources.${asset.source}`)}</dd>
                <dt className="text-muted-foreground">{t("file.created")}</dt>
                <dd>
                  {when(asset.created_at)}
                  {asset.created_by?.name ? ` · ${asset.created_by.name}` : ""}
                </dd>
                <dt className="text-muted-foreground">{t("file.updated")}</dt>
                <dd>
                  {when(asset.updated_at)}
                  {asset.updated_by?.name ? ` · ${asset.updated_by.name}` : ""}
                </dd>
              </dl>
            </section>
          </TabsContent>

          <TabsContent value="usage" className="space-y-3 pt-4">
            <h3 className="text-sm font-semibold">{t("usage.title")}</h3>
            {usages.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : usages.error && isNoPermissionError(usages.error) ? (
              <NoPermission className="min-h-40 py-8" />
            ) : usages.error ? (
              <ErrorState error={usages.error} onRetry={() => void usages.refetch()} className="min-h-40 py-8" />
            ) : (usages.data?.data.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">{t("usage.none")}</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{t("usage.count", { count: usages.data?.meta.total ?? 0 })}</p>
                <UsageList usages={usages.data?.data ?? []} />
              </>
            )}
          </TabsContent>

          <TabsContent value="history" className="pt-4">
            <RevisionsTab
              resource="media/assets"
              id={asset.id}
              canRestore={canEditStructure}
              etag={etag}
              currentSnapshot={assetSnapshot(asset)}
              onRefresh={onReload}
              onRestored={async ({ data, etag: nextEtag }) => {
                // Same shape as GET /media/assets/{id}: put it (with its new ETag) in the cache; the sheet remounts.
                if (nextEtag) {
                  queryClient.setQueryData(mediaAssetKey(asset.id), { data: { success: true, data }, etag: nextEtag });
                }
                void queryClient.invalidateQueries({ queryKey: ["/media/assets"] });
                void queryClient.invalidateQueries({ queryKey: ["schema-form"] });
                await onReload();
              }}
            />
          </TabsContent>
        </Tabs>
      </div>

      <SheetFooter className="flex-row flex-wrap items-center justify-between gap-2 border-t">
        <div className="flex flex-wrap items-center gap-2">
          {trashed ? (
            canDelete ? (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void doRestore()}>
                {restore.isPending ? <Spinner /> : <ArchiveRestoreIcon />}
                {t("restore")}
              </Button>
            ) : null
          ) : canDelete ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="text-destructive"
                disabled={busy || asset.usage_count > 0}
                aria-describedby={asset.usage_count > 0 ? `${decorativeId}-inuse` : undefined}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2Icon />
                {t("delete.button")}
              </Button>
              {asset.usage_count > 0 ? (
                <button
                  type="button"
                  id={`${decorativeId}-inuse`}
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => setTab("usage")}
                >
                  {t("delete.inUse", { count: asset.usage_count })}
                </button>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" disabled={update.isPending} onClick={requestClose}>
            {dirty ? tCommon("cancel") : t("close")}
          </Button>
          {(canEditText || canEditStructure) && !trashed ? (
            <Button type="button" disabled={!dirty || busy} onClick={() => void save()}>
              {update.isPending ? <Spinner /> : <SaveIcon />}
              {tCommon("save")}
            </Button>
          ) : null}
        </div>
      </SheetFooter>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("delete.title", { name: filename })}
        description={t("delete.description")}
        confirmLabel={t("delete.confirm")}
        destructive
        isPending={remove.isPending}
        onConfirm={doDelete}
      />

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t("discard.title")}
        description={t("discard.description")}
        confirmLabel={t("discard.confirm")}
        destructive
        onConfirm={() => onClose()}
      />

      <ReplaceFileDialog
        open={replaceOpen}
        onOpenChange={setReplaceOpen}
        assetId={asset.id}
        kind={asset.kind}
        etag={etag}
        onConflict={() => setConflictOpen(true)}
      />

      <ConflictDialog
        open={conflictOpen}
        onOpenChange={setConflictOpen}
        onReload={reload}
        isReloading={isReloading}
        myChanges={myChanges}
      />

      {inUse ? (
        <InUseDialog
          draftOnly={inUse.draftOnly}
          total={inUseTotal}
          rows={inUseRows}
          onClose={() => setInUse(null)}
          onShowUsage={() => {
            setInUse(null);
            setTab("usage");
          }}
        />
      ) : null}
    </>
  );
}

// 409 `MEDIA_IN_USE` (live usage) / `ENTITY_REFERENCED` (only a draft refers to it): the delete is refused, the
// list says where (doc/05 section 11.6).
function InUseDialog({
  draftOnly,
  total,
  rows,
  onClose,
  onShowUsage,
}: {
  draftOnly: boolean;
  total: number;
  rows: NonNullable<MediaInUseDetails["usages"]>;
  onClose: () => void;
  onShowUsage: () => void;
}) {
  const t = useTranslations("media.sheet.inUse");
  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="md:max-w-xl">
        <DialogHeader>
          <DialogTitle>{draftOnly ? t("draftTitle") : t("title")}</DialogTitle>
          <DialogDescription>{draftOnly ? t("draftBody", { count: total }) : t("body", { count: total })}</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto">
          <UsageList usages={rows} label={t("listLabel")} />
          {total > rows.length ? <p className="mt-2 text-xs text-muted-foreground">{t("more", { count: total - rows.length })}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("close")}
          </Button>
          <Button type="button" onClick={onShowUsage}>
            {t("ok")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
