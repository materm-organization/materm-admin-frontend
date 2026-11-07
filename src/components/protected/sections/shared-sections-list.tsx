"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { PlusIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState, type SetStateAction } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ListPage } from "@/components/global/list/list-page";
import { MultiSelectChecklist, type MultiSelectOption } from "@/components/global/multi-select-checklist";
import { StatusBadge } from "@/components/global/status/status-badge";
import { SharedSectionCreateDialog } from "@/components/protected/sections/shared-section-create-dialog";
import { SharedUsagesSheet } from "@/components/protected/sections/shared-usages";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useListParams } from "@/hooks/use-list-params";
import { useCan } from "@/hooks/use-permission";
import { useSectionTypes } from "@/hooks/use-section-types";
import { useSharedSections } from "@/hooks/use-shared-sections";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import { MAX_FILTER_VALUES, type ListParamsConfig } from "@/lib/list-params";
import { SharedSectionsAPI, sharedSectionEtag } from "@/services/shared-sections.api";
import type { SharedSectionListItem, SharedSectionsQuery } from "@/types/shared-sections";

const STATUSES = ["draft", "published", "archived"] as const;
const SORTS = ["name", "updated_at", "created_at", "published_at", "status", "deleted_at"] as const;

const csv = <T extends string>(schema: z.ZodType<T>, max: number) =>
  z.string().transform((v) => v.split(",").filter(Boolean)).pipe(z.array(schema).min(1).max(max)).optional();

// URL state: ?page=&limit=&keyword=&sort=&section_type=gallery_cards&status=draft&has_unpublished_changes=true&in_use=false&trashed=true (05 18.4).
const SHARED_LIST_CONFIG = {
  filters: {
    section_type: csv(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), MAX_FILTER_VALUES),
    status: csv(z.enum(STATUSES), STATUSES.length),
    has_unpublished_changes: z.literal("true").optional(),
    in_use: z.literal("false").optional(),
    trashed: z.literal("true").optional(),
  },
  sortable: [...SORTS],
  defaultSort: "-updated_at",
  defaultLimit: 20,
} satisfies ListParamsConfig;

// SCR-22 list (doc/07 3.14, 05 18.4): the sections that several pages share. "Used in N pages" (+ the pages in the trash) opens the list of pages. Create needs
// `cms.sections:create`; the trash switch needs `cms.sections:delete` (and `read`).
export function SharedSectionsList() {
  const t = useTranslations("sharedSections");
  const tStatus = useTranslations("status.state");
  const tTypes = useTranslations("publishing.sectionTypes");
  const format = useFormatter();
  const { toastError } = useApiErrorHandler();
  const canCreate = useCan(PERMISSION_KEYS.CMS_SECTIONS, PERMISSION_ACTIONS.CREATE);
  const canDelete = useCan(PERMISSION_KEYS.CMS_SECTIONS, PERMISSION_ACTIONS.DELETE);
  const list = useListParams(SHARED_LIST_CONFIG);
  const filters = list.params.filters;
  const trashed = filters.trashed === "true";
  const query = list.query as SharedSectionsQuery;
  const { data, isLoading, isFetching, error, refetch } = useSharedSections(query);
  const types = useSectionTypes({ is_active: true, scope: "shared" });
  const [createOpen, setCreateOpen] = useState(false);
  const [usagesOf, setUsagesOf] = useState<{ id: number; name: string } | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  const typeName = (key: string, fallback: string) => (tTypes.has(key) ? tTypes(key) : fallback);
  const statusOptions = useMemo<MultiSelectOption[]>(() => STATUSES.map((s) => ({ value: s, name: tStatus(s) })), [tStatus]);
  const typeOptions = useMemo<MultiSelectOption[]>(
    () => (types.data?.data ?? []).filter((x) => (x.allowed_scopes ?? ["shared"]).includes("shared")).map((x) => ({ value: x.key, name: typeName(x.key, x.name) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [types.data, tTypes]
  );
  const toSelected = (values: readonly string[] | undefined, options: MultiSelectOption[]) => (values ?? []).map((v) => options.find((o) => o.value === v) ?? { value: v, name: v });

  const restore = async (row: SharedSectionListItem) => {
    setRestoring(row.id);
    try {
      await SharedSectionsAPI.Restore(row.id, sharedSectionEtag(row));
      toast.success(t("restore.done", { name: row.name }));
      void refetch();
    } catch (err) {
      const parsed = parseApiError(err);
      if (isConflictError(err) || parsed.code === "INVALID_STATE") {
        toast.error(t("stale"));
        void refetch();
      } else toastError(err, t("restore.failed"));
    } finally {
      setRestoring(null);
    }
  };

  const columns = useMemo<ColumnDef<SharedSectionListItem>[]>(() => {
    const cols: ColumnDef<SharedSectionListItem>[] = [
      {
        id: "name",
        header: t("columns.name"),
        enableSorting: true,
        cell: ({ row }) => (
          <div className="flex min-w-0 max-w-80 flex-col">
            {trashed ? (
              <span className="truncate font-medium">{row.original.name}</span>
            ) : (
              <Link href={`/admin/sections/${row.original.id}`} className="truncate font-medium underline-offset-4 hover:underline" data-testid={`shared-link-${row.original.id}`}>
                {row.original.name}
              </Link>
            )}
          </div>
        ),
      },
      { id: "type", header: t("columns.type"), cell: ({ row }) => <span className="text-sm">{typeName(row.original.section_type.key, row.original.section_type.name)}</span> },
      {
        id: "status",
        header: t("columns.status"),
        enableSorting: true,
        cell: ({ row }) => <StatusBadge status={row.original.status} hasUnpublishedChanges={row.original.has_unpublished_changes} trashed={Boolean(row.original.deleted_at)} />,
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
        {
          id: "used",
          header: t("columns.usedIn"),
          cell: ({ row }) => {
            const r = row.original;
            const total = r.used_in_pages + r.used_in_trashed_pages;
            if (total === 0) return <span className="text-sm text-muted-foreground" data-testid={`used-in-${r.id}`}>{t("usedIn.none")}</span>;
            return (
              <button
                type="button"
                className="text-start text-sm underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                data-testid={`used-in-${r.id}`}
                aria-label={t("usedIn.open", { name: r.name })}
                onClick={() => setUsagesOf({ id: r.id, name: r.name })}
              >
                {t("usedIn.pages", { count: r.used_in_pages })}
                {r.used_in_trashed_pages > 0 ? <span className="text-muted-foreground"> · {t("usedIn.trashed", { count: r.used_in_trashed_pages })}</span> : null}
              </button>
            );
          },
        },
        {
          id: "updated_at",
          header: t("columns.updated"),
          enableSorting: true,
          cell: ({ row }) => <span className="text-sm">{format.dateTime(new Date(row.original.updated_at), { dateStyle: "medium" })}</span>,
        }
      );
    }
    cols.push({
      id: "actions",
      header: () => <span className="sr-only">{t("columns.actions")}</span>,
      cell: ({ row }) =>
        trashed && canDelete ? (
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" aria-label={t("restore.aria", { name: row.original.name })} disabled={restoring === row.original.id} onClick={() => void restore(row.original)}>
              <RotateCcwIcon />
              {t("restore.button")}
            </Button>
          </div>
        ) : null,
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, format, trashed, canDelete, restoring, tTypes]);

  return (
    <>
      <ListPage<SharedSectionListItem>
        title={t("title")}
        description={t("description")}
        list={list}
        columns={columns}
        data={data?.data ?? []}
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
                  label={t("filters.type")}
                  data={typeOptions}
                  isLoading={types.isLoading}
                  selectedValues={toSelected(filters.section_type, typeOptions)}
                  setSelectedValues={(action: SetStateAction<MultiSelectOption[]>) => {
                    const next = typeof action === "function" ? action(toSelected(filters.section_type, typeOptions)) : action;
                    list.setFilters({ section_type: next.length ? next.map((o) => o.value) : undefined });
                  }}
                />
                <MultiSelectChecklist
                  label={t("filters.status")}
                  data={statusOptions}
                  selectedValues={toSelected(filters.status, statusOptions)}
                  setSelectedValues={(action: SetStateAction<MultiSelectOption[]>) => {
                    const next = typeof action === "function" ? action(toSelected(filters.status, statusOptions)) : action;
                    list.setFilters({ status: next.length ? (next.map((o) => o.value) as (typeof STATUSES)[number][]) : undefined });
                  }}
                />
                <div className="flex items-center gap-2">
                  <Switch id="shared-pending-only" checked={filters.has_unpublished_changes === "true"} onCheckedChange={(v) => list.setFilters({ has_unpublished_changes: v ? "true" : undefined })} />
                  <Label htmlFor="shared-pending-only" className="font-normal">{t("filters.pending")}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="shared-unused-only" checked={filters.in_use === "false"} onCheckedChange={(v) => list.setFilters({ in_use: v ? "false" : undefined })} />
                  <Label htmlFor="shared-unused-only" className="font-normal">{t("filters.unused")}</Label>
                </div>
              </>
            ) : null}
            {canDelete ? (
              <div className="flex items-center gap-2">
                <Switch
                  id="shared-trash"
                  checked={trashed}
                  onCheckedChange={(v) => {
                    list.setFilters(v ? { trashed: "true", section_type: undefined, status: undefined, has_unpublished_changes: undefined, in_use: undefined } : { trashed: undefined });
                    list.setSort(v ? "-deleted_at" : undefined);
                  }}
                />
                <Label htmlFor="shared-trash" className="font-normal">{t("trash")}</Label>
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
      <SharedSectionCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      <SharedUsagesSheet section={usagesOf} open={usagesOf !== null} onOpenChange={(open) => !open && setUsagesOf(null)} />
    </>
  );
}
