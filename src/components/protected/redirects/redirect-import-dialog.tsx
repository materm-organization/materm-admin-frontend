"use client";

import { AlertTriangleIcon, ChevronLeftIcon, ChevronRightIcon, FileTextIcon, UploadIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  IMPORT_FILTERS,
  IMPORT_PAGE_SIZE,
  classifyImportError,
  filterImportRows,
  formatFileSize,
  importErrorText,
  importPageCount,
  importPageSlice,
  importWarningText,
  type ImportFailure,
  type ImportFilter,
} from "@/components/protected/redirects/redirect-import";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMutationImportRedirects } from "@/hooks/use-redirects";
import { cn } from "@/lib/utils";
import { REDIRECT_IMPORT_MAX_BYTES } from "@/services/redirects.api";
import type { RedirectImportReport, RedirectImportRow, RedirectImportStatus } from "@/types/redirects";

const STATUS_STYLE: Record<RedirectImportStatus, string> = {
  created: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  updated: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  unchanged: "bg-muted text-muted-foreground",
  error: "bg-destructive/10 text-destructive",
};

// Import of redirects from a CSV (doc/05 14.13): choose a file, DRY RUN (nothing is written), read the report, then Apply
// (the same file again with dry_run=false; all or nothing). The echoed cells are plain text, never HTML.
export function RedirectImportDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("redirects.import");
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const importer = useMutationImportRedirects();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<RedirectImportReport | null>(null);
  // The apply was refused (422 with the full report): the report below is that one.
  const [refused, setRefused] = useState(false);
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [sizeProblem, setSizeProblem] = useState(false);

  const pending = importer.isPending;
  const canApply = report !== null && report.valid && report.dry_run && !report.applied && report.totals.created + report.totals.updated > 0;

  const choose = (next: File | null) => {
    // A new file means a new dry run: the old report no longer describes it.
    setReport(null);
    setRefused(false);
    setFailure(null);
    setSizeProblem(false);
    if (next && next.size > REDIRECT_IMPORT_MAX_BYTES) {
      setFile(null);
      setSizeProblem(true);
      return;
    }
    setFile(next);
  };

  const run = async (dryRun: boolean) => {
    if (!file) return;
    setFailure(null);
    try {
      const result = await importer.mutateAsync({ file, dryRun });
      setReport(result);
      setRefused(false);
      if (!dryRun) {
        toast.success(t("toast.applied", { created: result.totals.created, updated: result.totals.updated, unchanged: result.totals.unchanged }));
        onClose();
      }
    } catch (error) {
      const result = classifyImportError(error);
      if (result.kind === "report") {
        setReport(result.report);
        setRefused(!dryRun);
        setFailure(null);
      } else setFailure(result);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl" data-testid="redirect-import">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>{t("help.format")}</li>
            <li>{t("help.rows")}</li>
            <li>{t("help.roundTrip")}</li>
            <li>{t("help.limit")}</li>
          </ul>

          <div className="space-y-1.5">
            <Label htmlFor={inputId}>{t("file.label")}</Label>
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={inputRef}
                id={inputId}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                disabled={pending}
                data-testid="redirect-import-input"
                onChange={(e) => {
                  choose(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
              <Button type="button" variant="outline" disabled={pending} onClick={() => inputRef.current?.click()}>
                <UploadIcon /> {file ? t("file.change") : t("file.choose")}
              </Button>
              {file ? (
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <FileTextIcon className="size-4 shrink-0" aria-hidden />
                  <span className="truncate font-medium">{file.name}</span>
                  <span className="text-muted-foreground">{formatFileSize(file.size)}</span>
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">{t("file.none")}</span>
              )}
            </div>
            {sizeProblem ? (
              <p role="alert" className="text-sm text-destructive">
                {t("failure.tooLarge", { max: REDIRECT_IMPORT_MAX_BYTES / (1024 * 1024) })}
              </p>
            ) : null}
          </div>

          {failure?.kind === "message" ? (
            <Alert variant="destructive" role="alert" data-testid="redirect-import-failure">
              <AlertTriangleIcon />
              <AlertTitle>{t("failure.title")}</AlertTitle>
              <AlertDescription>{(t as unknown as (key: string, values?: Record<string, string | number>) => string)(`failure.${failure.key}`, failure.values)}</AlertDescription>
            </Alert>
          ) : null}

          {report ? <ReportView key={`${report.dry_run}-${report.applied}-${refused}-${report.totals.rows}`} report={report} refused={refused} /> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            {t("close")}
          </Button>
          <Button type="button" variant={report ? "outline" : "default"} disabled={!file || pending} onClick={() => void run(true)}>
            {pending && importer.variables?.dryRun ? <Spinner /> : null} {report ? t("checkAgain") : t("check")}
          </Button>
          {report ? (
            <Button type="button" disabled={!canApply || pending} onClick={() => void run(false)}>
              {pending && importer.variables?.dryRun === false ? <Spinner /> : null} {t("apply", { count: report.totals.created + report.totals.updated })}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportView({ report, refused }: { report: RedirectImportReport; refused: boolean }) {
  const t = useTranslations("redirects.import");
  const format = useFormatter();
  const [filter, setFilter] = useState<ImportFilter>(report.totals.errors > 0 ? "error" : "all");
  const [page, setPage] = useState(1);
  const rows = useMemo(() => filterImportRows(report.rows, filter), [report.rows, filter]);
  const pages = importPageCount(rows.length);
  const safePage = Math.min(page, pages);
  const visible = useMemo(() => importPageSlice(rows, safePage), [rows, safePage]);
  const first = rows.length === 0 ? 0 : (safePage - 1) * IMPORT_PAGE_SIZE + 1;
  const { totals } = report;

  return (
    <div className="space-y-3" data-testid="redirect-import-report">
      {refused ? (
        <Alert variant="destructive" role="alert">
          <AlertTriangleIcon />
          <AlertTitle>{t("refused.title")}</AlertTitle>
          <AlertDescription>{t("refused.body", { count: totals.errors })}</AlertDescription>
        </Alert>
      ) : report.valid ? (
        <Alert role="status">
          <AlertTitle>{report.dry_run ? t("valid.title") : t("valid.appliedTitle")}</AlertTitle>
          <AlertDescription>{totals.created + totals.updated === 0 ? t("valid.nothing") : report.dry_run ? t("valid.body") : ""}</AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive" role="alert">
          <AlertTriangleIcon />
          <AlertTitle>{t("invalid.title", { count: totals.errors })}</AlertTitle>
          <AlertDescription>{t("invalid.body")}</AlertDescription>
        </Alert>
      )}

      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5" data-testid="redirect-import-totals">
        {(["rows", "created", "updated", "unchanged", "errors"] as const).map((k) => (
          <div key={k} className="rounded-md border px-3 py-2">
            <dt className="text-xs text-muted-foreground">{t(`totals.${k}`)}</dt>
            <dd className={cn("text-lg font-semibold leading-snug", k === "errors" && totals.errors > 0 && "text-destructive")}>{format.number(totals[k])}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="import-filter" className="font-normal">
            {t("filter.label")}
          </Label>
          <Select
            value={filter}
            onValueChange={(v) => {
              setFilter(v as ImportFilter);
              setPage(1);
            }}
          >
            <SelectTrigger id="import-filter" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IMPORT_FILTERS.map((f) => (
                <SelectItem key={f} value={f}>
                  {t(`filter.${f}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground" data-testid="redirect-import-range">
            {rows.length === 0 ? t("pagination.none") : t("pagination.range", { from: format.number(first), to: format.number(first + visible.length - 1), total: format.number(rows.length) })}
          </span>
          <Button type="button" variant="outline" size="icon" className="size-8" aria-label={t("pagination.prev")} disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
            <ChevronLeftIcon />
          </Button>
          <Button type="button" variant="outline" size="icon" className="size-8" aria-label={t("pagination.next")} disabled={safePage >= pages} onClick={() => setPage(safePage + 1)}>
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.row")}</TableHead>
              <TableHead>{t("table.from")}</TableHead>
              <TableHead>{t("table.to")}</TableHead>
              <TableHead>{t("table.code")}</TableHead>
              <TableHead>{t("table.status")}</TableHead>
              <TableHead>{t("table.previous")}</TableHead>
              <TableHead>{t("table.problems")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  {t("table.empty")}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row) => <ReportRow key={row.row} row={row} />)
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ReportRow({ row }: { row: RedirectImportRow }) {
  const t = useTranslations("redirects.import");
  const tErr = useTranslations("redirects.import.errors");
  const tWarn = useTranslations("redirects.import.warnings");
  const tRules = useTranslations("redirects.fieldErrors.rules");
  const tErrors = useTranslations("errors");
  // Cells are echoed as sent: plain text nodes only (React escapes them), long values wrap.
  const cell = "max-w-96 whitespace-normal break-all font-mono text-xs";
  return (
    <TableRow data-testid="redirect-import-row" data-status={row.status}>
      <TableCell className="tabular-nums">{row.row}</TableCell>
      <TableCell className={cell}>{row.from}</TableCell>
      <TableCell className={cell}>{row.to}</TableCell>
      <TableCell className="font-mono text-xs">{row.code}</TableCell>
      <TableCell>
        <Badge variant="outline" className={cn("border-transparent", STATUS_STYLE[row.status])}>
          {t(`status.${row.status}`)}
        </Badge>
      </TableCell>
      <TableCell className={cell}>{row.previous ? `${row.previous.to} (${row.previous.code})` : ""}</TableCell>
      <TableCell className="min-w-56 whitespace-normal text-xs leading-snug">
        {row.errors.length > 0 ? (
          <ul className="space-y-1 text-destructive">
            {row.errors.map((e, i) => (
              <li key={`e${i}`}>{importErrorText(tErr, tRules, tErrors, e)}</li>
            ))}
          </ul>
        ) : null}
        {row.warnings.length > 0 ? (
          <ul className="space-y-1 text-amber-700 dark:text-amber-400">
            {row.warnings.map((w, i) => (
              <li key={`w${i}`}>{importWarningText(tWarn, w)}</li>
            ))}
          </ul>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
