"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangleIcon, HistoryIcon, ImageIcon, RotateCcwIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ConflictDialog, type ConflictChange } from "@/components/global/conflict-dialog";
import { EditorLocaleSwitcher } from "@/components/global/locale/editor-locale-switcher";
import { RevisionsTab } from "@/components/global/revisions/revisions-tab";
import { EditorSkeleton } from "@/components/global/states/editor-skeleton";
import { ErrorState } from "@/components/global/states/error-state";
import { NotFoundState } from "@/components/global/states/not-found-state";
import { NoPermission } from "@/components/layout/no-permission";
import { MediaPicker } from "@/components/protected/media/media-picker";
import { MediaThumb } from "@/components/protected/media/media-thumb";
import {
  buildPutPayload,
  changedKeys,
  draftFromGroup,
  groupSnapshot,
  localeCompleteness,
  permissionKeyOfGroup,
  previewCopyright,
  validateDraft,
  type DraftValue,
  type SettingsDraft,
} from "@/components/protected/settings/settings-draft";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useLocales } from "@/hooks/use-locales";
import { useCan } from "@/hooks/use-permission";
import { useMutationPutSettings, useSettingsGroup, settingsGroupQueryKey } from "@/hooks/use-settings";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { isConflictError, isNoPermissionError, parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { cn } from "@/lib/utils";
import type { ApiFieldError } from "@/types/api";
import type { MediaAssetOption } from "@/types/cms";
import type { SaveLiveWarning } from "@/types/media";
import type { SettingsFieldDef, SettingsGroup, SettingsMediaRef } from "@/types/settings";

export type SettingsExtrasContext = {
  group: SettingsGroup;
  draft: SettingsDraft;
  locale: string;
  defaultLocale: string;
};

// SCR-15 / SCR-16 (doc/07 sections 3.8 / 3.9): the editor of ONE settings group. The form is built from the
// group's own field definitions (`GET /settings/{group}` -> `fields[]`: value type, localized, required, limits),
// saved as a whole with `PUT` + `If-Match`. A user with `update` edits everything; with `translate` only, the
// translatable texts; with neither, it is read-only. The history is a sheet with the shared `RevisionsTab`.
export function SettingsEditor({ group, extras }: { group: string; extras?: (ctx: SettingsExtrasContext) => ReactNode }) {
  const t = useTranslations("settings");
  const query = useSettingsGroup(group);
  const { data: localesData, isLoading: localesLoading } = useLocales();
  const [locale, setLocale] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<SaveLiveWarning[]>([]);

  if (query.error && isNoPermissionError(query.error)) return <NoPermission />;
  if (query.error && parseApiError(query.error).status === 404) {
    return <NotFoundState title={t("notFoundTitle")} description={t("notFoundDescription")} backHref="/admin" />;
  }
  if (query.error && !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />;
  if (!query.data || localesLoading) return <EditorSkeleton />;

  const locales = (localesData?.data ?? []).filter((l) => l.is_active);
  const defaultLocale = localesData?.data.find((l) => l.is_default)?.code ?? "la";
  const { data: loaded, etag } = query.data;
  return (
    <SettingsForm
      // A new ETag (a save, a restore, a reload after a conflict) starts a fresh draft.
      key={etag ?? loaded.data.version}
      group={loaded.data}
      etag={etag}
      locales={locales}
      defaultLocale={defaultLocale}
      locale={locale && locales.some((l) => l.code === locale) ? locale : defaultLocale}
      onLocaleChange={setLocale}
      warnings={warnings}
      onWarnings={setWarnings}
      reload={async () => {
        setWarnings([]);
        await query.refetch();
      }}
      extras={extras}
    />
  );
}

type FormProps = {
  group: SettingsGroup;
  etag: string | undefined;
  locales: Array<{ code: string; name: string; native_name: string; short_label: string; is_default: boolean; sort_order: number }>;
  defaultLocale: string;
  locale: string;
  onLocaleChange: (code: string) => void;
  warnings: SaveLiveWarning[];
  onWarnings: (warnings: SaveLiveWarning[]) => void;
  reload: () => Promise<unknown>;
  extras?: (ctx: SettingsExtrasContext) => ReactNode;
};

function SettingsForm({ group, etag, locales, defaultLocale, locale, onLocaleChange, warnings, onWarnings, reload, extras }: FormProps) {
  const t = useTranslations("settings");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const { toastError } = useApiErrorHandler();
  const mutation = useMutationPutSettings(group.group);
  const permissionKey = permissionKeyOfGroup(group.group);
  const canUpdate = useCan(permissionKey, "update");
  const canTranslate = useCan(permissionKey, "translate");
  const canEdit = canUpdate || canTranslate;
  const translateOnly = canTranslate && !canUpdate;

  const [draft, setDraft] = useState<SettingsDraft>(() => draftFromGroup(group));
  const [issues, setIssues] = useState<ApiFieldError[]>([]);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [picked, setPicked] = useState<Record<number, MediaAssetOption>>({});
  const formRef = useRef<HTMLFormElement>(null);

  const changed = useMemo(() => changedKeys(group, draft), [group, draft]);
  const dirty = changed.length > 0;
  const hasLocalized = group.fields.some((f) => f.is_localized);
  const completeness = useMemo(() => localeCompleteness(group, draft, locales.map((l) => l.code)), [group, draft, locales]);
  const issueCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const issue of issues) {
      const code = issue.path.split("/")[3];
      if (code) out[code] = (out[code] ?? 0) + 1;
    }
    return out;
  }, [issues]);

  const setValue = useCallback((key: string, value: DraftValue) => {
    setDraft((d) => ({ ...d, [key]: value }));
    // An error goes away when its field changes.
    setIssues((list) => list.filter((i) => !(i.path === `/values/${key}` || i.path.startsWith(`/values/${key}/`))));
  }, []);

  const focusFirst = (list: ApiFieldError[]) => {
    const first = list.find((i) => i.path.startsWith("/values/"));
    if (!first) return;
    const [, , key, code] = first.path.split("/");
    if (code && code !== locale) onLocaleChange(code);
    window.setTimeout(() => formRef.current?.querySelector<HTMLElement>(`[data-field-key="${key}"] [data-control]`)?.focus(), 0);
  };

  const doSave = async (): Promise<boolean> => {
    const clientErrors = validateDraft(group, draft, defaultLocale, { translateOnly });
    if (clientErrors.length) {
      setIssues(clientErrors);
      focusFirst(clientErrors);
      return false;
    }
    try {
      const result = await mutation.mutateAsync({ payload: buildPutPayload(group, draft, { translateOnly }), etag });
      onWarnings(result.data.data.warnings ?? []);
      setIssues([]);
      toast.success(t("toast.saved"));
      return true;
    } catch (error) {
      if (isConflictError(error)) {
        setConflictOpen(true);
        return false;
      }
      const parsed = parseApiError(error);
      if (parsed.fieldErrors.length) {
        setIssues(parsed.fieldErrors);
        focusFirst(parsed.fieldErrors);
      } else toastError(error, t("toast.saveFailed"));
      return false;
    }
  };

  useUnsavedChangesGuard(dirty, { onSave: doSave });

  const errorText = (path: string): string | undefined => {
    const issue = issues.find((i) => i.path === path);
    return issue ? translateFieldError(tErrors, issue) : undefined;
  };

  const myChanges: ConflictChange[] = changed.map((key) => {
    const field = group.fields.find((f) => f.key === key)!;
    const v = draft[key];
    return {
      label: labelOf(t, group.group, field),
      value: typeof v === "object" && v !== null ? Object.entries(v).map(([c, text]) => `${c}: ${text}`).join("\n") : String(v ?? ""),
    };
  });

  const shownWarnings = warnings.filter((w) => w.code !== "serp_description_long" || group.group === "seo");

  return (
    <form
      ref={formRef}
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && canEdit) void doSave();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {hasLocalized ? (
          <EditorLocaleSwitcher locales={locales} value={locale} onChange={onLocaleChange} completeness={completeness} issueCounts={issueCounts} />
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => setHistoryOpen(true)}>
            <HistoryIcon /> {t("history.open")}
          </Button>
          {canEdit ? (
            <>
              <Button type="button" variant="ghost" disabled={!dirty || mutation.isPending} onClick={() => { setDraft(draftFromGroup(group)); setIssues([]); }}>
                <RotateCcwIcon /> {t("actions.discard")}
              </Button>
              <Button type="submit" disabled={!dirty || mutation.isPending}>
                {mutation.isPending ? <Spinner /> : <SaveIcon />} {t("actions.save")}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {!canEdit ? (
        <Alert>
          <AlertTitle>{t("readOnly.title")}</AlertTitle>
          <AlertDescription>{t("readOnly.description")}</AlertDescription>
        </Alert>
      ) : translateOnly ? (
        <Alert>
          <AlertTitle>{t("translateOnly.title")}</AlertTitle>
          <AlertDescription>{t("translateOnly.description")}</AlertDescription>
        </Alert>
      ) : null}

      <p className="text-sm text-muted-foreground">{t("liveNote")}</p>

      {shownWarnings.length ? (
        <Alert role="status" data-testid="settings-warnings">
          <AlertTriangleIcon />
          <AlertTitle>{t("warnings.title")}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {shownWarnings.map((w, i) => (
                <li key={`${w.code}-${w.path}-${i}`}>{t.has(`warnings.${w.code}`) ? t(`warnings.${w.code}`, { ...stringParams(w.params), locale: w.path.split("/")[3] ?? "" }) : (w.message ?? w.code)}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Two columns on a wide screen (long texts take both), one column on a narrow one. */}
      <div className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-2">
        {[...group.fields]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((field) => (
            <SettingField
              key={field.key}
              group={group}
              field={field}
              value={draft[field.key]}
              locale={locale}
              defaultLocale={defaultLocale}
              disabled={!canEdit || mutation.isPending || (translateOnly && !field.is_localized)}
              error={errorText(field.is_localized ? `/values/${field.key}/${locale}` : `/values/${field.key}`) ?? (field.is_localized && locale === defaultLocale ? undefined : undefined)}
              onChange={(v) => setValue(field.key, v)}
              picked={picked}
              onPicked={(asset) => setPicked((p) => ({ ...p, [asset.id]: asset }))}
              baseUrlChanged={field.key === "base_url" && changed.includes("base_url")}
            />
          ))}
      </div>

      {extras ? extras({ group, draft, locale, defaultLocale }) : null}

      <ConflictDialog
        open={conflictOpen}
        onOpenChange={setConflictOpen}
        myChanges={myChanges}
        isReloading={reloading}
        onReload={async () => {
          setReloading(true);
          try {
            await reload();
            setConflictOpen(false);
          } finally {
            setReloading(false);
          }
        }}
      />

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>{t("history.title", { group: t.has(`groups.${group.group}`) ? t(`groups.${group.group}`) : group.group })}</SheetTitle>
            <SheetDescription>{t("history.description")}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            {historyOpen ? (
              <RevisionsTab
                resource="settings"
                id={group.group}
                canRestore={canUpdate}
                etag={etag}
                currentSnapshot={groupSnapshot(group)}
                onRefresh={reload}
                onRestored={({ data, etag: nextEtag }) => {
                  // The restore answers the group in the shape of its own GET: seed the cache with it and its new ETag.
                  queryClient.setQueryData(settingsGroupQueryKey(group.group), { data: { success: true, data }, etag: nextEtag });
                  onWarnings([]);
                  setHistoryOpen(false);
                  toast.success(t("toast.restored"));
                }}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </form>
  );
}

function stringParams(params: Record<string, unknown> | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params ?? {})) if (typeof v === "string" || typeof v === "number") out[k] = v;
  return out;
}

type Translator = ReturnType<typeof useTranslations>;
function labelOf(t: Translator, group: string, field: SettingsFieldDef): string {
  const key = `fields.${group}.${field.key}.label`;
  return t.has(key) ? t(key) : (field.description ?? field.key);
}
function helpOf(t: Translator, group: string, field: SettingsFieldDef): string | undefined {
  const key = `fields.${group}.${field.key}.help`;
  return t.has(key) ? t(key) : undefined;
}

type FieldProps = {
  group: SettingsGroup;
  field: SettingsFieldDef;
  value: DraftValue | undefined;
  locale: string;
  defaultLocale: string;
  disabled: boolean;
  error?: string;
  onChange: (value: DraftValue) => void;
  picked: Record<number, MediaAssetOption>;
  onPicked: (asset: MediaAssetOption) => void;
  baseUrlChanged: boolean;
};

function SettingField(props: FieldProps) {
  const { group, field, value, locale, defaultLocale, disabled, error, onChange, baseUrlChanged } = props;
  const t = useTranslations("settings");
  const id = useId();
  const label = labelOf(t, group.group, field);
  const help = helpOf(t, group.group, field);
  const localized = field.is_localized;
  const text = localized ? ((value && typeof value === "object" ? value[locale] : "") ?? "") : typeof value === "string" ? value : "";
  const fallback = localized && locale !== defaultLocale && value && typeof value === "object" ? (value[defaultLocale] ?? "") : "";
  const describedBy = [help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const max = field.max_length ?? undefined;
  const length = [...text].length;

  const set = (next: string) => {
    if (localized) onChange({ ...(value && typeof value === "object" ? value : {}), [locale]: next });
    else onChange(next);
  };

  let control: ReactNode;
  if (field.value_type === "media") {
    control = <MediaSettingField {...props} id={id} describedBy={describedBy} />;
  } else if (field.value_type === "text") {
    control = (
      <Textarea
        id={id}
        data-control
        rows={4}
        value={text}
        placeholder={fallback}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        onChange={(e) => set(e.target.value)}
      />
    );
  } else {
    control = (
      <Input
        id={id}
        data-control
        type={field.value_type === "email" ? "email" : field.value_type === "phone" ? "tel" : field.value_type === "url" ? "url" : "text"}
        inputMode={field.value_type === "phone" ? "tel" : undefined}
        autoComplete="off"
        value={text}
        placeholder={fallback || (field.value_type === "url" ? "https://" : undefined)}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        onChange={(e) => set(e.target.value)}
      />
    );
  }

  return (
    <div className={cn("space-y-1.5", field.value_type === "text" && "lg:col-span-2")} data-field-key={field.key}>
      {/* One label-row height for every field (the "per language" chip makes it taller): fields side by side in the
          two-column grid keep their inputs on the same line. */}
      <div className="flex min-h-6 flex-wrap items-center gap-2">
        <Label htmlFor={id}>
          {label}
          {field.required ? <span aria-hidden className="ml-0.5 text-destructive">*</span> : null}
        </Label>
        {localized ? <Badge variant="secondary">{t("localizedBadge")}</Badge> : null}
        {field.required ? <span className="sr-only">{t("required")}</span> : null}
      </div>
      {control}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span id={`${id}-help`}>{help}</span>
        {max && field.value_type !== "media" ? (
          <span className={cn(length > max && "text-destructive")} aria-label={t("counter", { count: length, max })}>
            {length} / {max}
          </span>
        ) : null}
      </div>
      {group.group === "footer" && field.key === "copyright" ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => set(`${text}${text && !text.endsWith(" ") ? " " : ""}{year}`)}>
            {t("insertYear")}
          </Button>
          <span className="text-muted-foreground">
            {t("preview")}: <span data-testid="copyright-preview">{previewCopyright(text)}</span>
          </span>
        </div>
      ) : null}
      {group.group === "seo" && field.key === "title_template" ? (
        <p className="text-sm text-muted-foreground">
          {t("preview")}:{" "}
          <span data-testid="title-preview">{text.split("%s").length === 2 ? text.replace("%s", t("titleExample")) : t("titleTemplateInvalid")}</span>
        </p>
      ) : null}
      {group.group === "seo" && field.key === "default_description" && length > 160 ? (
        <p role="status" className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangleIcon className="size-4" aria-hidden /> {t("descriptionLong", { count: length })}
        </p>
      ) : null}
      {baseUrlChanged ? (
        <p role="status" className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangleIcon className="size-4" aria-hidden /> {t("warnings.base_url_changed")}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function MediaSettingField({ group, field, value, disabled, onChange, picked, onPicked, id, describedBy }: FieldProps & { id: string; describedBy?: string }) {
  const t = useTranslations("settings");
  const [open, setOpen] = useState(false);
  const mediaId = typeof value === "number" ? value : null;
  const known: MediaAssetOption | SettingsMediaRef | undefined = mediaId !== null ? (picked[mediaId] ?? group.media[String(mediaId)]) : undefined;
  const ref = known as Partial<MediaAssetOption & SettingsMediaRef> | undefined;
  const asset: { url?: string | null; mime_type?: string; name: string } | undefined = ref
    ? { url: ref.url, mime_type: ref.mime_type, name: ref.filename ?? ref.original_filename ?? `#${mediaId}` }
    : mediaId !== null
      ? { name: `#${mediaId}` }
      : undefined;
  const ratio = group.group === "seo" ? "1200:630" : undefined;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className={cn("flex size-20 items-center justify-center overflow-hidden rounded-md border bg-muted", ratio && "h-[63px] w-[120px]")}>
        {asset ? <MediaThumb asset={{ url: asset.url ?? null, kind: "image", mime_type: asset.mime_type }} alt={asset.name} fill={false} /> : <ImageIcon className="size-6 text-muted-foreground" aria-hidden />}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-sm" data-testid={`media-name-${field.key}`}>{asset ? asset.name : t("noImage")}</span>
        <div className="flex gap-2">
          <Button
            id={id}
            data-control
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label={`${mediaId === null ? t("chooseImage") : t("changeImage")}: ${labelOf(t, group.group, field)}`}
            aria-describedby={describedBy}
            onClick={() => setOpen(true)}
          >
            {mediaId === null ? t("chooseImage") : t("changeImage")}
          </Button>
          {mediaId !== null ? (
            <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={`${t("removeImage")}: ${labelOf(t, group.group, field)}`} onClick={() => onChange(null as unknown as DraftValue)}>
              <Trash2Icon /> {t("removeImage")}
            </Button>
          ) : null}
        </div>
      </div>
      <MediaPicker
        open={open}
        onOpenChange={setOpen}
        mode="single"
        accept="image/*"
        ratio={ratio}
        selectedIds={mediaId !== null ? [mediaId] : []}
        title={t("pickerTitle", { field: labelOf(t, group.group, field) })}
        description={t("pickerDescription")}
        onSelect={([asset]) => {
          if (!asset) return;
          onPicked(asset);
          onChange(asset.id);
          setOpen(false);
        }}
      />
    </div>
  );
}
