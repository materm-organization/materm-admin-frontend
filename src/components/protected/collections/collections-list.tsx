"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { EllipsisIcon, EyeIcon, ListIcon, PencilIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { ListPage } from "@/components/global/list/list-page";
import { CollectionCreateDialog } from "@/components/protected/collections/collection-create-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useCollections, useMutationDeleteCollection, useMutationRestoreCollection } from "@/hooks/use-collections";
import { useListParams } from "@/hooks/use-list-params";
import { useCan } from "@/hooks/use-permission";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { COLLECTION_SORTS } from "@/lib/collections/constants";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { ListParamsConfig } from "@/lib/list-params";
import type { CollectionListItem, CollectionsQuery } from "@/types/collections";
import { z } from "zod";

// URL state: ?page=&limit=&keyword=&sort=&trashed=true
const COLLECTIONS_LIST_CONFIG = {
  filters: { trashed: z.literal("true").optional() },
  sortable: [...COLLECTION_SORTS],
  defaultSort: "sort_order",
  defaultLimit: 20,
} satisfies ListParamsConfig;

// SCR-40 list (doc/07 3.25): the content types the administrators defined. Create / delete / the trash need `manage_schema`; everyone with `read`
// sees the list and opens the entries.
export function CollectionsList() {
  const t = useTranslations("collections");
  const format = useFormatter();
  const router = useRouter();
  const { toastError } = useApiErrorHandler();
  const canManage = useCan(PERMISSION_KEYS.CMS_COLLECTIONS, PERMISSION_ACTIONS.MANAGE_SCHEMA);
  const list = useListParams(COLLECTIONS_LIST_CONFIG);
  const trashed = list.params.filters.trashed === "true";
  const query = list.query as CollectionsQuery;
  const { data, isLoading, isFetching, error, refetch } = useCollections(query);
  const deleteMutation = useMutationDeleteCollection();
  const restoreMutation = useMutationRestoreCollection();
  const [createOpen, setCreateOpen] = useState(false);
  const [toDelete, setToDelete] = useState<CollectionListItem | null>(null);
  const [blocked, setBlocked] = useState<{ collection: CollectionListItem; count: number } | null>(null);

  const stale = () => {
    toast.error(t("stale"));
    void refetch();
  };
  const doDelete = async (c: CollectionListItem) => {
    try {
      await deleteMutation.mutateAsync({ key: c.key, etag: c.etag });
      toast.success(t("delete.done", { name: c.name }));
      setToDelete(null);
    } catch (err) {
      setToDelete(null);
      const parsed = parseApiError(err);
      if (parsed.code === "ENTITY_REFERENCED" && parsed.details?.reason === "collection_has_entries") setBlocked({ collection: c, count: Number(parsed.details.entry_count ?? c.entry_count) });
      else if (isConflictError(err)) stale();
      else toastError(err, t("delete.failed"));
    }
  };
  const doRestore = async (c: CollectionListItem) => {
    try {
      await restoreMutation.mutateAsync({ key: c.key, etag: c.etag });
      toast.success(t("restore.done", { name: c.name }));
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.code === "CONFLICT_DUPLICATE") toast.error(t("restore.duplicate", { key: c.key }));
      else if (isConflictError(err) || parsed.code === "INVALID_STATE") stale();
      else toastError(err, t("restore.failed"));
    }
  };

  const columns = useMemo<ColumnDef<CollectionListItem>[]>(() => {
    const cols: ColumnDef<CollectionListItem>[] = [
      {
        id: "name",
        header: t("columns.name"),
        enableSorting: true,
        cell: ({ row }) => {
          const c = row.original;
          return (
            <div className="flex min-w-0 max-w-80 flex-col">
              {trashed ? (
                <span className="truncate font-medium">{c.name}</span>
              ) : (
                <Link href={`/admin/collections/${encodeURIComponent(c.key)}`} className="truncate font-medium underline-offset-4 hover:underline">
                  {c.name}
                </Link>
              )}
              <span className="truncate font-mono text-xs text-muted-foreground">{c.key}</span>
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
        { id: "entries", header: t("columns.entries"), cell: ({ row }) => <span className="tabular-nums">{t("entriesCount", { total: row.original.entry_count, published: row.original.published_entry_count })}</span> },
        {
          id: "state",
          header: t("columns.state"),
          cell: ({ row }) => (row.original.is_active ? <Badge variant="secondary">{t("active")}</Badge> : <Badge variant="outline">{t("inactive")}</Badge>),
        },
        { id: "schema", header: t("columns.schema"), cell: ({ row }) => <span className="tabular-nums text-muted-foreground">v{row.original.schema_version}</span> },
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
      cell: ({ row }) => {
        const c = row.original;
        if (trashed) {
          return canManage ? (
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" aria-label={t("actions.restore", { name: c.name })} disabled={restoreMutation.isPending} onClick={() => void doRestore(c)}>
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
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("actions.menu", { name: c.name })}>
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`/admin/collections/${encodeURIComponent(c.key)}`}>
                    <ListIcon />
                    {t("actions.entries")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/admin/collections/${encodeURIComponent(c.key)}/schema`}>
                    {canManage ? <PencilIcon /> : <EyeIcon />}
                    {canManage ? t("actions.editSchema") : t("actions.viewSchema")}
                  </Link>
                </DropdownMenuItem>
                {canManage ? <DropdownMenuSeparator /> : null}
                {canManage ? (
                  <DropdownMenuItem variant="destructive" onSelect={() => setToDelete(c)}>
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
  }, [t, format, trashed, canManage, restoreMutation.isPending]);

  return (
    <>
      <ListPage<CollectionListItem>
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
          canManage ? (
            <div className="flex items-center gap-2">
              <Switch id="collections-trash" checked={trashed} onCheckedChange={(v) => list.setFilters({ trashed: v ? "true" : undefined })} />
              <Label htmlFor="collections-trash" className="font-normal">{t("trash")}</Label>
            </div>
          ) : undefined
        }
        primaryAction={
          canManage ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <PlusIcon />
              {t("create.open")}
            </Button>
          ) : undefined
        }
        emptyTitle={trashed ? t("emptyTrash") : t("empty")}
        emptyDescription={trashed ? undefined : t("emptyHint")}
      />
      <CollectionCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t("delete.title", { name: toDelete?.name ?? "" })}
        description={t("delete.description")}
        confirmLabel={t("delete.confirm")}
        destructive
        isPending={deleteMutation.isPending}
        onConfirm={() => (toDelete ? doDelete(toDelete) : undefined)}
      />
      <ConfirmDialog
        open={blocked !== null}
        onOpenChange={(open) => !open && setBlocked(null)}
        title={t("blocked.title")}
        description={t("blocked.body", { name: blocked?.collection.name ?? "", count: blocked?.count ?? 0 })}
        confirmLabel={t("blocked.open")}
        onConfirm={() => {
          if (blocked) router.push(`/admin/collections/${encodeURIComponent(blocked.collection.key)}`);
        }}
      />
    </>
  );
}
