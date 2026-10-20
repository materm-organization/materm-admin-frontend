"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

import { EmptyMuted } from "@/components/global/empty";
import { Card, CardContent } from "@/components/ui/card";
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
export function DataTable<TData>({
  columns,
  data,
  getRowId,
  isLoading,
  skeletonRowCount,
  emptyTitle,
  emptyDescription,
}: {
  columns: ColumnDef<TData>[];
  data: TData[];
  getRowId?: (row: TData) => string;
  isLoading: boolean;
  skeletonRowCount: number;
  emptyTitle: string;
  emptyDescription?: string;
}) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
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
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: skeletonRowCount }).map((_, i) => (
                <TableRow key={i}>
                  {columns.map((_, c) => (
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
                <TableCell colSpan={columns.length} className="h-48 text-center">
                  <EmptyMuted title={emptyTitle} description={emptyDescription} />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
