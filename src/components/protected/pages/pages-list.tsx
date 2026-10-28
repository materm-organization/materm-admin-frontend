"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { EllipsisIcon, ExternalLinkIcon, HouseIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState, type SetStateAction } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { ListPage } from "@/components/global/list/list-page";
import { MultiSelectChecklist, type MultiSelectOption } from "@/components/global/multi-select-checklist";
import { ReferencedDialog, type ReferencedItem } from "@/components/global/publishing/referenced-dialog";
import { StatusBadge } from "@/components/global/status/status-badge";
import { TranslationBadges } from "@/components/global/status/translation-badges";
import { PageCreateDialog } from "@/components/protected/pages/page-create-dialog";
import { PageSetHomeDialog } from "@/components/protected/pages/page-set-home-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useListParams } from "@/hooks/use-list-params";
import { useDefaultLocaleCode } from "@/hooks/use-locales";
import { useMutationDeletePage, useMutationRestorePage, usePageTemplates, usePages } from "@/hooks/use-pages";
import { useCan } from "@/hooks/use-permission";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import { MAX_FILTER_VALUES, type ListParamsConfig } from "@/lib/list-params";
import { pageEtag } from "@/services/pages.api";
import type { PageListItem, PagesQuery } from "@/types/pages";

const STATUSES = ["draft", "published", "archived"] as const;

const csv = <T extends string>(schema: z.ZodType<T>, max: number) =>
  z.string().transform((v) => v.split(",").filter(Boolean)).pipe(z.array(schema).min(1).max(max)).optional();

// URL state of the list: ?page=&limit=&keyword=&sort=&status=draft,published&template=standard&is_home=true&
// has_unpublished_changes=true&trashed=true (doc/07 sections 2.5.1 and 3.11). `sort` is the allow-list of GET /pages.
const PAGES_LIST_CONFIG = {
  filters: {
    status: csv(z.enum(STATUSES), STATUSES.length),
    template: csv(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), MAX_FILTER_VALUES),
    is_home: z.literal("true").optional(),
    has_unpublished_changes: z.literal("true").optional(),
    trashed: z.literal("true").optional(),
  },
  sortable: ["sort_order", "title", "path", "status", "template", "updated_at", "deleted_at"],
  defaultSort: "sort_order",
  defaultLimit: 20,
} satisfies ListParamsConfig;

// SCR-19 (doc/07 section 3.11): the pages of the website. Create, open (the editor is SCR-20), make the home page, move to
// the trash (30 days) and restore from it. Status / template / "home only" / "pending changes" filters and the trash switch
// are in the URL.
export function PagesList() {
  const t = useTranslations("pages");
  const format = useFormatter();
  const { toastError } = useApiErrorHandler();
  const defaultLocale = useDefaultLocaleCode();

  const canCreate = useCan(PERMISSION_KEYS.CMS_PAGES, PERMISSION_ACTIONS.CREATE);
  const canUpdate = useCan(PERMISSION_KEYS.CMS_PAGES, PERMISSION_ACTIONS.UPDATE);
  const canDelete = useCan(PERMISSION_KEYS.CMS_PAGES, PERMISSION_ACTIONS.DELETE);

  const list = useListParams(PAGES_LIST_CONFIG);
  const filters = list.params.filters;
  const trashed = filters.trashed === "true";
  // `trashed` needs read + delete; the query only carries what the API accepts.
  const query = list.query as PagesQuery;
  const { data, isLoading, isFetching, error, refetch } = usePages(query);
  const templates = usePageTemplates();

  const deleteMutation = useMutationDeletePage();
  const restoreMutation = useMutationRestorePage();

  const [createOpen, setCreateOpen] = useState(false);
  const [homeTarget, setHomeTarget] = useState<PageListItem | null>(null);
  const [toDelete, setToDelete] = useState<PageListItem | null>(null);
  const [referenced, setReferenced] = useState<{ page: PageListItem; items: ReferencedItem[]; total: number } | null>(null);

  const titleOf = (p: PageListItem) => p.title ?? p.name;
  const templateName = (key: string) => (t.has(`templates.${key}`) ? t(`templates.${key}`) : (templates.data?.data.find((x) => x.key === key)?.name ?? key));

  const statusOptions = useMemo<MultiSelectOption[]>(() => STATUSES.map((s) => ({ value: s, name: t(`status.${s}`) })), [t]);
  const templateOptions = useMemo<MultiSelectOption[]>(
    () => (templates.data?.data ?? []).map((x) => ({ value: x.key, name: t.has(`templates.${x.key}`) ? t(`templates.${x.key}`) : x.name })),
    [templates.data, t]
  );
  const toSelected = (values: readonly string[] | undefined, options: MultiSelectOption[]) =>
    (values ?? []).map((v) => options.find((o) => o.value === v) ?? { value: v, name: v });

  // A row the user acted on is out of date (someone else changed it): say so and reload the list.
  const stale = (message: string) => {
    toast.error(message);
    void refetch();
  };

  const doDelete = async (page: PageListItem, confirmReferences = false) => {
    try {
      const response = await deleteMutation.mutateAsync({ id: page.id, etag: pageEtag(page), confirmReferences });
      const warnings = response.data.data?.warnings ?? [];
      toast.success(t("delete.done", { title: titleOf(page) }));
      if (warnings.some((w) => w.code === "draft_kept_as_history")) toast.info(t("delete.draftKept"));
      setToDelete(null);
      setReferenced(null);
    } catch (error) {
      setToDelete(null);
      const parsed = parseApiError(error);
      if (parsed.code === "ENTITY_REFERENCED" && parsed.status === 409 && !confirmReferences) {
        const details = (parsed.details ?? {}) as { references?: ReferencedItem[]; total_references?: number };
        setReferenced({ page, items: details.references ?? [], total: details.total_references ?? details.references?.length ?? 0 });
      } else if (isConflictError(error)) {
        setReferenced(null);
        stale(t("stale"));
      } else if (parsed.code === "INVALID_STATE" && parsed.status === 409) {
        setReferenced(null);
        const reason = String(parsed.details?.reason ?? "");
        stale(t.has(`delete.invalidState.${reason}`) ? t(`delete.invalidState.${reason}`) : t("stale"));
      } else {
        setReferenced(null);
        toastError(error, t("delete.failed"));
      }
    }
  };

  const doRestore = async (page: PageListItem) => {
    try {
      await restoreMutation.mutateAsync({ id: page.id, etag: pageEtag(page) });
      toast.success(t("restore.done", { title: titleOf(page) }));
    } catch (error) {
      const parsed = parseApiError(error);
      if (parsed.code === "CONFLICT_DUPLICATE") {
        const what = parsed.fieldErrors.map((f) => (f.path === "/key" ? t("restore.key") : t("restore.path")));
        toast.error(t("restore.duplicate", { fields: [...new Set(what)].join(", ") }));
      } else if (isConflictError(error) || (parsed.code === "INVALID_STATE" && parsed.status === 409)) stale(t("stale"));
      else toastError(error, t("restore.failed"));
    }
  };

  const columns = useMemo<ColumnDef<PageListItem>[]>(() => {
    const cols: ColumnDef<PageListItem>[] = [
      {
        id: "title",
        header: t("columns.title"),
        enableSorting: true,
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="flex min-w-0 items-center gap-2">
              {p.is_home ? <HouseIcon className="size-4 shrink-0 text-muted-foreground" aria-label={t("homeBadge")} role="img" /> : null}
              {trashed ? (
                <span className="font-medium">{titleOf(p)}</span>
              ) : (
                <Link href={`/admin/pages/${p.id}`} className="truncate font-medium underline-offset-4 hover:underline">
                  {titleOf(p)}
                </Link>
              )}
            </div>
          );
        },
      },
      { id: "path", header: t("columns.path"), enableSorting: true, cell: ({ row }) => <span className="font-mono text-xs">{row.original.path}</span> },
      { id: "template", header: t("columns.template"), enableSorting: true, cell: ({ row }) => templateName(row.original.template) },
    ];
    if (trashed) {
      cols.push({
        id: "deleted_at",
        header: t("columns.deleted"),
        enableSorting: true,
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="text-sm">
              <div>{p.deleted_at ? format.dateTime(new Date(p.deleted_at), { dateStyle: "medium", timeStyle: "short" }) : ""}</div>
              {p.purge_at ? <div className="text-xs text-muted-foreground">{t("purgeOn", { when: format.dateTime(new Date(p.purge_at), { dateStyle: "medium" }) })}</div> : null}
            </div>
          );
        },
      });
    } else {
      cols.push(
        {
          id: "status",
          header: t("columns.status"),
          enableSorting: true,
          cell: ({ row }) => <StatusBadge status={row.original.status} hasUnpublishedChanges={row.original.has_unpublished_changes} />,
        },
        { id: "translations", header: t("columns.translations"), cell: ({ row }) => <TranslationBadges status={row.original.translation_status} /> },
        {
          id: "updated_at",
          header: t("columns.updated"),
          enableSorting: true,
          cell: ({ row }) => {
            const p = row.original;
            return (
              <div className="text-sm">
                <div>{format.dateTime(new Date(p.updated_at), { dateStyle: "medium", timeStyle: "short" })}</div>
                {p.updated_by?.name ? <div className="text-xs text-muted-foreground">{p.updated_by.name}</div> : null}
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
        const p = row.original;
        const name = titleOf(p);
        const showHome = canUpdate && !trashed && !p.is_home && p.status === "published";
        // The home page (BR-16) and the system pages (BR-18) have no Delete.
        const showDelete = canDelete && !trashed && !p.is_home && !p.is_system;
        if (trashed) {
          return canDelete ? (
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" aria-label={t("actions.restore", { name })} disabled={restoreMutation.isPending} onClick={() => void doRestore(p)}>
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
                  <Link href={`/admin/pages/${p.id}`}>
                    <ExternalLinkIcon />
                    {t("actions.open")}
                  </Link>
                </DropdownMenuItem>
                {showHome || showDelete ? <DropdownMenuSeparator /> : null}
                {showHome ? (
                  <DropdownMenuItem onSelect={() => setHomeTarget(p)}>
                    <HouseIcon />
                    {t("actions.setHome")}
                  </DropdownMenuItem>
                ) : null}
                {showDelete ? (
                  <DropdownMenuItem variant="destructive" onSelect={() => setToDelete(p)}>
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
  }, [t, format, trashed, canUpdate, canDelete, templates.data, restoreMutation.isPending]);

  const rows = data?.data ?? [];

  return (
    <>
      <ListPage<PageListItem>
        title={t("title")}
        description={t("description")}
        list={list}
        columns={columns}
        data={rows}
        meta={data?.meta}
        isLoading={isLoading}
        isFetching={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(r) => String(r.id)}
        keywordPlaceholder={t("searchPlaceholder")}
        filters={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {!trashed ? (
              <>
                <MultiSelectChecklist
                  label={t("filters.status")}
                  data={statusOptions}
                  instantApply
                  selectedValues={toSelected(filters.status, statusOptions)}
                  setSelectedValues={(action: SetStateAction<MultiSelectOption[]>) => {
                    const current = toSelected(filters.status, statusOptions);
                    const next = typeof action === "function" ? action(current) : action;
                    list.setFilters({ status: next.length ? (next.map((o) => o.value) as (typeof STATUSES)[number][]) : undefined });
                  }}
                />
                <MultiSelectChecklist
                  label={t("filters.template")}
                  data={templateOptions}
                  isLoading={templates.isLoading}
                  instantApply
                  selectedValues={toSelected(filters.template, templateOptions)}
                  setSelectedValues={(action: SetStateAction<MultiSelectOption[]>) => {
                    const current = toSelected(filters.template, templateOptions);
                    const next = typeof action === "function" ? action(current) : action;
                    list.setFilters({ template: next.length ? next.map((o) => o.value) : undefined });
                  }}
                />
                <div className="flex items-center gap-2">
                  <Switch id="pages-home-only" checked={filters.is_home === "true"} onCheckedChange={(v) => list.setFilters({ is_home: v ? "true" : undefined })} />
                  <Label htmlFor="pages-home-only" className="font-normal">{t("filters.homeOnly")}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="pages-pending-only"
                    checked={filters.has_unpublished_changes === "true"}
                    onCheckedChange={(v) => list.setFilters({ has_unpublished_changes: v ? "true" : undefined })}
                  />
                  <Label htmlFor="pages-pending-only" className="font-normal">{t("filters.pendingOnly")}</Label>
                </div>
              </>
            ) : null}
            {canDelete ? (
              <div className="flex items-center gap-2">
                <Switch
                  id="pages-trash"
                  checked={trashed}
                  onCheckedChange={(v) => {
                    // The trash has its own columns and no status / template filters; its natural order is the newest deletion first.
                    list.setFilters(v ? { trashed: "true", status: undefined, template: undefined, is_home: undefined, has_unpublished_changes: undefined } : { trashed: undefined });
                    list.setSort(v ? "-deleted_at" : undefined);
                  }}
                />
                <Label htmlFor="pages-trash" className="font-normal">{t("trash")}</Label>
              </div>
            ) : null}
          </div>
        }
        primaryAction={
          canCreate ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <PlusIcon />
              {t("create.open")}
            </Button>
          ) : undefined
        }
        emptyTitle={trashed ? t("emptyTrash") : t("empty")}
        emptyDescription={trashed ? undefined : t("emptyHint")}
      />

      <PageCreateDialog open={createOpen} onOpenChange={setCreateOpen} defaultLocale={defaultLocale} />
      <PageSetHomeDialog page={homeTarget} onClose={() => setHomeTarget(null)} onStale={() => void refetch()} />

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
        onConfirm={() => (toDelete ? doDelete(toDelete) : undefined)}
      />
      <ReferencedDialog
        open={referenced !== null}
        onOpenChange={(open) => !open && setReferenced(null)}
        noun={t("noun")}
        items={referenced?.items ?? []}
        total={referenced?.total ?? 0}
        action="delete"
        isPending={deleteMutation.isPending}
        onConfirm={() => (referenced ? doDelete(referenced.page, true) : undefined)}
      />
    </>
  );
}
