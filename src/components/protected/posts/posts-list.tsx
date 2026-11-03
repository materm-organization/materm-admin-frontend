"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { EllipsisIcon, EyeIcon, LockIcon, PencilIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type SetStateAction } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { ListPage } from "@/components/global/list/list-page";
import { MultiSelectChecklist, type MultiSelectOption } from "@/components/global/multi-select-checklist";
import { PreviewLinkDialog } from "@/components/global/publishing/preview-link-dialog";
import { SingleSelectFilter, type SelectedType } from "@/components/global/single-select-filter";
import { StatusBadge } from "@/components/global/status/status-badge";
import { TranslationBadges } from "@/components/global/status/translation-badges";
import { PostCreateDialog } from "@/components/protected/posts/post-create-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useFetchCurrentUser } from "@/hooks/use-auth";
import { useListParams } from "@/hooks/use-list-params";
import { useLocales } from "@/hooks/use-locales";
import { useMutationDeletePost, useMutationRestorePost, usePosts } from "@/hooks/use-posts";
import { useCategories, useTags } from "@/hooks/use-taxonomy";
import { useUsers } from "@/hooks/use-users";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import { MAX_FILTER_VALUES, type ListParamsConfig } from "@/lib/list-params";
import { userCan } from "@/lib/permissions";
import { postEtag } from "@/services/posts.api";
import type { PostListItem, PostsQuery } from "@/types/posts";

const STATUSES = ["draft", "published", "archived"] as const;
const POST_FIELDS = ["title", "excerpt", "seo_title"] as const;

const csv = <T,>(schema: z.ZodType<T>, max: number) =>
  z.string().transform((v) => v.split(",").filter(Boolean)).pipe(z.array(schema).min(1).max(max)).optional();
const positiveInt = z.string().regex(/^[1-9]\d{0,8}$/).transform(Number).optional();

// URL state of the list: ?page=&limit=&keyword=&sort=&status=draft,published&category_id=2&tag_id=1,3&created_by=6&locale=en&
// has_unpublished_changes=true&trashed=true (doc/07 sections 2.5.1 and 3.15). `sort` is the allow-list of GET /posts.
const POSTS_LIST_CONFIG = {
  filters: {
    status: csv(z.enum(STATUSES), STATUSES.length),
    category_id: positiveInt,
    tag_id: csv(z.coerce.number().int().positive(), 5),
    created_by: positiveInt,
    locale: z.string().regex(/^[a-z]{2,3}$/).optional(),
    has_unpublished_changes: z.literal("true").optional(),
    trashed: z.literal("true").optional(),
  },
  sortable: ["title", "status", "updated_at", "created_at", "deleted_at"],
  defaultSort: "-updated_at",
  defaultLimit: 20,
} satisfies ListParamsConfig;

// The one chip value of a single-select filter (value, name) and what a click on it means (`undefined` = cleared).
const facetValue = (value: string | number | undefined, options: SelectedType[]): SelectedType | null => {
  if (value === undefined) return null;
  return options.find((o) => o.value === String(value)) ?? { value: String(value), name: String(value) };
};
const pickFacet = (action: SetStateAction<SelectedType | null>, current: SelectedType | null): string | undefined => {
  const next = typeof action === "function" ? action(current) : action;
  return next?.value;
};

// SCR-24 (doc/07 section 3.15): the posts of the blog. Create (a dialog), open (the editor is SCR-25), preview link, move to
// the trash (30 days) and restore from it. Filters (status, category, tag, author, language of the texts, "pending changes") and the
// trash switch are in the URL. A person with `update_own` / `delete_own` only is offered those actions on their own posts.
export function PostsList() {
  const t = useTranslations("posts");
  const format = useFormatter();
  const ui = useLocale();
  const { toastError } = useApiErrorHandler();
  const me = useFetchCurrentUser().data?.data;
  const locales = useLocales();
  const defaultLocale = locales.data?.data.find((l) => l.is_default)?.code ?? "la";
  const activeLocales = (locales.data?.data ?? []).filter((l) => l.is_active).sort((a, b) => a.sort_order - b.sort_order);

  // Rights by row: `update` / `delete` or their `_own` variants for my own post (05 13.3.2).
  const can = (action: string, owner?: number | null) => userCan(me?.permissions, PERMISSION_KEYS.CMS_BLOG, action, { ownerId: owner, currentUserId: me?.id });
  const canCreate = can(PERMISSION_ACTIONS.CREATE);
  const canTranslate = can(PERMISSION_ACTIONS.TRANSLATE);
  const canSeeTrash = can(PERMISSION_ACTIONS.DELETE) || userCan(me?.permissions, PERMISSION_KEYS.CMS_BLOG, PERMISSION_ACTIONS.DELETE_OWN);
  const canReadUsers = userCan(me?.permissions, PERMISSION_KEYS.IAM_USERS, PERMISSION_ACTIONS.READ);

  const list = useListParams(POSTS_LIST_CONFIG);
  const filters = list.params.filters;
  const trashed = filters.trashed === "true";
  const query = list.query as PostsQuery;
  const { data, isLoading, isFetching, error, refetch } = usePosts(query);
  const categories = useCategories({ limit: 100 });
  const tags = useTags({ limit: 100 });
  const users = useUsers({ limit: 100 }, canReadUsers);

  const deleteMutation = useMutationDeletePost();
  const restoreMutation = useMutationRestorePost();

  const [createOpen, setCreateOpen] = useState(false);
  const [toDelete, setToDelete] = useState<PostListItem | null>(null);
  const [previewOf, setPreviewOf] = useState<PostListItem | null>(null);

  const titleOf = (p: PostListItem) => p.title ?? t("untitled");

  // The author chips: me, plus everybody when the user may read the users (there is no authors endpoint in P1).
  const authorOptions = useMemo<SelectedType[]>(() => {
    const options: SelectedType[] = [];
    if (me && me.id >= 1) options.push({ value: String(me.id), name: t("filters.mine", { name: me.name }) });
    for (const u of users.data?.data ?? []) if (u.id !== me?.id) options.push({ value: String(u.id), name: u.name });
    return options;
  }, [me, users.data, t]);
  const categoryOptions = useMemo<SelectedType[]>(
    () => (categories.data?.data ?? []).filter((c) => !c.deleted_at).map((c) => ({ value: String(c.id), name: c.translations[ui]?.name ?? c.translations[defaultLocale]?.name ?? c.key })),
    [categories.data, ui, defaultLocale]
  );
  const tagOptions = useMemo<MultiSelectOption[]>(
    () => (tags.data?.data ?? []).filter((x) => !x.deleted_at).map((x) => ({ value: String(x.id), name: x.translations[ui]?.name ?? x.translations[defaultLocale]?.name ?? x.key })),
    [tags.data, ui, defaultLocale]
  );
  const statusOptions = useMemo<MultiSelectOption[]>(() => STATUSES.map((s) => ({ value: s, name: t(`status.${s}`) })), [t]);
  const localeOptions = useMemo<SelectedType[]>(() => activeLocales.map((l) => ({ value: l.code, name: `${l.native_name} (${l.code})` })), [activeLocales]);
  const toSelected = (values: ReadonlyArray<string | number> | undefined, options: MultiSelectOption[]) =>
    (values ?? []).map((v) => options.find((o) => o.value === String(v)) ?? { value: String(v), name: String(v) });

  // A row the user acted on is out of date (someone else changed it): say so and reload the list.
  const stale = (message: string) => {
    toast.error(message);
    void refetch();
  };

  const doDelete = async (post: PostListItem) => {
    try {
      const response = await deleteMutation.mutateAsync({ id: post.id, etag: postEtag(post) });
      const warnings = response.data.data?.warnings ?? [];
      toast.success(t("delete.done", { title: titleOf(post) }));
      // Not a block, a notice: pages that show it in a blog strip simply skip it now.
      const referenced = warnings.find((w) => w.code === "post_referenced");
      if (referenced) toast.info(t("delete.referenced", { count: Number(referenced.params?.total_references ?? 0) }));
      if (warnings.some((w) => w.code === "draft_kept_as_history")) toast.info(t("delete.draftKept"));
    } catch (error) {
      const parsed = parseApiError(error);
      if (isConflictError(error)) stale(t("stale"));
      else if (parsed.code === "INVALID_STATE" && parsed.status === 409) stale(t("stale"));
      else toastError(error, t("delete.failed"));
    } finally {
      setToDelete(null);
    }
  };

  const doRestore = async (post: PostListItem) => {
    try {
      await restoreMutation.mutateAsync({ id: post.id, etag: postEtag(post) });
      toast.success(t("restore.done", { title: titleOf(post) }));
    } catch (error) {
      const parsed = parseApiError(error);
      if (parsed.code === "CONFLICT_DUPLICATE") {
        const langs = [...new Set(parsed.fieldErrors.map((f) => f.path.split("/")[2]).filter(Boolean))];
        toast.error(t("restore.duplicate", { languages: langs.join(", ") }));
      } else if (isConflictError(error) || (parsed.code === "INVALID_STATE" && parsed.status === 409)) stale(t("stale"));
      else toastError(error, t("restore.failed"));
    }
  };

  const columns = useMemo<ColumnDef<PostListItem>[]>(() => {
    const cols: ColumnDef<PostListItem>[] = [
      {
        id: "title",
        header: t("columns.title"),
        enableSorting: true,
        cell: ({ row }) => {
          const p = row.original;
          const editable = can(PERMISSION_ACTIONS.UPDATE, p.created_by?.id);
          return (
            <div className="flex min-w-0 max-w-56 flex-col">
              <div className="flex min-w-0 items-center gap-2">
                {trashed ? (
                  <span className="font-medium">{titleOf(p)}</span>
                ) : (
                  <Link href={`/admin/blog/posts/${p.id}`} className="truncate font-medium underline-offset-4 hover:underline">
                    {titleOf(p)}
                  </Link>
                )}
                {!trashed && !editable && !canTranslate ? <LockIcon className="size-3.5 shrink-0 text-muted-foreground" role="img" aria-label={t("readOnly")} /> : null}
              </div>
              {p.slug ? <span className="truncate font-mono text-xs text-muted-foreground" title={`/blog/${p.slug}`}>/blog/{p.slug}</span> : null}
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
          // The display date of a published post goes under the chip: a column of its own would not fit next to the rest.
          id: "status",
          header: t("columns.status"),
          enableSorting: true,
          cell: ({ row }) => {
            const p = row.original;
            return (
              <div className="flex flex-col items-start gap-0.5">
                <StatusBadge status={p.status} hasUnpublishedChanges={p.has_unpublished_changes} />
                {p.published_at ? <span className="text-xs text-muted-foreground">{t("publishedOn", { date: format.dateTime(new Date(p.published_at), { dateStyle: "medium" }) })}</span> : null}
              </div>
            );
          },
        },
        { id: "category", header: t("columns.category"), cell: ({ row }) => row.original.category?.name ?? <span className="text-muted-foreground">-</span> },
        { id: "author", header: t("columns.author"), cell: ({ row }) => <span className="block max-w-32 truncate" title={row.original.author_name ?? undefined}>{row.original.author_name ?? <span className="text-muted-foreground">-</span>}</span> },
        { id: "translations", header: t("columns.translations"), cell: ({ row }) => <TranslationBadges status={row.original.translation_status} fields={POST_FIELDS} noun={t("noun")} className="flex-nowrap" /> },
        {
          id: "updated_at",
          header: t("columns.updated"),
          enableSorting: true,
          cell: ({ row }) => {
            const p = row.original;
            return (
              <div className="text-sm">
                <div title={format.dateTime(new Date(p.updated_at), { dateStyle: "medium", timeStyle: "short" })}>{format.dateTime(new Date(p.updated_at), { dateStyle: "medium" })}</div>
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
        const owner = p.created_by?.id;
        // `delete`, or `delete_own` of my own post that was never published (05 13.3.2).
        const showDelete = !trashed && (can(PERMISSION_ACTIONS.DELETE) || (can(PERMISSION_ACTIONS.DELETE, owner) && !p.first_published_at));
        const showPreview = !trashed && can(PERMISSION_ACTIONS.READ) && (can(PERMISSION_ACTIONS.UPDATE, owner) || can(PERMISSION_ACTIONS.REVIEW));
        const editable = can(PERMISSION_ACTIONS.UPDATE, owner) || canTranslate;
        if (trashed) {
          // Restore is `delete` only: `delete_own` does not restore.
          return can(PERMISSION_ACTIONS.DELETE) ? (
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
                  <Link href={`/admin/blog/posts/${p.id}`}>
                    {editable ? <PencilIcon /> : <EyeIcon />}
                    {editable ? t("actions.open") : t("actions.view")}
                  </Link>
                </DropdownMenuItem>
                {showPreview ? (
                  <DropdownMenuItem onSelect={() => setPreviewOf(p)}>
                    <EyeIcon />
                    {t("actions.preview")}
                  </DropdownMenuItem>
                ) : null}
                {showDelete ? <DropdownMenuSeparator /> : null}
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
  }, [t, format, trashed, me, canTranslate, restoreMutation.isPending]);

  const rows = data?.data ?? [];

  return (
    <>
      <ListPage<PostListItem>
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
                  selectedValues={toSelected(filters.status, statusOptions)}
                  setSelectedValues={(action: SetStateAction<MultiSelectOption[]>) => {
                    const next = typeof action === "function" ? action(toSelected(filters.status, statusOptions)) : action;
                    list.setFilters({ status: next.length ? (next.map((o) => o.value) as (typeof STATUSES)[number][]) : undefined });
                  }}
                />
                <SingleSelectFilter
                  label={t("filters.category")}
                  data={categoryOptions}
                  isLoading={categories.isLoading}
                  selectedValue={facetValue(filters.category_id, categoryOptions)}
                  setSelectedValue={(action) => {
                    const picked = pickFacet(action, facetValue(filters.category_id, categoryOptions));
                    list.setFilters({ category_id: picked === undefined ? undefined : Number(picked) });
                  }}
                />
                <MultiSelectChecklist
                  label={t("filters.tag")}
                  data={tagOptions}
                  isLoading={tags.isLoading}
                  selectedValues={toSelected(filters.tag_id, tagOptions)}
                  setSelectedValues={(action: SetStateAction<MultiSelectOption[]>) => {
                    const next = typeof action === "function" ? action(toSelected(filters.tag_id, tagOptions)) : action;
                    list.setFilters({ tag_id: next.length ? next.slice(0, Math.min(5, MAX_FILTER_VALUES)).map((o) => Number(o.value)) : undefined });
                  }}
                />
                <SingleSelectFilter
                  label={t("filters.author")}
                  data={authorOptions}
                  isLoading={canReadUsers && users.isLoading}
                  selectedValue={facetValue(filters.created_by, authorOptions)}
                  setSelectedValue={(action) => {
                    const picked = pickFacet(action, facetValue(filters.created_by, authorOptions));
                    list.setFilters({ created_by: picked === undefined ? undefined : Number(picked) });
                  }}
                />
                <SingleSelectFilter
                  label={t("filters.language")}
                  data={localeOptions}
                  selectedValue={facetValue(filters.locale, localeOptions)}
                  setSelectedValue={(action) => list.setFilters({ locale: pickFacet(action, facetValue(filters.locale, localeOptions)) })}
                />
                <div className="flex items-center gap-2">
                  <Switch id="posts-pending-only" checked={filters.has_unpublished_changes === "true"} onCheckedChange={(v) => list.setFilters({ has_unpublished_changes: v ? "true" : undefined })} />
                  <Label htmlFor="posts-pending-only" className="font-normal">{t("filters.pendingOnly")}</Label>
                </div>
              </>
            ) : null}
            {canSeeTrash ? (
              <div className="flex items-center gap-2">
                <Switch
                  id="posts-trash"
                  checked={trashed}
                  onCheckedChange={(v) => {
                    // The trash has its own columns and no status / category filters; its natural order is the newest deletion first.
                    list.setFilters(
                      v
                        ? { trashed: "true", status: undefined, category_id: undefined, tag_id: undefined, created_by: undefined, has_unpublished_changes: undefined }
                        : { trashed: undefined }
                    );
                    list.setSort(v ? "-deleted_at" : undefined);
                  }}
                />
                <Label htmlFor="posts-trash" className="font-normal">{t("trash")}</Label>
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

      <PostCreateDialog open={createOpen} onOpenChange={setCreateOpen} defaultLocale={defaultLocale} />
      {previewOf ? <PreviewLinkDialog resource="posts" entityId={previewOf.id} open onOpenChange={(open) => !open && setPreviewOf(null)} /> : null}

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
