"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DownloadIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState, type SetStateAction } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { ListPage } from "@/components/global/list/list-page";
import { SingleSelectFilter, type SelectedType } from "@/components/global/single-select-filter";
import { saveBlob } from "@/components/protected/submissions/submissions-export-dialog";
import { RedirectDialog } from "@/components/protected/redirects/redirect-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useListParams } from "@/hooks/use-list-params";
import { useLocales } from "@/hooks/use-locales";
import { useCan } from "@/hooks/use-permission";
import { useMutationDeleteRedirect, useMutationExportRedirects, useRedirects } from "@/hooks/use-redirects";
import { isConflictError } from "@/lib/api-error";
import { PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { ListParamsConfig } from "@/lib/list-params";
import { etagOfRow } from "@/services/media.api";
import type { Redirect, RedirectsQuery } from "@/types/redirects";

const CONFIG = {
  filters: {
    status_code: z.enum(["301", "302", "307", "308"]).optional(),
    // A language code, or `all` = the rows that apply to every language.
    locale_code: z.string().regex(/^([a-z]{2,3}|all)$/).optional(),
    is_active: z.enum(["true", "false"]).optional(),
  },
  sortable: ["source_path", "target", "status_code", "created_at", "updated_at"],
  defaultSort: "source_path",
  defaultLimit: 20,
} satisfies ListParamsConfig;

const facetValue = (value: string | undefined, options: SelectedType[]): SelectedType | null => {
  if (value === undefined) return null;
  return options.find((o) => o.value === value) ?? { value, name: value };
};
const pickFacet = (action: SetStateAction<SelectedType | null>, current: SelectedType | null): string | undefined => {
  const next = typeof action === "function" ? action(current) : action;
  return next?.value;
};

// SCR-42 (doc/07 section 3.26): redirects CRUD + check + CSV export. Save-live: a change is on the website at once.
export function RedirectsPage() {
  const t = useTranslations("redirects");
  const format = useFormatter();
  const { toastError } = useApiErrorHandler();
  const list = useListParams(CONFIG);
  const filters = list.params.filters;
  const query = useRedirects({ ...(list.query as RedirectsQuery) });
  const { data: localesData } = useLocales();
  const activeLocales = useMemo(() => (localesData?.data ?? []).filter((l) => l.is_active), [localesData]);

  const canCreate = useCan(PERMISSION_KEYS.CMS_REDIRECTS, "create");
  const canUpdate = useCan(PERMISSION_KEYS.CMS_REDIRECTS, "update");
  const canDelete = useCan(PERMISSION_KEYS.CMS_REDIRECTS, "delete");
  const canExport = useCan(PERMISSION_KEYS.CMS_REDIRECTS, "export");

  const deleteRedirect = useMutationDeleteRedirect();
  const exporter = useMutationExportRedirects();
  const [dialog, setDialog] = useState<{ id: number } | "new" | null>(null);
  const [toDelete, setToDelete] = useState<Redirect | null>(null);

  const rows = query.data?.data ?? [];

  const statusOptions = useMemo<SelectedType[]>(() => (["301", "302", "307", "308"] as const).map((c) => ({ value: c, name: `${c} - ${t(`status.${c}`)}` })), [t]);
  const localeOptions = useMemo<SelectedType[]>(
    () => [{ value: "all", name: t("allLanguages") }, ...activeLocales.map((l) => ({ value: l.code, name: `${l.native_name} (${l.code})` }))],
    [activeLocales, t]
  );
  const activeOptions = useMemo<SelectedType[]>(() => [{ value: "true", name: t("active") }, { value: "false", name: t("inactive") }], [t]);
  const localeName = (code: string | null) => (code === null ? t("allLanguages") : activeLocales.find((l) => l.code === code)?.native_name ?? code);

  const doDelete = async (row: Redirect) => {
    try {
      await deleteRedirect.mutateAsync({ id: row.id, etag: etagOfRow(row) });
      toast.success(t("toast.deleted"));
      setToDelete(null);
    } catch (error) {
      setToDelete(null);
      if (isConflictError(error)) {
        toast.error(t("toast.stale"));
        void query.refetch();
      } else toastError(error, t("toast.deleteFailed"));
    }
  };

  const doExport = async () => {
    const { page: _p, limit: _l, sort: _s, ...rest } = list.query as RedirectsQuery;
    void _p; void _l; void _s;
    try {
      const file = await exporter.mutateAsync(rest);
      saveBlob(file.blob, file.filename);
      toast.success(t("toast.exported"));
    } catch (error) {
      toastError(error, t("toast.exportFailed"));
    }
  };

  const columns = useMemo<ColumnDef<Redirect>[]>(
    () => [
      {
        id: "source_path",
        header: t("columns.source"),
        enableSorting: true,
        cell: ({ row }) =>
          canUpdate ? (
            <button type="button" className="font-mono text-xs underline-offset-4 hover:underline" onClick={() => setDialog({ id: row.original.id })}>
              {row.original.source_path}
            </button>
          ) : (
            <span className="font-mono text-xs">{row.original.source_path}</span>
          ),
      },
      { id: "target", header: t("columns.target"), enableSorting: true, cell: ({ row }) => <span className="font-mono text-xs break-all whitespace-normal">{row.original.target}</span> },
      { id: "status_code", header: t("columns.code"), enableSorting: true, cell: ({ row }) => row.original.status_code },
      { id: "locale_code", header: t("columns.language"), cell: ({ row }) => localeName(row.original.locale_code) },
      {
        id: "is_active",
        header: t("columns.status"),
        cell: ({ row }) => (row.original.is_active ? <Badge variant="secondary">{t("active")}</Badge> : <Badge variant="outline">{t("inactive")}</Badge>),
      },
      {
        id: "updated_at",
        header: t("columns.updated"),
        enableSorting: true,
        cell: ({ row }) => format.dateTime(new Date(row.original.updated_at), { dateStyle: "medium", timeStyle: "short" }),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("columns.actions")}</span>,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            {canUpdate ? (
              <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("actions.edit", { path: row.original.source_path })} onClick={() => setDialog({ id: row.original.id })}>
                <PencilIcon />
              </Button>
            ) : null}
            {canDelete ? (
              <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("actions.delete", { path: row.original.source_path })} onClick={() => setToDelete(row.original)}>
                <Trash2Icon />
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, canUpdate, canDelete, format, activeLocales]
  );

  return (
    <>
      <ListPage<Redirect>
        title={t("title")}
        description={t("description")}
        list={list as unknown as Parameters<typeof ListPage<Redirect>>[0]["list"]}
        columns={columns}
        data={rows}
        meta={query.data?.meta}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        getRowId={(r) => String(r.id)}
        keywordPlaceholder={t("searchPlaceholder")}
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <SingleSelectFilter
              label={t("filters.code")}
              data={statusOptions}
              selectedValue={facetValue(filters.status_code, statusOptions)}
              setSelectedValue={(a) => list.setFilters({ status_code: pickFacet(a, facetValue(filters.status_code, statusOptions)) as never })}
            />
            <SingleSelectFilter
              label={t("filters.language")}
              data={localeOptions}
              selectedValue={facetValue(filters.locale_code, localeOptions)}
              setSelectedValue={(a) => list.setFilters({ locale_code: pickFacet(a, facetValue(filters.locale_code, localeOptions)) })}
            />
            <SingleSelectFilter
              label={t("filters.status")}
              data={activeOptions}
              selectedValue={facetValue(filters.is_active, activeOptions)}
              setSelectedValue={(a) => list.setFilters({ is_active: pickFacet(a, facetValue(filters.is_active, activeOptions)) as never })}
            />
          </div>
        }
        toolbarActions={
          canExport ? (
            <Button type="button" variant="outline" onClick={() => void doExport()} disabled={exporter.isPending}>
              {exporter.isPending ? <Spinner /> : <DownloadIcon />} {t("export")}
            </Button>
          ) : undefined
        }
        primaryAction={
          canCreate ? (
            <Button type="button" onClick={() => setDialog("new")}>
              <PlusIcon /> {t("create")}
            </Button>
          ) : undefined
        }
        emptyTitle={t("empty")}
      />

      {dialog ? <RedirectDialog target={dialog} locales={activeLocales.map((l) => ({ code: l.code, name: `${l.native_name} (${l.code})` }))} canEdit={dialog === "new" ? canCreate : canUpdate} canRestore={canUpdate} onClose={() => setDialog(null)} /> : null}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t("delete.title", { path: toDelete?.source_path ?? "" })}
        description={t("delete.description")}
        confirmLabel={t("delete.confirm")}
        destructive
        onConfirm={() => (toDelete ? doDelete(toDelete) : undefined)}
      />
    </>
  );
}
