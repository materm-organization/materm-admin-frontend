"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangleIcon, ArrowLeftIcon, EllipsisIcon, EyeIcon, LockIcon, PencilIcon, PlusIcon, RotateCcwIcon, SlidersHorizontalIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState, type SetStateAction } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { ListPage } from "@/components/global/list/list-page";
import { MultiSelectChecklist, type MultiSelectOption } from "@/components/global/multi-select-checklist";
import { SingleSelectFilter, type SelectedType } from "@/components/global/single-select-filter";
import { StatusBadge } from "@/components/global/status/status-badge";
import { TranslationBadges } from "@/components/global/status/translation-badges";
import { NotFoundState } from "@/components/global/states/not-found-state";
import { useBreadcrumbTitle } from "@/components/layout/breadcrumb-context";
import { NoPermission } from "@/components/layout/no-permission";
import { EntryCreateDialog } from "@/components/protected/collections/entry-create-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useCollection, useCollectionEntries, useMutationDeleteEntry, useMutationRestoreEntry } from "@/hooks/use-collections";
import { useListParams } from "@/hooks/use-list-params";
import { useLocales } from "@/hooks/use-locales";
import { useCan } from "@/hooks/use-permission";
import { isConflictError, isNoPermissionError, parseApiError } from "@/lib/api-error";
import { ENTRY_SORTS } from "@/lib/collections/constants";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { ListParamsConfig } from "@/lib/list-params";
import { entryEtag } from "@/services/collections.api";
import type { CollectionEntriesQuery, CollectionEntryListItem } from "@/types/collections";

const STATUSES = ["draft", "published", "archived"] as const;
const csv = <T,>(schema: z.ZodType<T>, max: number) => z.string().transform((v) => v.split(",").filter(Boolean)).pipe(z.array(schema).min(1).max(max)).optional();

// URL state: ?page=&limit=&keyword=&sort=&status=draft,published&locale=en&has_unpublished_changes=true&trashed=true. `sort_order` (the order
// the website uses) is the default; the API has no batch reorder, so the order is the number in the editor, not drag and drop.
const ENTRIES_LIST_CONFIG = {
  filters: {
    status: csv(z.enum(STATUSES), STATUSES.length),
    locale: z.string().regex(/^[a-z]{2,3}$/).optional(),
    has_unpublished_changes: z.literal("true").optional(),
    trashed: z.literal("true").optional(),
  },
  sortable: [...ENTRY_SORTS],
  defaultSort: "sort_order",
  defaultLimit: 20,
} satisfies ListParamsConfig;

const facetValue = (value: string | undefined, options: SelectedType[]): SelectedType | null => (value === undefined ? null : (options.find((o) => o.value === value) ?? { value, name: value }));
const pickFacet = (action: SetStateAction<SelectedType | null>, current: SelectedType | null): string | undefined => (typeof action === "function" ? action(current) : action)?.value;

// SCR-41 list (doc/07 3.25): the entries of one collection. Create needs `create`, trash and restore `delete`; the schema link is for `manage_schema`
// (anyone with `read` may still open the definition read only).
export function EntriesList({ collectionKey }: { collectionKey: string }) {
  const t = useTranslations("collections.entries");
  const tc = useTranslations("collections");
  const format = useFormatter();
  const { toastError } = useApiErrorHandler();
  const collectionQuery = useCollection(collectionKey);
  const collection = collectionQuery.data?.data.data;
  useBreadcrumbTitle(collectionQuery.error ? null : collection?.name);
  const locales = useLocales();
  const defaultLocale = locales.data?.data.find((l) => l.is_default)?.code ?? "la";
  const activeLocales = (locales.data?.data ?? []).filter((l) => l.is_active).sort((a, b) => a.sort_order - b.sort_order);

  const canCreate = useCan(PERMISSION_KEYS.CMS_COLLECTIONS, PERMISSION_ACTIONS.CREATE);
  const canDelete = useCan(PERMISSION_KEYS.CMS_COLLECTIONS, PERMISSION_ACTIONS.DELETE);
  const canEdit = useCan(PERMISSION_KEYS.CMS_COLLECTIONS, [PERMISSION_ACTIONS.UPDATE, PERMISSION_ACTIONS.TRANSLATE]);
  const canSchema = useCan(PERMISSION_KEYS.CMS_COLLECTIONS, PERMISSION_ACTIONS.MANAGE_SCHEMA);

  const list = useListParams(ENTRIES_LIST_CONFIG);
  const filters = list.params.filters;
  const trashed = filters.trashed === "true";
  const query = list.query as CollectionEntriesQuery;
  const entries = useCollectionEntries(collectionKey, query, Boolean(collection));
  const deleteMutation = useMutationDeleteEntry(collectionKey);
  const restoreMutation = useMutationRestoreEntry(collectionKey);
  const [createOpen, setCreateOpen] = useState(false);
  const [toDelete, setToDelete] = useState<CollectionEntryListItem | null>(null);

  const statusOptions = useMemo<MultiSelectOption[]>(() => STATUSES.map((s) => ({ value: s, name: t(`status.${s}`) })), [t]);
  const localeOptions = useMemo<SelectedType[]>(() => activeLocales.map((l) => ({ value: l.code, name: `${l.native_name} (${l.code})` })), [activeLocales]);
  const toSelected = (values: readonly string[] | undefined, options: MultiSelectOption[]) => (values ?? []).map((v) => options.find((o) => o.value === v) ?? { value: v, name: v });
  const titleOf = (e: CollectionEntryListItem) => e.title ?? `#${e.id}`;
  const stale = () => {
    toast.error(t("stale"));
    void entries.refetch();
  };

  const doDelete = async (e: CollectionEntryListItem) => {
    try {
      await deleteMutation.mutateAsync({ id: e.id, etag: entryEtag(e) });
      toast.success(t("delete.done", { title: titleOf(e) }));
      setToDelete(null);
    } catch (err) {
      setToDelete(null);
      if (isConflictError(err) || parseApiError(err).code === "INVALID_STATE") stale();
      else toastError(err, t("delete.failed"));
    }
  };
  const doRestore = async (e: CollectionEntryListItem) => {
    try {
      await restoreMutation.mutateAsync({ id: e.id, etag: entryEtag(e) });
      toast.success(t("restore.done", { title: titleOf(e) }));
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.code === "CONFLICT_DUPLICATE") toast.error(t("restore.duplicate"));
      else if (parsed.status === 422) toast.error(t("restore.invalid", { path: parsed.fieldErrors[0]?.path || "/" }));
      else if (isConflictError(err) || parsed.code === "INVALID_STATE") stale();
      else toastError(err, t("restore.failed"));
    }
  };

  const columns = useMemo<ColumnDef<CollectionEntryListItem>[]>(() => {
    const href = (e: CollectionEntryListItem) => `/admin/collections/${encodeURIComponent(collectionKey)}/${e.id}`;
    const cols: ColumnDef<CollectionEntryListItem>[] = [
      {
        id: "title",
        header: t("columns.title"),
        enableSorting: true,
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="flex min-w-0 max-w-72 flex-col">
              <div className="flex min-w-0 items-center gap-2">
                {trashed ? <span className="truncate font-medium">{titleOf(e)}</span> : (
                  <Link href={href(e)} className="truncate font-medium underline-offset-4 hover:underline">{titleOf(e)}</Link>
                )}
                {!trashed && !canEdit ? <LockIcon className="size-3.5 shrink-0 text-muted-foreground" role="img" aria-label={t("readOnly")} /> : null}
                {e.schema_stale ? (
                  <Badge variant="outline" className="shrink-0 gap-1 border-amber-500/50 text-amber-800 dark:text-amber-300" data-testid="stale-chip">
                    <AlertTriangleIcon className="size-3" aria-hidden />
                    {t("stale.chip")}
                  </Badge>
                ) : null}
              </div>
              {collection?.has_slug && e.slug ? <span className="truncate font-mono text-xs text-muted-foreground">{e.slug}</span> : null}
            </div>
          );
        },
      },
    ];
    if (trashed) {
      cols.push({
        id: "deleted_at",
        header: t("columns.deleted"),
        enableSorting: true,
        cell: ({ row }) => (
          <div className="text-sm">
            <div>{row.original.deleted_at ? format.dateTime(new Date(row.original.deleted_at), { dateStyle: "medium", timeStyle: "short" }) : ""}</div>
            {row.original.purge_at ? <div className="text-xs text-muted-foreground">{t("purgeOn", { when: format.dateTime(new Date(row.original.purge_at), { dateStyle: "medium" }) })}</div> : null}
          </div>
        ),
      });
    } else {
      cols.push(
        { id: "status", header: t("columns.status"), enableSorting: true, cell: ({ row }) => <StatusBadge status={row.original.status} hasUnpublishedChanges={row.original.has_unpublished_changes} /> },
        { id: "translations", header: t("columns.translations"), cell: ({ row }) => <TranslationBadges status={row.original.translation_status} fields={["title"]} noun={t("noun")} className="flex-nowrap" /> },
        { id: "sort_order", header: t("columns.order"), enableSorting: true, cell: ({ row }) => <span className="tabular-nums">{row.original.sort_order}</span> },
        {
          id: "updated_at",
          header: t("columns.updated"),
          enableSorting: true,
          cell: ({ row }) => {
            const e = row.original;
            return (
              <div className="text-sm">
                <div>{format.dateTime(new Date(e.updated_at), { dateStyle: "medium" })}</div>
                {e.updated_by?.name ? <div className="text-xs text-muted-foreground">{e.updated_by.name}</div> : null}
              </div>
            );
          },
        }
      );
    }
    cols.push({
      id: "actions",
      header: () => <span className="sr-only">{t("columns.actions")}</span>,
      cell: ({ row }) => {
        const e = row.original;
        const name = titleOf(e);
        if (trashed) {
          return canDelete ? (
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" aria-label={t("actions.restore", { name })} disabled={restoreMutation.isPending} onClick={() => void doRestore(e)}>
                <RotateCcwIcon />
                {t("actions.restoreShort")}
              </Button>
            </div>
          ) : null;
        }
        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("actions.menu", { name })}>
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={href(e)}>
                    {canEdit ? <PencilIcon /> : <EyeIcon />}
                    {canEdit ? t("actions.open") : t("actions.view")}
                  </Link>
                </DropdownMenuItem>
                {canDelete ? <DropdownMenuSeparator /> : null}
                {canDelete ? (
                  <DropdownMenuItem variant="destructive" onSelect={() => setToDelete(e)}>
                    <Trash2Icon />
                    {t("actions.delete")}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, format, trashed, canEdit, canDelete, restoreMutation.isPending, collection?.has_slug, collectionKey]);

  if (collectionQuery.error && isNoPermissionError(collectionQuery.error)) return <NoPermission />;
  if (collectionQuery.error && parseApiError(collectionQuery.error).status === 404) {
    return <NotFoundState title={tc("host.notFoundTitle")} description={tc("host.notFoundDescription")} backHref="/admin/collections" backLabel={tc("host.backToList")} />;
  }
  if (!collection) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Link href="/admin/collections" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
          {tc("host.backToList")}
        </Link>
        <Button type="button" variant="outline" size="sm" asChild>
          <Link href={`/admin/collections/${encodeURIComponent(collectionKey)}/schema`}>
            <SlidersHorizontalIcon />
            {canSchema ? t("editSchema") : t("viewSchema")}
          </Link>
        </Button>
      </div>
      {!collection.is_active ? <p className="mb-3 rounded-md border border-dashed p-3 text-sm leading-snug text-muted-foreground">{t("inactiveNote")}</p> : null}
      <ListPage<CollectionEntryListItem>
        title={collection.name}
        description={collection.description || t("description")}
        list={list}
        columns={columns}
        data={entries.data?.data ?? []}
        meta={entries.data?.meta}
        isLoading={entries.isLoading}
        isFetching={entries.isFetching}
        error={entries.error}
        onRetry={() => void entries.refetch()}
        getRowId={(r) => String(r.id)}
        keywordPlaceholder={t("searchPlaceholder")}
        filters={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {!trashed ? (
              <>
                <MultiSelectChecklist
                  label={t("filters.status")}
                  data={statusOptions}
                  selectedValues={toSelected(filters.status, statusOptions)}
                  setSelectedValues={(action: SetStateAction<MultiSelectOption[]>) => {
                    const next = typeof action === "function" ? action(toSelected(filters.status, statusOptions)) : action;
                    list.setFilters({ status: next.length ? (next.map((o) => o.value) as (typeof STATUSES)[number][]) : undefined });
                  }}
                />
                <SingleSelectFilter
                  label={t("filters.language")}
                  data={localeOptions}
                  selectedValue={facetValue(filters.locale, localeOptions)}
                  setSelectedValue={(action) => list.setFilters({ locale: pickFacet(action, facetValue(filters.locale, localeOptions)) })}
                />
                <div className="flex items-center gap-2">
                  <Switch id="entries-pending-only" checked={filters.has_unpublished_changes === "true"} onCheckedChange={(v) => list.setFilters({ has_unpublished_changes: v ? "true" : undefined })} />
                  <Label htmlFor="entries-pending-only" className="font-normal">{t("filters.pendingOnly")}</Label>
                </div>
              </>
            ) : null}
            {canDelete ? (
              <div className="flex items-center gap-2">
                <Switch
                  id="entries-trash"
                  checked={trashed}
                  onCheckedChange={(v) => list.setFilters(v ? { trashed: "true", status: undefined, locale: undefined, has_unpublished_changes: undefined } : { trashed: undefined })}
                />
                <Label htmlFor="entries-trash" className="font-normal">{t("trash")}</Label>
              </div>
            ) : null}
          </div>
        }
        primaryAction={
          canCreate && !collection.deleted_at ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <PlusIcon />
              {t("create.open")}
            </Button>
          ) : undefined
        }
        emptyTitle={trashed ? t("emptyTrash") : t("empty")}
        emptyDescription={trashed ? undefined : t("emptyHint")}
      />
      <EntryCreateDialog open={createOpen} onOpenChange={setCreateOpen} collectionKey={collectionKey} hasSlug={collection.has_slug} defaultLocale={defaultLocale} />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t("delete.title", { title: toDelete ? titleOf(toDelete) : "" })}
        description={
          <>
            <span>{t("delete.description")}</span>
            {toDelete?.status === "published" ? <span className="mt-2 block">{t("delete.publishedNote")}</span> : null}
          </>
        }
        confirmLabel={t("delete.confirm")}
        destructive
        isPending={deleteMutation.isPending}
        onConfirm={() => (toDelete ? doDelete(toDelete) : undefined)}
      />
    </>
  );
}
