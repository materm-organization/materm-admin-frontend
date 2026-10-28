"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { PencilIcon, RefreshCwIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { z } from "zod";

import { ListPage } from "@/components/global/list/list-page";
import { BundleSyncDialog } from "@/components/protected/ui-strings/bundle-sync-dialog";
import { UiStringSheet } from "@/components/protected/ui-strings/ui-string-sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useListParams } from "@/hooks/use-list-params";
import { useLocales } from "@/hooks/use-locales";
import { useCan } from "@/hooks/use-permission";
import { useUiStrings } from "@/hooks/use-ui-strings";
import { parseApiError } from "@/lib/api-error";
import { PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { ListParamsConfig } from "@/lib/list-params";
import { cn } from "@/lib/utils";
import type { UiStringItem, UiStringsListQuery } from "@/types/ui-strings";

const NAMESPACES = ["site", "home", "ourPath", "blog", "gallery", "contact", "forms"] as const;
const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const ANY = "__any__";

// URL state: the filters of doc/07 section 3.21. `copy_of_en` = "the text of this language is still the English
// one" (the server's `same_as`, which needs a single `locale`): it narrows the table to that language.
export const UI_STRINGS_CONFIG = {
  filters: {
    namespace: z.enum(NAMESPACES).optional(),
    overridden: z.literal("true").optional(),
    missing: z.string().regex(LOCALE).optional(),
    copy_of_en: z.string().regex(LOCALE).optional(),
    orphan: z.literal("true").optional(),
  },
  sortable: ["key", "namespace", "updated_at"],
  defaultSort: "key",
  defaultLimit: 50,
} satisfies ListParamsConfig;

// SCR-34: every key with, per active language, the website's text (bundle) and the override. Filters include the
// missing-keys finder. Editing happens in a sheet per cell.
export function UiStringsPage() {
  const t = useTranslations("uiStrings");
  const format = useFormatter();
  const list = useListParams(UI_STRINGS_CONFIG);
  const { data: localesData } = useLocales();
  const locales = (localesData?.data ?? []).filter((l) => l.is_active);
  const canUpdate = useCan(PERMISSION_KEYS.CMS_UI_STRINGS, "update");
  const canTranslate = useCan(PERMISSION_KEYS.CMS_UI_STRINGS, "translate");
  const canImport = useCan(PERMISSION_KEYS.CMS_UI_STRINGS, "import");
  const [editing, setEditing] = useState<{ key: string; locale: string } | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);

  const { filters } = list.params;
  const query = useMemo<UiStringsListQuery>(() => {
    const { copy_of_en, ...rest } = list.query as UiStringsListQuery & { copy_of_en?: string };
    return copy_of_en ? { ...rest, locale: copy_of_en, same_as: "en" } : rest;
  }, [list.query]);
  const { data, isLoading, isFetching, error, refetch } = useUiStrings(query);
  const rows = useMemo(() => data?.data ?? [], [data]);
  const shown = useMemo(() => (query.locale ? locales.filter((l) => l.code === query.locale) : locales), [query.locale, locales]);
  const meta = data?.meta;
  const summary = meta?.summary;
  const parsedError = error ? parseApiError(error) : null;
  const notSynced = parsedError?.status === 409 && (parsedError.details as { reason?: string } | undefined)?.reason === "bundle_not_synced";

  const columns = useMemo<ColumnDef<UiStringItem>[]>(() => {
    const cols: ColumnDef<UiStringItem>[] = [
      {
        id: "key",
        header: t("columns.key"),
        enableSorting: true,
        cell: ({ row }) => (
          <div className="min-w-0">
            <span className="font-mono text-xs break-all">{row.original.key}</span>
            <div className="mt-0.5 flex flex-wrap gap-1">
              <Badge variant="outline" className="text-[10px]">{row.original.namespace}</Badge>
              {row.original.in_bundle === false ? (
                <Badge variant="outline" className="border-amber-500 text-[10px] text-amber-700 dark:text-amber-400">{t("orphan")}</Badge>
              ) : null}
            </div>
          </div>
        ),
      },
    ];
    for (const l of shown) {
      cols.push({
        id: `locale-${l.code}`,
        header: l.name,
        cell: ({ row }) => {
          const cell = row.original.locales[l.code];
          const text = cell?.effective;
          const sameAsEn = l.code !== "en" && text != null && text === row.original.locales.en?.effective && cell?.is_override !== true;
          return (
            <button
              type="button"
              className="group flex w-full min-w-40 items-start gap-1 rounded-sm text-left hover:bg-accent/50 focus-visible:outline-2"
              aria-label={t("editCell", { key: row.original.key, locale: l.name })}
              onClick={() => setEditing({ key: row.original.key, locale: l.code })}
            >
              <span className="min-w-0 flex-1">
                {text == null ? (
                  <span className="text-xs text-amber-700 italic dark:text-amber-400">{t("missing")}</span>
                ) : (
                  <span className={cn("block text-sm break-words", cell.is_override ? "font-semibold" : "text-muted-foreground")}>{text}</span>
                )}
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {cell?.is_override ? <Badge className="text-[10px]">{t("override")}</Badge> : null}
                  {sameAsEn ? <Badge variant="outline" className="text-[10px]">{t("sameAsEnglish")}</Badge> : null}
                </span>
              </span>
              <PencilIcon className="mt-0.5 size-3.5 shrink-0 opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60" aria-hidden />
            </button>
          );
        },
      });
    }
    return cols;
  }, [t, shown]);

  const editingItem = editing ? rows.find((r) => r.key === editing.key) : undefined;
  const editingLocale = editing ? locales.find((l) => l.code === editing.locale) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-wide">{t("title")}</h1>
          <p className="mt-1 text-base text-muted-foreground">{t("description")}</p>
        </div>
        {canImport ? (
          <Button type="button" variant="outline" onClick={() => setSyncOpen(true)}>
            <RefreshCwIcon /> {t("sync.open")}
          </Button>
        ) : null}
      </div>

      {meta ? (
        <p className="text-sm text-muted-foreground" data-testid="ui-summary">
          {meta.manifest
            ? t("summary.manifest", {
                keys: summary?.keys ?? meta.total,
                overridden: summary?.overridden ?? 0,
                commit: meta.manifest.source_commit,
                when: format.dateTime(new Date(meta.manifest.synced_at), { dateStyle: "medium", timeStyle: "short" }),
              })
            : t("summary.noManifest", { keys: summary?.keys ?? meta.total })}
        </p>
      ) : null}
      {notSynced ? (
        <Alert role="status">
          <AlertTitle>{t("notSynced.title")}</AlertTitle>
          <AlertDescription>{t("notSynced.description")}</AlertDescription>
        </Alert>
      ) : null}

      <ListPage<UiStringItem>
        list={list}
        columns={columns}
        data={rows}
        meta={meta}
        isLoading={isLoading}
        isFetching={isFetching}
        error={notSynced ? undefined : error}
        onRetry={() => void refetch()}
        getRowId={(r) => r.key}
        keywordPlaceholder={t("searchPlaceholder")}
        filters={
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <div className="space-y-1">
              <Label htmlFor="ui-ns" className="text-xs">{t("filters.namespace")}</Label>
              <Select value={filters.namespace ?? ANY} onValueChange={(v) => list.setFilters({ namespace: v === ANY ? undefined : (v as (typeof NAMESPACES)[number]) })}>
                <SelectTrigger id="ui-ns" size="sm" className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t("filters.allNamespaces")}</SelectItem>
                  {NAMESPACES.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ui-missing" className="text-xs">{t("filters.missingIn")}</Label>
              <Select value={filters.missing ?? ANY} onValueChange={(v) => list.setFilters({ missing: v === ANY ? undefined : v })}>
                <SelectTrigger id="ui-missing" size="sm" className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t("filters.anyLanguage")}</SelectItem>
                  {locales.map((l) => (
                    <SelectItem key={l.code} value={l.code}>{l.name}{summary?.missing?.[l.code] ? ` (${summary.missing[l.code]})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ui-copy" className="text-xs">{t("filters.copyOfEnglish")}</Label>
              <Select value={filters.copy_of_en ?? ANY} onValueChange={(v) => list.setFilters({ copy_of_en: v === ANY ? undefined : v })}>
                <SelectTrigger id="ui-copy" size="sm" className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t("filters.anyLanguage")}</SelectItem>
                  {locales.filter((l) => l.code !== "en").map((l) => <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pb-1">
              <Switch id="ui-over" checked={filters.overridden === "true"} onCheckedChange={(v) => list.setFilters({ overridden: v ? "true" : undefined })} />
              <Label htmlFor="ui-over" className="font-normal">{t("filters.overridden")}</Label>
            </div>
            <div className="flex items-center gap-2 pb-1">
              <Switch id="ui-orphan" checked={filters.orphan === "true"} onCheckedChange={(v) => list.setFilters({ orphan: v ? "true" : undefined })} />
              <Label htmlFor="ui-orphan" className="font-normal">{t("filters.orphans")}</Label>
            </div>
          </div>
        }
        emptyTitle={t("empty")}
      />

      {editing && editingItem && editingLocale ? (
        <UiStringSheet
          key={`${editing.key}-${editing.locale}-${editingItem.locales[editing.locale]?.etag ?? "new"}`}
          item={editingItem}
          locale={editing.locale}
          localeName={editingLocale.name}
          canUpdate={canUpdate}
          canEdit={canUpdate || canTranslate}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <BundleSyncDialog open={syncOpen} onOpenChange={setSyncOpen} />
    </div>
  );
}
