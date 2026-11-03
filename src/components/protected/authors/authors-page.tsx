"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { PencilIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState, type SetStateAction } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { ListPage } from "@/components/global/list/list-page";
import { SingleSelectFilter, type SelectedType } from "@/components/global/single-select-filter";
import { AuthorDialog } from "@/components/protected/authors/author-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useAuthors, useMutationDeleteAuthor, useMutationRestoreAuthor } from "@/hooks/use-authors";
import { useListParams } from "@/hooks/use-list-params";
import { useLocales } from "@/hooks/use-locales";
import { useCan } from "@/hooks/use-permission";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { ListParamsConfig } from "@/lib/list-params";
import { etagOfRow } from "@/services/media.api";
import type { Author, AuthorsQuery } from "@/types/authors";

const CONFIG = {
  filters: {
    is_active: z.enum(["true", "false"]).optional(),
    has_user: z.enum(["true", "false"]).optional(),
    trashed: z.literal("true").optional(),
  },
  sortable: ["display_name", "post_count", "created_at", "updated_at", "deleted_at"],
  defaultSort: "display_name",
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
const initials = (name: string) => [...name.trim()].slice(0, 2).join("").toUpperCase();

// SCR-27 (doc/07 section 3.16): authors = the byline of a post. Save-live; delete is a soft delete into the 30-day trash and is refused
// while posts still use the author (409 ENTITY_REFERENCED, details.reason = author_has_posts).
export function AuthorsPage() {
  const t = useTranslations("authors");
  const format = useFormatter();
  const { toastError } = useApiErrorHandler();
  const list = useListParams(CONFIG);
  const filters = list.params.filters;
  const query = useAuthors({ ...(list.query as AuthorsQuery) });
  const { data: localesData } = useLocales();
  const locales = useMemo(() => (localesData?.data ?? []).filter((l) => l.is_active), [localesData]);
  const defaultLocale = localesData?.data.find((l) => l.is_default)?.code ?? "la";

  const canCreate = useCan(PERMISSION_KEYS.CMS_BLOG, "create");
  const canUpdate = useCan(PERMISSION_KEYS.CMS_BLOG, "update");
  const canTranslate = useCan(PERMISSION_KEYS.CMS_BLOG, "translate");
  const canDelete = useCan(PERMISSION_KEYS.CMS_BLOG, "delete");
  const trashed = filters.trashed === "true";

  const deleteAuthor = useMutationDeleteAuthor();
  const restoreAuthor = useMutationRestoreAuthor();
  const [dialog, setDialog] = useState<{ id: number } | "new" | null>(null);
  const [toDelete, setToDelete] = useState<Author | null>(null);
  const [blocked, setBlocked] = useState<{ row: Author; postCount: number } | null>(null);

  const rows = query.data?.data ?? [];
  const activeOptions = useMemo<SelectedType[]>(() => [{ value: "true", name: t("active") }, { value: "false", name: t("inactive") }], [t]);
  const userOptions = useMemo<SelectedType[]>(() => [{ value: "true", name: t("filters.withUser") }, { value: "false", name: t("filters.withoutUser") }], [t]);
  const jobOf = (row: Author) => (row.translations[defaultLocale]?.job_title ?? Object.values(row.translations).find((x) => x.job_title)?.job_title) ?? "";

  const doDelete = async (row: Author) => {
    try {
      await deleteAuthor.mutateAsync({ id: row.id, etag: etagOfRow(row) });
      toast.success(t("toast.deleted"));
      setToDelete(null);
    } catch (error) {
      setToDelete(null);
      const parsed = parseApiError(error);
      if (parsed.code === "ENTITY_REFERENCED" && parsed.details?.reason === "author_has_posts") {
        const count = typeof parsed.details.post_count === "number" ? parsed.details.post_count : row.post_count;
        setBlocked({ row, postCount: count });
        // The count on the page was stale: take the real one.
        void query.refetch();
      } else if (isConflictError(error)) {
        toast.error(t("toast.stale"));
        void query.refetch();
      } else toastError(error, t("toast.deleteFailed"));
    }
  };

  const doRestore = async (row: Author) => {
    try {
      await restoreAuthor.mutateAsync({ id: row.id, etag: etagOfRow(row) });
      toast.success(t("toast.restored"));
    } catch (error) {
      const parsed = parseApiError(error);
      if (isConflictError(error)) {
        toast.error(t("toast.stale"));
        void query.refetch();
      } else if (parsed.code === "CONFLICT_DUPLICATE") toast.error(t("toast.restoreDuplicate"));
      else toastError(error, t("toast.restoreFailed"));
    }
  };

  const columns = useMemo<ColumnDef<Author>[]>(
    () => [
      {
        id: "display_name",
        header: t("columns.name"),
        enableSorting: true,
        cell: ({ row }) => {
          const a = row.original;
          const label =
            trashed || !(canUpdate || canTranslate) ? (
              <span className="font-medium">{a.display_name}</span>
            ) : (
              <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => setDialog({ id: a.id })}>
                {a.display_name}
              </button>
            );
          return (
            <div className="flex items-center gap-3">
              <Avatar size="lg">
                {a.avatar?.url ? <AvatarImage src={a.avatar.url} alt="" /> : null}
                <AvatarFallback>{initials(a.display_name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 leading-snug">
                {label}
                {jobOf(a) ? <p className="text-xs text-muted-foreground">{jobOf(a)}</p> : null}
              </div>
            </div>
          );
        },
      },
      {
        id: "user",
        header: t("columns.user"),
        cell: ({ row }) =>
          row.original.user ? (
            <span>
              {row.original.user.name} <span className="text-xs text-muted-foreground">({row.original.user.username})</span>
            </span>
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
      {
        id: "post_count",
        header: t("columns.posts"),
        enableSorting: true,
        cell: ({ row }) => (
          <span title={t("columns.postsTitle", { published: row.original.published_post_count })}>
            {row.original.post_count}
            {row.original.published_post_count > 0 ? <span className="text-muted-foreground"> ({row.original.published_post_count})</span> : null}
          </span>
        ),
      },
      {
        id: "is_active",
        header: t("columns.status"),
        cell: ({ row }) => (row.original.is_active ? <Badge variant="secondary">{t("active")}</Badge> : <Badge variant="outline">{t("inactive")}</Badge>),
      },
      {
        id: trashed ? "deleted_at" : "updated_at",
        header: trashed ? t("columns.deleted") : t("columns.updated"),
        enableSorting: true,
        cell: ({ row }) => {
          const v = trashed ? row.original.deleted_at : row.original.updated_at;
          return v ? format.dateTime(new Date(v), { dateStyle: "medium", timeStyle: "short" }) : "";
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("columns.actions")}</span>,
        cell: ({ row }) => {
          const a = row.original;
          return (
            <div className="flex justify-end gap-1">
              {!trashed && (canUpdate || canTranslate) ? (
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("actions.edit", { name: a.display_name })} onClick={() => setDialog({ id: a.id })}>
                  <PencilIcon />
                </Button>
              ) : null}
              {!trashed && canDelete ? (
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("actions.delete", { name: a.display_name })} onClick={() => setToDelete(a)}>
                  <Trash2Icon />
                </Button>
              ) : null}
              {trashed && canDelete ? (
                <Button type="button" variant="outline" size="sm" aria-label={t("actions.restore", { name: a.display_name })} onClick={() => void doRestore(a)}>
                  <RotateCcwIcon /> {t("actions.restoreShort")}
                </Button>
              ) : null}
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, trashed, canUpdate, canTranslate, canDelete, format, defaultLocale]
  );

  return (
    <>
      <ListPage<Author>
        title={t("title")}
        description={t("description")}
        list={list as unknown as Parameters<typeof ListPage<Author>>[0]["list"]}
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
            {canDelete ? (
              <div className="flex items-center gap-2">
                <Switch id="trash-authors" checked={trashed} onCheckedChange={(v) => list.setFilters({ trashed: v ? "true" : undefined } as never)} />
                <Label htmlFor="trash-authors" className="font-normal">
                  {t("trash")}
                </Label>
              </div>
            ) : null}
            <SingleSelectFilter
              label={t("filters.status")}
              data={activeOptions}
              selectedValue={facetValue(filters.is_active, activeOptions)}
              setSelectedValue={(a) => list.setFilters({ is_active: pickFacet(a, facetValue(filters.is_active, activeOptions)) as never })}
            />
            <SingleSelectFilter
              label={t("filters.user")}
              data={userOptions}
              selectedValue={facetValue(filters.has_user, userOptions)}
              setSelectedValue={(a) => list.setFilters({ has_user: pickFacet(a, facetValue(filters.has_user, userOptions)) as never })}
            />
          </div>
        }
        primaryAction={
          canCreate && !trashed ? (
            <Button type="button" onClick={() => setDialog("new")}>
              <PlusIcon /> {t("create")}
            </Button>
          ) : undefined
        }
        emptyTitle={trashed ? t("emptyTrash") : t("empty")}
      />

      {dialog ? (
        <AuthorDialog
          target={dialog}
          locales={locales.map((l) => ({ code: l.code, name: `${l.native_name} (${l.code})`, is_default: l.is_default }))}
          defaultLocale={defaultLocale}
          canCreate={canCreate}
          canUpdate={canUpdate}
          canTranslate={canTranslate}
          onClose={() => setDialog(null)}
        />
      ) : null}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t("delete.title", { name: toDelete?.display_name ?? "" })}
        description={t("delete.description")}
        confirmLabel={t("delete.confirm")}
        destructive
        onConfirm={() => (toDelete ? doDelete(toDelete) : undefined)}
      />

      <Dialog open={blocked !== null} onOpenChange={(open) => !open && setBlocked(null)}>
        <DialogContent data-testid="author-has-posts">
          <DialogHeader>
            <DialogTitle>{t("blocked.title", { name: blocked?.row.display_name ?? "" })}</DialogTitle>
            <DialogDescription>{t("blocked.description", { count: blocked?.postCount ?? 0 })}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("blocked.hint")}</p>
          <DialogFooter>
            <Button type="button" onClick={() => setBlocked(null)}>
              {t("blocked.close")}
            </Button>
            {canUpdate && blocked?.row.is_active ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const row = blocked.row;
                  setBlocked(null);
                  setDialog({ id: row.id });
                }}
              >
                {t("blocked.edit")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
