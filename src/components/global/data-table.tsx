"use client";

import {
  type ColumnDef,
  type OnChangeFn,
  type RowSelectionState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useMemo } from "react";

import { EmptyMuted } from "@/components/global/empty";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// Shared list-table shell built on @tanstack/react-table's headless core
// row model. Every feature's list screen defines its own `columns` and gets
// the three-state loading contract — initial skeleton -> populated rows ->
// empty state — for free instead of re-implementing it per feature.
//
// Visuals: Card wrapper, uppercase header row, zebra-striped body rows.
//
// Optional (doc/07 section 5.2), all off unless the props are passed:
//  - `sorting` + `onSortingChange`: SERVER-side sorting (the table never sorts rows itself). Only columns that
//    set `enableSorting: true` get a sort button (use the endpoint's allow-list); the column `id` /
//    `accessorKey` is the API sort field. Header cycles asc -> desc -> none.
//  - `rowSelection` + `onRowSelectionChange`: a leading checkbox column (select page / select row). Only for
//    lists whose endpoint has a bulk command (needs `getRowId` so selection survives a refetch).
export function DataTable<TData>({
  columns,
  data,
  getRowId,
  isLoading,
  skeletonRowCount,
  emptyTitle,
  emptyDescription,
  emptyContent,
  sorting,
  onSortingChange,
  rowSelection,
  onRowSelectionChange,
}: {
  columns: ColumnDef<TData>[];
  data: TData[];
  getRowId?: (row: TData) => string;
  isLoading: boolean;
  skeletonRowCount: number;
  emptyTitle: string;
  emptyDescription?: string;
  // Replaces the default empty panel (e.g. `EmptyFiltered`, or an empty state with a create CTA).
  emptyContent?: ReactNode;
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
}) {
  const t = useTranslations("list");
  const selectable = rowSelection !== undefined && onRowSelectionChange !== undefined;
  const sortable = sorting !== undefined && onSortingChange !== undefined;

  const allColumns = useMemo<ColumnDef<TData>[]>(
    () =>
      selectable
        ? [
            {
              id: "__select",
              enableSorting: false,
              header: ({ table }) => (
                <Checkbox
                  checked={
                    table.getIsAllPageRowsSelected() ||
                    (table.getIsSomePageRowsSelected() && "indeterminate")
                  }
                  onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                  aria-label={t("selectAll")}
                />
              ),
              cell: ({ row }) => (
                <Checkbox
                  checked={row.getIsSelected()}
                  onCheckedChange={(value) => row.toggleSelected(!!value)}
                  aria-label={t("selectRow")}
                />
              ),
            },
            ...columns,
          ]
        : columns,
    [columns, selectable, t]
  );

  const table = useReactTable({
    data,
    columns: allColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    // Sorting is the server's job; a column is sortable only when it opts in.
    manualSorting: true,
    defaultColumn: { enableSorting: false },
    enableSortingRemoval: true,
    sortDescFirst: false,
    enableRowSelection: selectable,
    state: { sorting: sorting ?? [], rowSelection: rowSelection ?? {} },
    onSortingChange: ((updater) => {
      if (!onSortingChange) return;
      onSortingChange(typeof updater === "function" ? updater(sorting ?? []) : updater);
    }) as OnChangeFn<SortingState>,
    onRowSelectionChange: ((updater) => {
      if (!onRowSelectionChange) return;
      onRowSelectionChange(typeof updater === "function" ? updater(rowSelection ?? {}) : updater);
    }) as OnChangeFn<RowSelectionState>,
  });

  const rows = table.getRowModel().rows;

  return (
    <Card className="gap-0 overflow-hidden border-border/80 py-0 shadow-sm">
      <CardContent className="space-y-0 p-0">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow
                key={headerGroup.id}
                className="border-b border-border/80 bg-muted/40 hover:bg-muted/40"
              >
                {headerGroup.headers.map((header) => {
                  const canSort = sortable && header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  const content = header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext());
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={
                        canSort
                          ? sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"
                          : undefined
                      }
                      className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="-mx-1 inline-flex items-center gap-1 rounded px-1 uppercase hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          {content}
                          {sorted === "asc" ? (
                            <ArrowUpIcon className="size-3.5" aria-hidden />
                          ) : sorted === "desc" ? (
                            <ArrowDownIcon className="size-3.5" aria-hidden />
                          ) : (
                            <ArrowUpDownIcon className="size-3.5 opacity-50" aria-hidden />
                          )}
                        </button>
                      ) : (
                        content
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: skeletonRowCount }).map((_, i) => (
                <TableRow key={i}>
                  {allColumns.map((_, c) => (
                    <TableCell key={c} className="px-3 py-3">
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length ? (
              rows.map((row, index) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  className={cn(
                    "border-b border-border/25 transition-colors",
                    index % 2 === 0
                      ? "bg-white hover:bg-slate-50/90 dark:bg-background dark:hover:bg-muted/35"
                      : "bg-slate-50 hover:bg-slate-100/90 dark:bg-muted/20 dark:hover:bg-muted/30"
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="px-3 py-2.5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={allColumns.length} className="h-48 text-center">
                  {emptyContent ?? <EmptyMuted title={emptyTitle} description={emptyDescription} />}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
