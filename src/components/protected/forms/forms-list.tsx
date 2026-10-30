"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangleIcon, InboxIcon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, type SetStateAction } from "react";
import { z } from "zod";

import { ListPage } from "@/components/global/list/list-page";
import { MultiSelectChecklist, type MultiSelectOption } from "@/components/global/multi-select-checklist";
import { StatusBadge } from "@/components/global/status/status-badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useForms } from "@/hooks/use-forms";
import { useListParams } from "@/hooks/use-list-params";
import type { ListParamsConfig } from "@/lib/list-params";
import type { FormListItem, FormsQuery } from "@/types/forms";

const STATUSES = ["draft", "published", "archived"] as const;

const csv = <T,>(schema: z.ZodType<T>, max: number) =>
  z.string().transform((v) => v.split(",").filter(Boolean)).pipe(z.array(schema).min(1).max(max)).optional();

// URL state of the list: ?page=&limit=&keyword=&sort=&status=draft,published&has_unpublished_changes=true (doc/05 13.6.2).
const FORMS_LIST_CONFIG = {
  filters: {
    status: csv(z.enum(STATUSES), STATUSES.length),
    has_unpublished_changes: z.literal("true").optional(),
  },
  sortable: ["slug", "name", "updated_at", "status"],
  defaultSort: "slug",
  defaultLimit: 20,
} satisfies ListParamsConfig;

// SCR-31 (doc/07 section 3.19): the forms of the website. There is no create and no delete in P1 (the `contact` form is a system form
// that cannot be removed, BR-18). A row opens the editor; the number of new messages links to the inbox filtered by the form (only
// shown to a person who may read the inbox - the server leaves the number out otherwise).
export function FormsList() {
  const t = useTranslations("forms.list");
  const format = useFormatter();
  const list = useListParams(FORMS_LIST_CONFIG);
  const filters = list.params.filters;
  const query = list.query as FormsQuery;
  const { data, isLoading, isFetching, error, refetch } = useForms(query);
  const statusOptions = useMemo<MultiSelectOption[]>(() => STATUSES.map((s) => ({ value: s, name: t(`status.${s}`) })), [t]);

  const columns = useMemo<ColumnDef<FormListItem>[]>(
    () => [
      {
        id: "name",
        header: t("columns.name"),
        enableSorting: true,
        cell: ({ row }) => {
          const f = row.original;
          return (
            <div className="flex min-w-0 max-w-64 flex-col">
              <Link href={`/admin/forms/${f.id}`} className="truncate font-medium underline-offset-4 hover:underline">
                {f.name}
              </Link>
              <span className="truncate font-mono text-xs text-muted-foreground">{f.slug}{f.is_system ? ` - ${t("system")}` : ""}</span>
            </div>
          );
        },
      },
      {
        id: "status",
        header: t("columns.status"),
        enableSorting: true,
        cell: ({ row }) => <StatusBadge status={row.original.status} hasUnpublishedChanges={row.original.has_unpublished_changes} />,
      },
      {
        id: "recipients",
        header: t("columns.recipients"),
        cell: ({ row }) =>
          row.original.recipient_count === 0 ? (
            <span className="inline-flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400" data-testid="no-recipients">
              <AlertTriangleIcon className="size-3.5" aria-hidden />
              {t("noRecipients")}
            </span>
          ) : (
            <span className="tabular-nums">{row.original.recipient_count}</span>
          ),
      },
      {
        id: "messages",
        header: t("columns.messages"),
        cell: ({ row }) => {
          const n = row.original.submissions_new;
          if (n === undefined) return <span className="text-muted-foreground">-</span>;
          return n > 0 ? (
            <Link href={`/admin/forms/submissions?form_id=${row.original.id}&status=new`} className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">
              <InboxIcon className="size-3.5" aria-hidden />
              {t("newMessages", { count: n })}
            </Link>
          ) : (
            <span className="text-muted-foreground">0</span>
          );
        },
      },
      {
        id: "updated_at",
        header: t("columns.updated"),
        enableSorting: true,
        cell: ({ row }) => {
          const f = row.original;
          return (
            <div className="text-sm">
              <div title={format.dateTime(new Date(f.updated_at), { dateStyle: "medium", timeStyle: "short" })}>{format.dateTime(new Date(f.updated_at), { dateStyle: "medium" })}</div>
              {f.updated_by?.name ? <div className="text-xs text-muted-foreground">{f.updated_by.name}</div> : null}
            </div>
          );
        },
      },
    ],
    [t, format]
  );

  const toSelected = (values: ReadonlyArray<string> | undefined) => (values ?? []).map((v) => statusOptions.find((o) => o.value === v) ?? { value: v, name: v });

  return (
    <ListPage<FormListItem>
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
          <MultiSelectChecklist
            label={t("filters.status")}
            data={statusOptions}
            selectedValues={toSelected(filters.status)}
            setSelectedValues={(action: SetStateAction<MultiSelectOption[]>) => {
              const next = typeof action === "function" ? action(toSelected(filters.status)) : action;
              list.setFilters({ status: next.length ? (next.map((o) => o.value) as (typeof STATUSES)[number][]) : undefined });
            }}
          />
          <div className="flex items-center gap-2">
            <Switch id="forms-pending-only" checked={filters.has_unpublished_changes === "true"} onCheckedChange={(v) => list.setFilters({ has_unpublished_changes: v ? "true" : undefined })} />
            <Label htmlFor="forms-pending-only" className="font-normal">
              {t("filters.pendingOnly")}
            </Label>
          </div>
        </div>
      }
      emptyTitle={t("empty")}
      emptyDescription={t("emptyHint")}
    />
  );
}
