"use client";

import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { z } from "zod";

import { CustomPagination } from "@/components/global/custom-pagination";
import { DataTable } from "@/components/global/data-table";
import { EmptyMuted } from "@/components/global/empty";
import { BulkBar } from "@/components/global/list/bulk-bar";
import { FilterBar } from "@/components/global/list/filter-bar";
import { EmptyFiltered } from "@/components/global/states/empty-filtered";
import { ErrorState } from "@/components/global/states/error-state";
import { FetchingBar } from "@/components/global/states/fetching-bar";
import { NoPermission } from "@/components/layout/no-permission";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UseListParamsResult } from "@/hooks/use-list-params";
import { isNoPermissionError } from "@/lib/api-error";
import { LIST_LIMIT_OPTIONS, sortToSortingState, sortingStateToSort } from "@/lib/list-params";
import type { ApiMeta } from "@/types/api";

// The standard list screen (doc/07 section 2.5.1): header, filter bar, optional bulk bar, table with
// server-side sorting, pagination with a page-size choice — all state in the URL through `useListParams`.
//
//   const list = useListParams(USERS_LIST_CONFIG);
//   const { data, isLoading, isFetching, error, refetch } = useUsers(list.query);
//   <ListPage list={list} columns={columns} data={data?.data ?? []} meta={data?.meta}
//             isLoading={isLoading} isFetching={isFetching} error={error} onRetry={refetch} … />
//
// States, in order: a read that ended in 403 / an auth error -> `NoPermission` (never retried, never a
// toast); network/5xx -> `ErrorState` with Retry; loading -> skeleton rows; empty with an active filter ->
// `EmptyFiltered`; empty without -> `EmptyMuted` (+ `emptyAction`, e.g. a create button if allowed).
export function ListPage<TData, F extends z.ZodRawShape = z.ZodRawShape>({
  title,
  description,
  primaryAction,
  list,
  columns,
  data,
  meta,
  isLoading,
  isFetching = false,
  error,
  onRetry,
  getRowId,
  keywordPlaceholder,
  hideKeyword,
  filters,
  toolbarActions,
  selection,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: {
  // Omit when the route's own page.tsx renders the heading (Users does).
  title?: string;
  description?: string;
  primaryAction?: ReactNode;
  list: UseListParamsResult<F>;
  columns: ColumnDef<TData>[];
  data: TData[];
  meta?: ApiMeta;
  isLoading: boolean;
  isFetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  getRowId?: (row: TData) => string;
  keywordPlaceholder?: string;
  hideKeyword?: boolean;
  filters?: ReactNode;
  toolbarActions?: ReactNode;
  // Row selection + bulk commands; omit for lists without a bulk endpoint (no checkboxes at all).
  selection?: {
    rowSelection: RowSelectionState;
    onRowSelectionChange: (selection: RowSelectionState) => void;
    bulkActions?: ReactNode;
  };
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
}) {
  const t = useTranslations("list");
  const { params } = list;
  const selectedCount = selection ? Object.values(selection.rowSelection).filter(Boolean).length : 0;
  const hasError = error !== undefined && error !== null;
  // Without a heading of its own (the route's page.tsx renders it) the primary action joins the filter row.
  const showHeader = Boolean(title || description);

  const emptyContent = list.hasActiveFilters ? (
    <EmptyFiltered onClear={list.clearFilters} />
  ) : emptyAction ? (
    <div className="flex flex-col items-center gap-2">
      <EmptyMuted title={emptyTitle} description={emptyDescription} />
      {emptyAction}
    </div>
  ) : undefined;

  const filterBar = (
    <FilterBar
      keyword={params.keyword}
      onKeywordSubmit={list.setKeyword}
      keywordPlaceholder={keywordPlaceholder}
      hideKeyword={hideKeyword}
      hasActiveFilters={list.hasActiveFilters}
      onClear={list.clearFilters}
      actions={
        showHeader || !primaryAction ? (
          toolbarActions
        ) : (
          <>
            {toolbarActions}
            {primaryAction}
          </>
        )
      }
    >
      {filters}
    </FilterBar>
  );

  return (
    <div className="space-y-4">
      {showHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            {title ? <h1 className="text-2xl font-semibold tracking-wide">{title}</h1> : null}
            {description ? (
              <p className="mt-1 text-base text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {primaryAction}
        </div>
      ) : null}

      {selection && selectedCount > 0 ? (
        <BulkBar count={selectedCount} onClear={() => selection.onRowSelectionChange({})}>
          {selection.bulkActions}
        </BulkBar>
      ) : null}

      {hasError && isNoPermissionError(error) ? (
        <>
          {filterBar}
          <NoPermission />
        </>
      ) : hasError && !data.length ? (
        <>
          {filterBar}
          <ErrorState error={error} onRetry={onRetry} isRetrying={isFetching} />
        </>
      ) : (
        <div>
          <FetchingBar active={isFetching && !isLoading} />
          <DataTable
            columns={columns}
            data={data}
            getRowId={getRowId}
            isLoading={isLoading}
            skeletonRowCount={params.limit}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
            emptyContent={emptyContent}
            sorting={sortToSortingState(params.sort)}
            onSortingChange={(state) => list.setSort(sortingStateToSort(state))}
            rowSelection={selection?.rowSelection}
            onRowSelectionChange={selection?.onRowSelectionChange}
            toolbar={filterBar}
          />
        </div>
      )}

      {meta ? (
        <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t("total", { total: meta.total })}
          </p>
          <CustomPagination
            metaData={meta}
            onPageChange={list.setPage}
            isLoading={isFetching}
            rowLimit={params.limit}
            setRowLimit={list.setLimit}
          />
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("rowsPerPage")}</span>
            <Select value={String(params.limit)} onValueChange={(v) => list.setLimit(Number(v))}>
              <SelectTrigger size="sm" className="w-20" aria-label={t("rowsPerPage")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIST_LIMIT_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}
    </div>
  );
}
