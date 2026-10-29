"use client";

import { FileDownIcon, ShieldAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useMutationExportSubmissions } from "@/hooks/use-submissions";
import { parseApiError } from "@/lib/api-error";
import { EXPORT_MAX_ROWS } from "@/lib/submissions";
import type { SubmissionsExportQuery } from "@/types/submissions";

// What a failed export tells the person (decided on the machine `code`, never on `message`). 403 is the global toast's.
type ExportProblem = { kind: "too_large"; matched?: number; max?: number } | { kind: "rate"; minutes?: number } | { kind: "unavailable" } | { kind: "other" };

function classify(error: unknown): ExportProblem | null {
  const parsed = parseApiError(error);
  if (parsed.code === "EXPORT_TOO_LARGE") {
    const d = parsed.details ?? {};
    return { kind: "too_large", matched: typeof d.matched === "number" ? d.matched : undefined, max: typeof d.max === "number" ? d.max : undefined };
  }
  if (parsed.status === 429) return { kind: "rate", minutes: parsed.retryAfter ? Math.max(1, Math.ceil(parsed.retryAfter / 60)) : undefined };
  if (parsed.status === 503) return { kind: "unavailable" };
  if (parsed.status === 403) return null;
  return { kind: "other" };
}

// Saves a Blob as a file without leaving the page. The object URL is released at once.
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// "Export CSV" of the inbox (doc/05 13.7.6, BR-31): the file is fetched with the session (a plain link would carry no token), the
// export is recorded in the audit log (the person is told before), there are 5 a person and hour and at most 50,000 rows.
export function SubmissionsExportDialog({
  open,
  onOpenChange,
  query,
  total,
  summary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: SubmissionsExportQuery;
  // The rows the current filter matches (from the list), shown before the person confirms.
  total: number | undefined;
  // One line per filter that is set, already worded by the list.
  summary: string[];
}) {
  const t = useTranslations("submissions.export");
  const mutation = useMutationExportSubmissions();
  const [problem, setProblem] = useState<ExportProblem | null>(null);
  const tooMany = total !== undefined && total > EXPORT_MAX_ROWS;

  const close = (next: boolean) => {
    if (mutation.isPending) return;
    if (!next) setProblem(null);
    onOpenChange(next);
  };

  const run = () => {
    setProblem(null);
    mutation.mutate(query, {
      onSuccess: ({ blob, filename }) => {
        saveBlob(blob, filename);
        toast.success(t("done"));
        onOpenChange(false);
      },
      onError: (error) => setProblem(classify(error)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md" data-testid="export-dialog">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border bg-muted/30 px-4 py-2 text-sm">
            <div className="flex items-center justify-between gap-4 py-1">
              <span className="text-muted-foreground">{t("rows")}</span>
              <span className="font-medium tabular-nums">{total === undefined ? "-" : total.toLocaleString("en-US")}</span>
            </div>
            {summary.length > 0 ? (
              <ul className="space-y-0.5 border-t py-2 text-muted-foreground" aria-label={t("filters")}>
                {summary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <Alert>
            <ShieldAlertIcon />
            <AlertTitle>{t("auditTitle")}</AlertTitle>
            <AlertDescription>{t("audit")}</AlertDescription>
          </Alert>
          <p className="text-sm text-muted-foreground">{t("excluded")}</p>

          {tooMany ? (
            <p role="alert" className="text-sm text-destructive">
              {t("tooLarge", { matched: total!.toLocaleString("en-US"), max: EXPORT_MAX_ROWS.toLocaleString("en-US") })}
            </p>
          ) : null}
          {problem ? (
            <p role="alert" className="text-sm text-destructive" data-testid="export-problem">
              {problem.kind === "too_large"
                ? t("tooLarge", { matched: (problem.matched ?? 0).toLocaleString("en-US"), max: (problem.max ?? EXPORT_MAX_ROWS).toLocaleString("en-US") })
                : problem.kind === "rate"
                  ? problem.minutes
                    ? t("rateLimitedIn", { minutes: problem.minutes })
                    : t("rateLimited")
                  : problem.kind === "unavailable"
                    ? t("unavailable")
                    : t("failed")}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => close(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" disabled={mutation.isPending || total === 0 || tooMany} onClick={run}>
            {mutation.isPending ? <Spinner /> : <FileDownIcon />}
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
