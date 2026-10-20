"use client";

import axios from "axios";
import { FileDownIcon } from "lucide-react";
import { toast } from "sonner";
import type { UseMutationResult } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

function formatInt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// The copy shown by this dialog, built by each page from its own
// `useTranslations` namespace (e.g. `<feature>.exportDialog.*`) and handed
// down as a plain object — this component deliberately never calls `useTranslations` itself, since it has
// no namespace of its own to read from.
export type ExportCsvDialogCopy = {
  title: string;
  description: string;
  totalRecordsLabel: string;
  noData: string;
  cancel: string;
  confirm: string;
  loadingToast: string;
  successToast: string;
  errorToast: string;
};

type ExportCsvDialogProps<TFilters> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalRecords: number;
  filters: TFilters;
  isLoading?: boolean;
  exportMutation: UseMutationResult<unknown, unknown, TFilters>;
  copy: ExportCsvDialogCopy;
};

// Generic confirm dialog for a "Export CSV" flow (record-count summary,
// Cancel/Confirm footer, `toast.loading` -> `toast.success`/`toast.error`
// lifecycle), parameterized over the export payload type (`TFilters`).
//
// Does NOT own the export mutation itself — the page owns the Export button, the mutation hook,
// and the export-context it reads), handed down here as `exportMutation` so
// this dialog only drives it. Generic over `TFilters` only — callers pin it
// explicitly, e.g. `<ExportCsvDialog<MyExportPayload> ... />` — the
// mutation's `data`/`error` types are deliberately widened to `unknown`
// since this dialog never reads `data` and narrows `error` itself via
// `axios.isAxiosError`/`instanceof Error` below, so there's nothing to gain
// from a second type parameter for them.
export function ExportCsvDialog<TFilters>({
  open,
  onOpenChange,
  totalRecords,
  filters,
  isLoading = false,
  exportMutation,
  copy,
}: ExportCsvDialogProps<TFilters>) {
  const isExporting = exportMutation.isPending;
  const canExport = totalRecords > 0 && !isLoading && !isExporting;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isExporting) return;
    onOpenChange(nextOpen);
  };

  const handleConfirm = () => {
    if (!canExport) return;
    const loadingId = toast.loading(copy.loadingToast);
    exportMutation.mutate(filters, {
      onSuccess: () => {
        toast.success(copy.successToast, { id: loadingId });
        onOpenChange(false);
      },
      onError: (error: unknown) => {
        const fallback = copy.errorToast;
        if (axios.isAxiosError(error)) {
          toast.error(error.response?.data?.message || fallback, { id: loadingId });
          return;
        }
        toast.error(error instanceof Error ? error.message : fallback, { id: loadingId });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border/80 bg-muted/30 px-4 py-1">
          {isLoading ? (
            <div className="space-y-3 py-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-sm text-muted-foreground">{copy.totalRecordsLabel}</span>
              <span className="text-right text-sm font-medium text-foreground tabular-nums">
                {formatInt(totalRecords)}
              </span>
            </div>
          )}
        </div>

        {!isLoading && totalRecords === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.noData}</p>
        ) : null}

        <DialogFooter className="flex flex-row justify-end gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isExporting}
            onClick={() => handleOpenChange(false)}
          >
            {copy.cancel}
          </Button>
          <Button type="button" className="gap-2" disabled={!canExport} onClick={handleConfirm}>
            {isExporting ? <Spinner /> : <FileDownIcon className="size-4" />}
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
