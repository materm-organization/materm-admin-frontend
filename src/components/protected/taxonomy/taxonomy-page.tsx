"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { ListPage } from "@/components/global/list/list-page";
import { TaxonomyDialog } from "@/components/protected/taxonomy/taxonomy-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useListParams } from "@/hooks/use-list-params";
import { useLocales } from "@/hooks/use-locales";
import { useCan } from "@/hooks/use-permission";
import {
  useCategories,
  useMutationDeleteCategory,
  useMutationDeleteTag,
  useMutationRestoreCategory,
  useMutationRestoreTag,
  useMutationUpdateCategory,
  useTags,
} from "@/hooks/use-taxonomy";
import { parseApiError } from "@/lib/api-error";
import { PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { ListParamsConfig } from "@/lib/list-params";
import { cn } from "@/lib/utils";
import { etagOfRow } from "@/services/media.api";
import type { Category, CategoriesQuery, Tag, TagsQuery, TaxonomyKind } from "@/types/taxonomy";

const CATEGORIES_CONFIG = {
  filters: {
    is_active: z.enum(["true", "false"]).optional(),
    trashed: z.literal("true").optional(),
  },
  sortable: ["sort_order", "key", "name", "created_at", "updated_at", "deleted_at"],
  defaultSort: "sort_order",
  defaultLimit: 20,
} satisfies ListParamsConfig;

const TAGS_CONFIG = {
  filters: {
    unused: z.literal("true").optional(),
    trashed: z.literal("true").optional(),
  },
  sortable: ["key", "name", "post_count", "created_at", "updated_at", "deleted_at"],
  defaultSort: "key",
  defaultLimit: 20,
} satisfies ListParamsConfig;

type Row = Category | Tag;

// SCR-26 (doc/07 section 3.16): categories and tags as two screens of one family (plain links, not Radix tabs).
export function TaxonomyPage({ kind }: { kind: TaxonomyKind }) {
  const t = useTranslations("taxonomy");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-wide">{t("title")}</h1>
        <p className="mt-1 text-base text-muted-foreground">{t("description")}</p>
      </div>
      <nav aria-label={t("kindsLabel")} className="flex gap-1 border-b">
        {(["categories", "tags"] as const).map((k) => (
          <Link
            key={k}
            href={`/admin/blog/${k}`}
            aria-current={k === kind ? "page" : undefined}
            className={cn("-mb-px border-b-2 border-transparent px-4 py-2 text-sm hover:text-foreground", k === kind ? "border-primary font-medium" : "text-muted-foreground")}
          >
            {t(`kinds.${k}`)}
          </Link>
        ))}
      </nav>
      {kind === "categories" ? <CategoriesList /> : <TagsList />}
    </div>
  );
}

function CategoriesList() {
  const list = useListParams(CATEGORIES_CONFIG);
  const query = useCategories(list.query as CategoriesQuery);
  return <TaxonomyTable kind="categories" list={list} query={query} />;
}
function TagsList() {
  const list = useListParams(TAGS_CONFIG);
  const query = useTags(list.query as TagsQuery);
  return <TaxonomyTable kind="tags" list={list} query={query} />;
}

type Reference = { entity_type: string; id: number; title: string; field: string };

function TaxonomyTable({
  kind,
  list,
  query,
}: {
  kind: TaxonomyKind;
  list: ReturnType<typeof useListParams<never>> | ReturnType<typeof useListParams<typeof CATEGORIES_CONFIG.filters>> | ReturnType<typeof useListParams<typeof TAGS_CONFIG.filters>>;
  query: ReturnType<typeof useCategories> | ReturnType<typeof useTags>;
}) {
  const t = useTranslations("taxonomy");
  const format = useFormatter();
  const { toastError } = useApiErrorHandler();
  const { data: localesData } = useLocales();
  const locales = (localesData?.data ?? []).filter((l) => l.is_active);
  const defaultLocale = localesData?.data.find((l) => l.is_default)?.code ?? "la";

  const canCreate = useCan(PERMISSION_KEYS.CMS_CATEGORIES, "create");
  const canUpdate = useCan(PERMISSION_KEYS.CMS_CATEGORIES, "update");
  const canTranslate = useCan(PERMISSION_KEYS.CMS_CATEGORIES, "translate");
  const canDelete = useCan(PERMISSION_KEYS.CMS_CATEGORIES, "delete");

  const updateCategory = useMutationUpdateCategory();
  const deleteCategory = useMutationDeleteCategory();
  const deleteTag = useMutationDeleteTag();
  const restoreCategory = useMutationRestoreCategory();
  const restoreTag = useMutationRestoreTag();

  const [dialog, setDialog] = useState<{ id: number } | "new" | null>(null);
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [inUse, setInUse] = useState<{ row: Row; references: Reference[]; total: number } | null>(null);

  const filters = list.params.filters as { trashed?: "true"; is_active?: "true" | "false"; unused?: "true" };
  const trashed = filters.trashed === "true";
  const rows = (query.data?.data ?? []) as Row[];
  const canReorder = kind === "categories" && canUpdate && !trashed && list.params.sort === "sort_order" && !list.params.keyword && !filters.is_active;
  const maxSort = kind === "categories" ? Math.max(0, ...(rows as Category[]).map((r) => r.sort_order)) : 0;

  const nameOf = (row: Row) => (row.translations[defaultLocale] ?? Object.values(row.translations)[0])?.name ?? row.key;

  // Order is edited one row at a time (`PATCH {sort_order}`, no order endpoint - C-30): a swap is two PATCHes.
  const swap = async (index: number, delta: -1 | 1) => {
    const a = rows[index] as Category;
    const b = rows[index + delta] as Category | undefined;
    if (!b) return;
    try {
      const sameValue = a.sort_order === b.sort_order;
      await updateCategory.mutateAsync({ id: a.id, payload: { sort_order: sameValue ? a.sort_order + delta : b.sort_order }, etag: etagOfRow(a) });
      if (!sameValue) await updateCategory.mutateAsync({ id: b.id, payload: { sort_order: a.sort_order }, etag: etagOfRow(b) });
    } catch (error) {
      toastError(error, t("toast.reorderFailed"));
    }
  };

  const doDelete = async (row: Row) => {
    try {
      if (kind === "categories") await deleteCategory.mutateAsync({ id: row.id, etag: etagOfRow(row) });
      else await deleteTag.mutateAsync({ id: row.id, etag: etagOfRow(row) });
      toast.success(t("toast.deleted"));
      setToDelete(null);
    } catch (error) {
      setToDelete(null);
      const parsed = parseApiError(error);
      if (parsed.code === "ENTITY_REFERENCED") {
        const details = parsed.details as { references?: Reference[]; total_references?: number } | undefined;
        setInUse({ row, references: details?.references ?? [], total: details?.total_references ?? details?.references?.length ?? 0 });
      } else toastError(error, t("toast.deleteFailed"));
    }
  };

  const doRestore = async (row: Row) => {
    try {
      if (kind === "categories") await restoreCategory.mutateAsync({ id: row.id, etag: etagOfRow(row) });
      else await restoreTag.mutateAsync({ id: row.id, etag: etagOfRow(row) });
      toast.success(t("toast.restored"));
    } catch (error) {
      const parsed = parseApiError(error);
      if (parsed.code === "CONFLICT_DUPLICATE") {
        // The key or a slug was taken meanwhile: say which.
        const where = parsed.fieldErrors.map((f) => (f.path === "/key" ? t("restoreConflict.key") : t("restoreConflict.slug", { locale: f.path.split("/")[2] ?? "" })));
        toast.error(t("toast.restoreDuplicate", { fields: where.join(", ") }));
      } else toastError(error, t("toast.restoreFailed"));
    }
  };

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const cols: ColumnDef<Row>[] = [
      {
        id: "name",
        header: t("columns.name"),
        enableSorting: true,
        cell: ({ row }) =>
          trashed || !(canUpdate || canTranslate) ? (
            <span className="font-medium">{nameOf(row.original)}</span>
          ) : (
            <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => setDialog({ id: row.original.id })}>
              {nameOf(row.original)}
            </button>
          ),
      },
      { id: "key", accessorKey: "key", header: t("columns.key"), enableSorting: true, cell: ({ row }) => <span className="font-mono text-xs">{row.original.key}</span> },
      {
        id: "post_count",
        header: t("columns.posts"),
        enableSorting: kind === "tags",
        cell: ({ row }) => (
          <span title={t("columns.postsTitle", { published: row.original.published_post_count })}>
            {row.original.post_count}
            {row.original.published_post_count > 0 ? <span className="text-muted-foreground"> ({row.original.published_post_count})</span> : null}
          </span>
        ),
      },
    ];
    if (kind === "categories") {
      cols.push(
        { id: "sort_order", header: t("columns.order"), enableSorting: true, cell: ({ row }) => (row.original as Category).sort_order },
        {
          id: "is_active",
          header: t("columns.status"),
          cell: ({ row }) => ((row.original as Category).is_active ? <Badge variant="secondary">{t("active")}</Badge> : <Badge variant="outline">{t("inactive")}</Badge>),
        }
      );
    }
    cols.push({
      id: trashed ? "deleted_at" : "updated_at",
      header: trashed ? t("columns.deleted") : t("columns.updated"),
      enableSorting: true,
      cell: ({ row }) => {
        const v = trashed ? row.original.deleted_at : row.original.updated_at;
        return v ? format.dateTime(new Date(v), { dateStyle: "medium", timeStyle: "short" }) : "";
      },
    });
    cols.push({
      id: "actions",
      header: () => <span className="sr-only">{t("columns.actions")}</span>,
      cell: ({ row, table }) => {
        const r = row.original;
        const index = table.getRowModel().rows.findIndex((x) => x.original.id === r.id);
        const name = nameOf(r);
        return (
          <div className="flex justify-end gap-1">
            {canReorder ? (
              <>
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("actions.moveUp", { name })} disabled={index <= 0 || updateCategory.isPending} onClick={() => void swap(index, -1)}>
                  <ArrowUpIcon />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("actions.moveDown", { name })} disabled={index >= rows.length - 1 || updateCategory.isPending} onClick={() => void swap(index, 1)}>
                  <ArrowDownIcon />
                </Button>
              </>
            ) : null}
            {!trashed && (canUpdate || canTranslate) ? (
              <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("actions.edit", { name })} onClick={() => setDialog({ id: r.id })}>
                <PencilIcon />
              </Button>
            ) : null}
            {!trashed && canDelete ? (
              <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("actions.delete", { name })} onClick={() => setToDelete(r)}>
                <Trash2Icon />
              </Button>
            ) : null}
            {trashed && canDelete ? (
              <Button type="button" variant="outline" size="sm" aria-label={t("actions.restore", { name })} onClick={() => void doRestore(r)}>
                <RotateCcwIcon /> {t("actions.restoreShort")}
              </Button>
            ) : null}
          </div>
        );
      },
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, kind, trashed, canUpdate, canTranslate, canDelete, canReorder, defaultLocale, rows, format, updateCategory.isPending]);

  const nextSort = maxSort + 1;
  const listForPage = list as unknown as Parameters<typeof ListPage<Row>>[0]["list"];

  return (
    <>
      <ListPage<Row>
        list={listForPage}
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
          <div className="flex flex-wrap items-center gap-4">
            {canDelete ? (
              <div className="flex items-center gap-2">
                <Switch id={`trash-${kind}`} checked={trashed} onCheckedChange={(v) => list.setFilters({ trashed: v ? "true" : undefined } as never)} />
                <Label htmlFor={`trash-${kind}`} className="font-normal">{t("trash")}</Label>
              </div>
            ) : null}
            {kind === "tags" ? (
              <div className="flex items-center gap-2">
                <Switch id="unused-tags" checked={filters.unused === "true"} onCheckedChange={(v) => list.setFilters({ unused: v ? "true" : undefined } as never)} />
                <Label htmlFor="unused-tags" className="font-normal">{t("unusedOnly")}</Label>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Switch id="inactive-cats" checked={filters.is_active === "false"} onCheckedChange={(v) => list.setFilters({ is_active: v ? "false" : undefined } as never)} />
                <Label htmlFor="inactive-cats" className="font-normal">{t("inactiveOnly")}</Label>
              </div>
            )}
          </div>
        }
        primaryAction={
          canCreate ? (
            <Button type="button" onClick={() => setDialog("new")}>
              <PlusIcon /> {t(`create.${kind}`)}
            </Button>
          ) : undefined
        }
        emptyTitle={trashed ? t("emptyTrash") : t(`empty.${kind}`)}
      />

      {dialog ? (
        <TaxonomyDialog
          kind={kind}
          target={dialog}
          locales={locales}
          defaultLocale={defaultLocale}
          nextSortOrder={nextSort}
          canUpdate={canUpdate}
          canTranslate={canTranslate}
          onClose={() => setDialog(null)}
        />
      ) : null}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t("delete.title", { name: toDelete ? nameOf(toDelete) : "" })}
        description={t("delete.description")}
        confirmLabel={t("delete.confirm")}
        destructive
        onConfirm={() => (toDelete ? doDelete(toDelete) : undefined)}
      />

      <Dialog open={inUse !== null} onOpenChange={(open) => !open && setInUse(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("inUse.title", { name: inUse ? nameOf(inUse.row) : "" })}</DialogTitle>
            <DialogDescription>{t("inUse.description", { count: inUse?.total ?? 0 })}</DialogDescription>
          </DialogHeader>
          <ul className="max-h-60 list-disc space-y-1 overflow-y-auto pl-5 text-sm">
            {inUse?.references.map((r) => (
              <li key={`${r.entity_type}-${r.id}`}>{r.title}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setInUse(null)}>{t("inUse.close")}</Button>
            {kind === "categories" && canUpdate && inUse && (inUse.row as Category).is_active ? (
              <Button
                type="button"
                onClick={async () => {
                  const row = inUse.row as Category;
                  try {
                    await updateCategory.mutateAsync({ id: row.id, payload: { is_active: false }, etag: etagOfRow(row) });
                    toast.success(t("toast.deactivated"));
                    setInUse(null);
                  } catch (error) {
                    toastError(error, t("toast.saveFailed"));
                  }
                }}
              >
                {t("inUse.deactivate")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
