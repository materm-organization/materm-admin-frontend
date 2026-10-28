"use client";

import { CheckIcon, CopyIcon, SearchIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { ErrorState } from "@/components/global/states/error-state";
import { NoPermission } from "@/components/layout/no-permission";
import { type DiffRow, diffJson, formatValue } from "@/components/protected/audit/json-diff";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuditLog } from "@/hooks/use-audit";
import { isNoPermissionError, parseApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import type { AuditLogEntry } from "@/types/audit";

const KIND_STYLE: Record<DiffRow["kind"], string> = {
  added: "bg-green-500/10 text-green-800 dark:text-green-300",
  removed: "bg-red-500/10 text-red-800 dark:text-red-300",
  changed: "bg-amber-500/10 text-amber-900 dark:text-amber-300",
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

// The detail drawer of SCR-11 (doc/07 section 2.5.3): the full event and the before/after DIFF of the snapshots
// (leaf by leaf, colour + symbol so it does not rely on colour alone), with the server's JSON Patch below.
// `occurred_at` of the row goes with the request so the server reads one partition.
export function AuditDetailSheet({
  entry,
  onClose,
  onFilterRequest,
}: {
  entry: AuditLogEntry | null;
  onClose: () => void;
  // "Show all events of this request" (the list filters by `request_id`).
  onFilterRequest: (requestId: string) => void;
}) {
  const t = useTranslations("audit.detail");
  const tAudit = useTranslations("audit");
  const format = useFormatter();
  const query = useAuditLog(entry?.id ?? null, entry?.occurred_at);
  const detail = query.data?.data;
  const [copied, setCopied] = useState(false);

  const rows = useMemo(() => (detail ? diffJson(detail.before, detail.after) : []), [detail]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context): the id stays selectable */
    }
  };

  const shown = detail ?? entry;
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "medium" });

  return (
    <Sheet open={entry !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="font-mono text-base">{shown?.action}</SheetTitle>
          <SheetDescription>{shown ? when(shown.occurred_at) : ""}</SheetDescription>
        </SheetHeader>
        {shown ? (
          <div className="space-y-5 px-4 pb-6">
            <dl className="grid grid-cols-2 gap-3">
              <Fact label={tAudit("columns.result")}>
                <Badge variant={shown.result === "success" ? "secondary" : "destructive"}>
                  {tAudit(`results.${shown.result}`)}
                </Badge>
              </Fact>
              <Fact label={tAudit("columns.actor")}>
                {shown.actor_name ?? "—"} ({tAudit(`actorTypes.${shown.actor_type}`)})
              </Fact>
              <Fact label={tAudit("columns.entity")}>
                {shown.entity_type ? (
                  <span className="font-mono text-xs">
                    {shown.entity_type}
                    {shown.entity_id !== null ? `#${shown.entity_id}` : ""}
                  </span>
                ) : (
                  "—"
                )}
              </Fact>
              <Fact label={tAudit("columns.ip")}>{shown.ip ?? "—"}</Fact>
              <div className="col-span-2">
                <Fact label={tAudit("columns.summary")}>{shown.summary ?? "—"}</Fact>
              </div>
              <div className="col-span-2">
                <Fact label={t("userAgent")}>{shown.user_agent ?? "—"}</Fact>
              </div>
              <div className="col-span-2">
                <Fact label={t("requestId")}>
                  {shown.request_id ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs select-all">{shown.request_id}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void copy(shown.request_id as string)}
                        aria-label={t("copyRequestId")}
                      >
                        {copied ? <CheckIcon /> : <CopyIcon />}
                        {copied ? t("copied") : t("copy")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onFilterRequest(shown.request_id as string)}
                      >
                        <SearchIcon />
                        {t("sameRequest")}
                      </Button>
                    </span>
                  ) : (
                    "—"
                  )}
                </Fact>
              </div>
            </dl>

            {shown.has_changes ? (
              <section aria-label={t("changes")} className="space-y-2">
                <h3 className="text-sm font-semibold">{t("changes")}</h3>
                {query.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : query.error && isNoPermissionError(query.error) ? (
                  <NoPermission className="min-h-40 py-8" />
                ) : query.error ? (
                  <ErrorState
                    error={query.error}
                    onRetry={() => void query.refetch()}
                    isRetrying={query.isFetching}
                    description={parseApiError(query.error).status === 404 ? t("notFound") : undefined}
                    className="min-h-40 py-8"
                  />
                ) : rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noDiff")}</p>
                ) : (
                  <table className="w-full table-fixed border-collapse text-xs" data-testid="audit-diff">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="w-[34%] py-1 pr-2 font-medium">{t("field")}</th>
                        <th className="w-[33%] py-1 pr-2 font-medium">{t("before")}</th>
                        <th className="w-[33%] py-1 font-medium">{t("after")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.path} className={cn("border-b align-top", KIND_STYLE[row.kind])}>
                          <td className="py-1 pr-2 font-mono break-words">
                            <span aria-hidden>{row.kind === "added" ? "+ " : row.kind === "removed" ? "− " : "~ "}</span>
                            <span className="sr-only">{t(`kinds.${row.kind}`)}: </span>
                            {row.path}
                          </td>
                          <td className="py-1 pr-2 font-mono break-words">{formatValue(row.before)}</td>
                          <td className="py-1 font-mono break-words">{formatValue(row.after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {detail && detail.changes && detail.changes.length > 0 ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">{t("jsonPatch")}</summary>
                    <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-muted p-2 font-mono">
                      {JSON.stringify(detail.changes, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </section>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noChanges")}</p>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
