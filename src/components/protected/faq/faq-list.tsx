"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { EllipsisIcon, EyeIcon, LockIcon, PencilIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState, type SetStateAction } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { ListPage } from "@/components/global/list/list-page";
import { MultiSelectChecklist, type MultiSelectOption } from "@/components/global/multi-select-checklist";
import { StatusBadge } from "@/components/global/status/status-badge";
import { FaqCreateDialog } from "@/components/protected/faq/faq-create-dialog";
import { ReferencesBlockedDialog, type BlockingReference } from "@/components/protected/albums/references-blocked-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useFaqGroups, useMutationDeleteFaqGroup, useMutationRestoreFaqGroup } from "@/hooks/use-faq";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useFetchCurrentUser } from "@/hooks/use-auth";
import { useListParams } from "@/hooks/use-list-params";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { ListParamsConfig } from "@/lib/list-params";
import { userCan } from "@/lib/permissions";
import { faqGroupEtag } from "@/services/faq.api";
import type { FaqGroupListItem, FaqGroupsQuery } from "@/types/faq";

const STATUSES = ["draft", "published", "archived"] as const;

const csv = <T,>(schema: z.ZodType<T>, max: number) =>
  z.string().transform((v) => v.split(",").filter(Boolean)).pipe(z.array(schema).min(1).max(max)).optional();

// URL state of the list: ?page=&limit=&keyword=&sort=&status=draft,published&has_unpublished_changes=true&trashed=true
// (doc/07 sections 2.5.1 and 3.18). `sort` is the allow-list of GET /faq-groups.
const FAQ_LIST_CONFIG = {
  filters: {
    status: csv(z.enum(STATUSES), STATUSES.length),
    has_unpublished_changes: z.literal("true").optional(),
    trashed: z.literal("true").optional(),
  },
  sortable: ["key", "name", "status", "updated_at"],
  defaultSort: "key",
  defaultLimit: 20,
} satisfies ListParamsConfig;

// SCR-30 (doc/07 section 3.18): the FAQ groups of the website. Create (a dialog), open (the editor), move to the trash (30 days) and restore
// from it. A group a `faq` section names (by `group_key`) can not be deleted: the server answers 409 `ENTITY_REFERENCED` and the dialog lists the pages.
export function FaqList() {
  const t = useTranslations("faq");
  const format = useFormatter();
  const { toastError } = useApiErrorHandler();
  const me = useFetchCurrentUser().data?.data;

  const can = (action: string) => userCan(me?.permissions, PERMISSION_KEYS.CMS_FAQ, action);
  const canCreate = can(PERMISSION_ACTIONS.CREATE);
  const canDelete = can(PERMISSION_ACTIONS.DELETE);
  const canEdit = can(PERMISSION_ACTIONS.UPDATE) || can(PERMISSION_ACTIONS.TRANSLATE);

  const list = useListParams(FAQ_LIST_CONFIG);
  const filters = list.params.filters;
  const trashed = filters.trashed === "true";
  const query = list.query as FaqGroupsQuery;
  const { data, isLoading, isFetching, error, refetch } = useFaqGroups(query);

  const deleteMutation = useMutationDeleteFaqGroup();
  const restoreMutation = useMutationRestoreFaqGroup();

  const [createOpen, setCreateOpen] = useState(false);
  const [toDelete, setToDelete] = useState<FaqGroupListItem | null>(null);
  const [blocked, setBlocked] = useState<{ group: FaqGroupListItem; references: BlockingReference[]; total: number } | null>(null);

  const titleOf = (a: FaqGroupListItem) => a.name;
  const statusOptions = useMemo<MultiSelectOption[]>(() => STATUSES.map((s) => ({ value: s, name: t(`status.${s}`) })), [t]);
  const toSelected = (values: readonly string[] | undefined, options: MultiSelectOption[]) =>
    (values ?? []).map((v) => options.find((o) => o.value === v) ?? { value: v, name: v });

  // A row the user acted on is out of date (someone else changed it): say so and reload the list.
  const stale = () => {
    toast.error(t("stale"));
    void refetch();
  };

  const doDelete = async (group: FaqGroupListItem) => {
    try {
      await deleteMutation.mutateAsync({ id: group.id, etag: faqGroupEtag(group) });
      toast.success(t("delete.done", { title: titleOf(group) }));
      setToDelete(null);
    } catch (err) {
      setToDelete(null);
      const parsed = parseApiError(err);
      if (parsed.code === "ENTITY_REFERENCED" && parsed.status === 409) {
        const details = (parsed.details ?? {}) as { references?: BlockingReference[]; total_references?: number };
        setBlocked({ group: group, references: details.references ?? [], total: details.total_references ?? details.references?.length ?? 0 });
      } else if (isConflictError(err) || (parsed.code === "INVALID_STATE" && parsed.status === 409)) stale();
      else toastError(err, t("delete.failed"));
    }
  };

  const doRestore = async (group: FaqGroupListItem) => {
    try {
      await restoreMutation.mutateAsync({ id: group.id, etag: faqGroupEtag(group) });
      toast.success(t("restore.done", { title: titleOf(group) }));
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.code === "CONFLICT_DUPLICATE") toast.error(t("restore.duplicate", { key: group.key }));
      else if (isConflictError(err) || (parsed.code === "INVALID_STATE" && parsed.status === 409)) stale();
      else toastError(err, t("restore.failed"));
    }
  };

  const columns = useMemo<ColumnDef<FaqGroupListItem>[]>(() => {
    const cols: ColumnDef<FaqGroupListItem>[] = [
      {
        id: "name",
        header: t("columns.name"),
        enableSorting: true,
        cell: ({ row }) => {
          const a = row.original;
          return (
            <div className="flex min-w-0 max-w-72 items-center gap-3">
              <div className="flex min-w-0 flex-col">
                <div className="flex min-w-0 items-center gap-2">
                  {trashed ? (
                    <span className="truncate font-medium">{titleOf(a)}</span>
                  ) : (
                    <Link href={`/admin/faq/${a.id}`} className="truncate font-medium underline-offset-4 hover:underline">
                      {titleOf(a)}
                    </Link>
                  )}
                  {!trashed && !canEdit ? <LockIcon className="size-3.5 shrink-0 text-muted-foreground" role="img" aria-label={t("readOnly")} /> : null}
                </div>
                <span className="truncate font-mono text-xs text-muted-foreground">{a.key}</span>
              </div>
            </div>
          );
        },
      },
    ];
    if (trashed) {
      cols.push({
        id: "deleted_at",
        header: t("columns.deleted"),
        cell: ({ row }) => {
          const a = row.original;
          return (
            <div className="text-sm">
              <div>{a.deleted_at ? format.dateTime(new Date(a.deleted_at), { dateStyle: "medium", timeStyle: "short" }) : ""}</div>
              {a.purge_at ? <div className="text-xs text-muted-foreground">{t("purgeOn", { when: format.dateTime(new Date(a.purge_at), { dateStyle: "medium" }) })}</div> : null}
            </div>
          );
        },
      });
    } else {
      cols.push(
        { id: "status", header: t("columns.status"), enableSorting: true, cell: ({ row }) => <StatusBadge status={row.original.status} hasUnpublishedChanges={row.original.has_unpublished_changes} /> },
        {
          id: "items",
          header: t("columns.items"),
          cell: ({ row }) => <span className="tabular-nums" title={t("visibleOf", { visible: row.original.visible_item_count, count: row.original.item_count })}>{row.original.item_count === row.original.visible_item_count ? row.original.item_count : t("visibleShort", { visible: row.original.visible_item_count, count: row.original.item_count })}</span>,
        },
        {
          id: "usage",
          header: t("columns.usage"),
          cell: ({ row }) =>
            row.original.usage_count > 0 ? t("usedIn", { count: row.original.usage_count }) : <span className="text-muted-foreground">{t("unused")}</span>,
        },
        {
          id: "updated_at",
          header: t("columns.updated"),
          enableSorting: true,
          cell: ({ row }) => {
            const a = row.original;
            return (
              <div className="text-sm">
                <div title={format.dateTime(new Date(a.updated_at), { dateStyle: "medium", timeStyle: "short" })}>{format.dateTime(new Date(a.updated_at), { dateStyle: "medium" })}</div>
                {a.updated_by?.name ? <div className="text-xs text-muted-foreground">{a.updated_by.name}</div> : null}
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
        const a = row.original;
        const name = titleOf(a);
        if (trashed) {
          return canDelete ? (
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" aria-label={t("actions.restore", { name })} disabled={restoreMutation.isPending} onClick={() => void doRestore(a)}>
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
                  <Link href={`/admin/faq/${a.id}`}>
                    {canEdit ? <PencilIcon /> : <EyeIcon />}
                    {canEdit ? t("actions.open") : t("actions.view")}
                  </Link>
                </DropdownMenuItem>
                {canDelete ? <DropdownMenuSeparator /> : null}
                {canDelete ? (
                  <DropdownMenuItem variant="destructive" onSelect={() => setToDelete(a)}>
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
  }, [t, format, trashed, canEdit, canDelete, restoreMutation.isPending]);

  return (
    <>
      <ListPage<FaqGroupListItem>
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
                  label={t("filters.status")}
                  data={statusOptions}
                  instantApply
                  selectedValues={toSelected(filters.status, statusOptions)}
                  setSelectedValues={(action: SetStateAction<MultiSelectOption[]>) => {
                    const next = typeof action === "function" ? action(toSelected(filters.status, statusOptions)) : action;
                    list.setFilters({ status: next.length ? (next.map((o) => o.value) as (typeof STATUSES)[number][]) : undefined });
                  }}
                />
                <div className="flex items-center gap-2">
                  <Switch id="faq-pending-only" checked={filters.has_unpublished_changes === "true"} onCheckedChange={(v) => list.setFilters({ has_unpublished_changes: v ? "true" : undefined })} />
                  <Label htmlFor="faq-pending-only" className="font-normal">{t("filters.pendingOnly")}</Label>
                </div>
              </>
            ) : null}
            {canDelete ? (
              <div className="flex items-center gap-2">
                <Switch
                  id="faq-trash"
                  checked={trashed}
                  onCheckedChange={(v) => {
                    list.setFilters(v ? { trashed: "true", status: undefined, has_unpublished_changes: undefined } : { trashed: undefined });
                  }}
                />
                <Label htmlFor="faq-trash" className="font-normal">{t("trash")}</Label>
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

      <FaqCreateDialog open={createOpen} onOpenChange={setCreateOpen} />

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
      <ReferencesBlockedDialog
        open={blocked !== null}
        onOpenChange={(open) => !open && setBlocked(null)}
        kind="faqGroup"
        name={blocked ? titleOf(blocked.group) : ""}
        references={blocked?.references ?? []}
        total={blocked?.total ?? 0}
      />
    </>
  );
}
