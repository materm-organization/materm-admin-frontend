"use client";

import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { FileDownIcon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState, type SetStateAction } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { DateRangeFilter } from "@/components/global/date-range-filter";
import { ListPage } from "@/components/global/list/list-page";
import { SingleSelectFilter, type SelectedType } from "@/components/global/single-select-filter";
import { SubmissionStatusBadge } from "@/components/protected/submissions/submission-status-badge";
import { SubmissionsExportDialog } from "@/components/protected/submissions/submissions-export-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useFetchCurrentUser } from "@/hooks/use-auth";
import { useFormDetail, useForms } from "@/hooks/use-forms";
import { useListParams } from "@/hooks/use-list-params";
import { useMutationBulkSubmissionStatus, useSubmissions, useSubmissionsSummary } from "@/hooks/use-submissions";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { ListParamsConfig } from "@/lib/list-params";
import { userCan } from "@/lib/permissions";
import { KEYWORD_DEFAULT_WINDOW_DAYS, KEYWORD_MAX_WINDOW_DAYS, MAX_BULK_IDS, SUBMISSION_STATUSES, windowProblem } from "@/lib/submissions";
import type { SubmissionListItem, SubmissionStatus, SubmissionsExportQuery, SubmissionsQuery } from "@/types/submissions";

const positiveInt = z.string().regex(/^[1-9]\d{0,8}$/).transform(Number).optional();
const isoDate = z.string().datetime({ offset: true }).optional();
const statusList = z
  .string()
  .transform((v) => v.split(",").filter(Boolean))
  .pipe(z.array(z.enum(SUBMISSION_STATUSES)).min(1).max(SUBMISSION_STATUSES.length))
  .optional();

// URL state: ?page=&limit=&keyword=&sort=&status=new,read&form_id=1&topic=booking&from=...&to=... (doc/05 13.7.2). `status` absent means
// "every status except spam" (the spam tab sends `status=spam`); `sort` is `created_at` only. `assigned_to` / `mine` do not exist in P1.
const SUBMISSIONS_LIST_CONFIG = {
  filters: { status: statusList, form_id: positiveInt, topic: z.string().min(1).max(60).optional(), from: isoDate, to: isoDate },
  sortable: ["created_at"],
  defaultSort: "-created_at",
  defaultLimit: 20,
} satisfies ListParamsConfig;

const ACTIONS: Record<SubmissionStatus, SubmissionStatus[]> = {
  new: ["read", "replied", "archived", "spam"],
  read: ["read", "replied", "archived", "spam"],
  replied: ["read", "replied", "archived", "spam"],
  archived: ["read", "replied", "archived", "spam"],
  spam: ["new"],
};

// SCR-32 (doc/07 section 3.20): the inbox. Summary chips on top (New with its count, then the other statuses and Spam), filters in the
// URL (form, topic, dates, keyword), a bulk bar (mark read / replied / archive / spam / not spam, up to 100 rows, one request) and the
// CSV export for those who may. The texts are visitors' texts: they are shown as text only, never as HTML.
export function SubmissionsList() {
  const t = useTranslations("submissions.list");
  const tStatus = useTranslations("submissions.status");
  const format = useFormatter();
  const { toastError } = useApiErrorHandler();
  const me = useFetchCurrentUser().data?.data;
  const can = (key: string, action: string) => userCan(me?.permissions, key, action);
  const canUpdate = can(PERMISSION_KEYS.FORMS_SUBMISSIONS, PERMISSION_ACTIONS.UPDATE);
  const canExport = can(PERMISSION_KEYS.FORMS_SUBMISSIONS, PERMISSION_ACTIONS.EXPORT);
  const canReadForms = can(PERMISSION_KEYS.FORMS_MANAGE, PERMISSION_ACTIONS.READ);

  const list = useListParams(SUBMISSIONS_LIST_CONFIG);
  const filters = list.params.filters;
  const keyword = list.params.keyword;
  const query = list.query as SubmissionsQuery;

  // The window is checked BEFORE the request goes out (a keyword needs <= 366 days, `from` may not be after `to`).
  const problem = windowProblem({ from: filters.from, to: filters.to, keyword });
  const { data, isLoading, isFetching, error, refetch } = useSubmissions(query, problem === null);
  const summary = useSubmissionsSummary();
  const formsQuery = useForms({ limit: 100 }, canReadForms);
  const formDetail = useFormDetail(filters.form_id ?? 0, canReadForms && filters.form_id !== undefined);

  const bulk = useMutationBulkSubmissionStatus();
  // A selection belongs to the rows of one query: a new filter, page or sort starts again from nothing (derived, no effect).
  const queryKey = JSON.stringify(query);
  const [picked, setPicked] = useState<{ key: string; rows: RowSelectionState }>({ key: queryKey, rows: {} });
  const selection = picked.key === queryKey ? picked.rows : {};
  const setSelection = (rows: RowSelectionState) => setPicked({ key: queryKey, rows });
  const [exportOpen, setExportOpen] = useState(false);

  const selectedIds = Object.entries(selection).filter(([, on]) => on).map(([id]) => Number(id));
  // Selected rows of the current page (the selection is reset with the page); `created_at` is the partition hint of the read.
  const selectedRows = (data?.data ?? []).filter((r) => selectedIds.includes(r.id)).map((r) => ({ id: r.id, created_at: r.created_at }));
  const onlyStatus = filters.status?.length === 1 ? filters.status[0] : undefined;

  const formOptions = useMemo<SelectedType[]>(() => {
    const news = new Map((summary.data?.by_form ?? []).map((f) => [f.form_id, f.new]));
    const rows = new Map<number, string>();
    for (const f of summary.data?.by_form ?? []) rows.set(f.form_id, f.name);
    for (const f of formsQuery.data?.data ?? []) rows.set(f.id, f.name);
    return [...rows.entries()].map(([id, name]) => ({ value: String(id), name: news.get(id) ? t("filters.formWithNew", { name, count: news.get(id) ?? 0 }) : name }));
  }, [summary.data, formsQuery.data, t]);
  const topicOptions = useMemo<SelectedType[]>(
    () => (formDetail.data?.data.data.topics ?? []).map((topic) => ({ value: topic.value, name: Object.values(topic.labels)[0] ?? topic.value })),
    [formDetail.data]
  );
  const facet = (value: string | number | undefined, options: SelectedType[]): SelectedType | null =>
    value === undefined ? null : (options.find((o) => o.value === String(value)) ?? { value: String(value), name: String(value) });
  const pick = (action: SetStateAction<SelectedType | null>, current: SelectedType | null) => (typeof action === "function" ? action(current) : action)?.value;

  const columns = useMemo<ColumnDef<SubmissionListItem>[]>(
    () => [
      {
        id: "created_at",
        header: t("columns.received"),
        enableSorting: true,
        cell: ({ row }) => {
          const s = row.original;
          const href = `/admin/forms/submissions/${s.id}?created_at=${encodeURIComponent(s.created_at)}`;
          return (
            <Link href={href} className="whitespace-nowrap text-sm underline-offset-4 hover:underline">
              {format.dateTime(new Date(s.created_at), { dateStyle: "medium", timeStyle: "short" })}
            </Link>
          );
        },
      },
      {
        id: "sender",
        header: t("columns.sender"),
        cell: ({ row }) => {
          const s = row.original;
          if (s.anonymized_at) return <span className="text-sm italic text-muted-foreground">{t("anonymised")}</span>;
          return (
            <div className="flex min-w-0 max-w-44 flex-col">
              <span className={s.status === "new" ? "truncate font-semibold" : "truncate"}>{s.sender_name ?? t("noName")}</span>
              <span className="truncate text-xs text-muted-foreground">{s.sender_email ?? ""}</span>
            </div>
          );
        },
      },
      { id: "status", header: t("columns.status"), cell: ({ row }) => <SubmissionStatusBadge status={row.original.status} /> },
      { id: "topic", header: t("columns.topic"), cell: ({ row }) => (row.original.topic ? <span className="font-mono text-xs">{row.original.topic}</span> : <span className="text-muted-foreground">-</span>) },
      { id: "form", header: t("columns.form"), cell: ({ row }) => <span className="block max-w-28 truncate">{row.original.form.name}</span> },
      {
        id: "message",
        header: t("columns.message"),
        cell: ({ row }) => <span className={`block max-w-56 truncate text-sm ${row.original.status === "new" ? "font-medium" : "text-muted-foreground"}`}>{row.original.message_preview ?? ""}</span>,
      },
      {
        id: "notes",
        header: () => <span className="sr-only">{t("columns.notes")}</span>,
        cell: ({ row }) => (row.original.notes_count > 0 ? <span className="text-xs text-muted-foreground" title={t("notes", { count: row.original.notes_count })}>{row.original.notes_count}</span> : null),
      },
    ],
    [t, format]
  );

  const setStatusFilter = (status: SubmissionStatus | undefined) => list.setFilters({ status: status ? [status] : undefined });

  const runBulk = async (status: SubmissionStatus) => {
    try {
      const result = await bulk.mutateAsync({ rows: selectedRows, status });
      setSelection({});
      toast.success(t("bulk.done", { updated: result.counts.updated, skipped: result.counts.skipped }));
      const stale = result.skipped.filter((s) => s.reason === "stale").length;
      const others = result.counts.skipped - stale;
      if (others > 0) toast.info(t("bulk.skipped", { count: others }));
      // Not written: somebody else changed these rows. The list (and any open detail) is reloaded by the mutation.
      if (stale > 0) toast.warning(t("bulk.stale", { count: stale }));
    } catch (e) {
      toastError(e, t("bulk.failed"));
    }
  };

  const dateRange = filters.from && filters.to ? { from: new Date(filters.from), to: new Date(filters.to) } : undefined;
  const exportQuery: SubmissionsExportQuery = useMemo(() => {
    const { page: _p, limit: _l, sort: _s, ...rest } = query;
    void _p;
    void _l;
    void _s;
    return rest;
  }, [query]);
  const exportSummary = [
    filters.status?.length ? t("export.status", { value: filters.status.map((s) => tStatus(s)).join(", ") }) : t("export.statusDefault"),
    filters.form_id !== undefined ? t("export.form", { value: facet(filters.form_id, formOptions)?.name ?? String(filters.form_id) }) : "",
    filters.topic ? t("export.topic", { value: filters.topic }) : "",
    filters.from || filters.to ? t("export.dates", { from: filters.from ? format.dateTime(new Date(filters.from), { dateStyle: "medium" }) : "-", to: filters.to ? format.dateTime(new Date(filters.to), { dateStyle: "medium" }) : "-" }) : "",
    keyword ? t("export.keyword", { count: [...keyword].length }) : "",
  ].filter(Boolean);

  const chip = (label: string, active: boolean, onClick: () => void, key: string) => (
    <Button key={key} type="button" size="sm" variant={active ? "default" : "outline"} aria-pressed={active} onClick={onClick}>
      {label}
    </Button>
  );
  const newCount = summary.data?.new;

  return (
    <>
      <ListPage<SubmissionListItem>
        title={t("title")}
        description={t("description")}
        list={list}
        columns={columns}
        data={problem ? [] : (data?.data ?? [])}
        meta={problem ? undefined : data?.meta}
        isLoading={problem ? false : isLoading}
        isFetching={isFetching}
        error={problem ? undefined : error}
        onRetry={() => void refetch()}
        getRowId={(r) => String(r.id)}
        keywordPlaceholder={t("searchPlaceholder")}
        toolbarActions={
          canExport ? (
            <Button type="button" variant="outline" onClick={() => setExportOpen(true)}>
              <FileDownIcon />
              {t("export.open")}
            </Button>
          ) : undefined
        }
        selection={
          canUpdate
            ? {
                rowSelection: selection,
                onRowSelectionChange: setSelection,
                bulkActions: (
                  <div className="flex flex-wrap items-center gap-2">
                    {(onlyStatus === "spam" ? ACTIONS.spam : ACTIONS.new).map((status) => (
                      <Button key={status} type="button" size="sm" variant="outline" disabled={bulk.isPending || selectedIds.length > MAX_BULK_IDS} onClick={() => void runBulk(status)}>
                        {t(`bulk.to.${status}`)}
                      </Button>
                    ))}
                    {selectedIds.length > MAX_BULK_IDS ? <span role="alert" className="text-sm text-destructive">{t("bulk.tooMany", { max: MAX_BULK_IDS })}</span> : null}
                  </div>
                ),
              }
            : undefined
        }
        filters={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("chips.label")}>
              {chip(t("chips.all"), filters.status === undefined, () => setStatusFilter(undefined), "all")}
              {chip(newCount !== undefined ? t("chips.newWithCount", { count: newCount }) : tStatus("new"), onlyStatus === "new", () => setStatusFilter("new"), "new")}
              {(["read", "replied", "archived", "spam"] as const).map((status) => chip(tStatus(status), onlyStatus === status, () => setStatusFilter(status), status))}
            </div>
            <SingleSelectFilter
              label={t("filters.form")}
              data={formOptions}
              isLoading={summary.isLoading}
              selectedValue={facet(filters.form_id, formOptions)}
              setSelectedValue={(action) => {
                const picked = pick(action, facet(filters.form_id, formOptions));
                // The topics belong to one form: choosing another form clears the topic.
                list.setFilters({ form_id: picked === undefined ? undefined : Number(picked), topic: undefined });
              }}
            />
            {topicOptions.length > 0 ? (
              <SingleSelectFilter
                label={t("filters.topic")}
                data={topicOptions}
                selectedValue={facet(filters.topic, topicOptions)}
                setSelectedValue={(action) => list.setFilters({ topic: pick(action, facet(filters.topic, topicOptions)) })}
              />
            ) : null}
            <DateRangeFilter
              label={t("filters.dates")}
              dateRange={dateRange}
              setDateRange={(action) => {
                const next = typeof action === "function" ? action(dateRange) : action;
                list.setFilters({ from: next?.from.toISOString(), to: next?.to.toISOString() });
              }}
            />
          </div>
        }
        emptyTitle={filters.status?.length === 1 && filters.status[0] === "spam" ? t("emptySpam") : t("empty")}
        emptyDescription={t("emptyHint")}
      />

      <div className="mt-3 space-y-2">
        {keyword && !filters.from && !filters.to ? <p className="text-sm text-muted-foreground" data-testid="keyword-window-note">{t("keywordWindow", { days: KEYWORD_DEFAULT_WINDOW_DAYS })}</p> : null}
        {problem ? (
          <Alert variant="destructive" data-testid="window-problem">
            <AlertDescription>{problem === "from_after_to" ? t("windowFromAfterTo") : t("windowTooLarge", { days: KEYWORD_MAX_WINDOW_DAYS })}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <SubmissionsExportDialog open={exportOpen} onOpenChange={setExportOpen} query={exportQuery} total={problem ? undefined : data?.meta.total} summary={exportSummary} />
    </>
  );
}
