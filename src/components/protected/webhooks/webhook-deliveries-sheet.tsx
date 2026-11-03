"use client";

import { ChevronDownIcon, ChevronRightIcon, RefreshCwIcon, RotateCcwIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";

import { CustomPagination } from "@/components/global/custom-pagination";
import { EmptyMuted } from "@/components/global/empty";
import { MultiSelectChecklist, type MultiSelectOption } from "@/components/global/multi-select-checklist";
import { SingleSelectFilter, type SelectedType } from "@/components/global/single-select-filter";
import { ErrorState } from "@/components/global/states/error-state";
import { NoPermission } from "@/components/layout/no-permission";
import { useWebhookText } from "@/components/protected/webhooks/webhook-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useMutationRetryWebhookDelivery, useWebhookDeliveries } from "@/hooks/use-webhooks";
import { isNoPermissionError } from "@/lib/api-error";
import { canRetryStatus, retryRefusal } from "@/lib/webhooks";
import type { Webhook, WebhookDelivery, WebhookDeliveryEvent, WebhookDeliveryStatus } from "@/types/webhooks";

const STATUSES: WebhookDeliveryStatus[] = ["pending", "delivering", "succeeded", "failed", "dead"];
const EVENTS: WebhookDeliveryEvent[] = ["content.published", "content.unpublished", "form.submitted", "media.ready", "user.created", "webhook.test"];
const PAGE_SIZE = 20;

const statusVariant = (s: string) => (s === "succeeded" ? "secondary" : s === "dead" || s === "failed" ? "destructive" : "outline");

// Deliveries of one webhook (doc/05 16.7): newest first, filtered by status and event, a row opens to show the receiver's answer as PLAIN
// text, and a failed or dead delivery can be sent again (`ops.webhooks:execute`). The rows are read on demand and never polled.
export function WebhookDeliveriesSheet({ webhook, canRetry, onClose }: { webhook: Webhook; canRetry: boolean; onClose: () => void }) {
  const t = useTranslations("webhooks.deliveries");
  const text = useWebhookText();
  const format = useFormatter();
  const { toastError } = useApiErrorHandler();
  const [page, setPage] = useState(1);
  const [statuses, setStatuses] = useState<MultiSelectOption[]>([]);
  const [event, setEvent] = useState<SelectedType | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [retrying, setRetrying] = useState<number | null>(null);

  const statusOptions = useMemo<MultiSelectOption[]>(() => STATUSES.map((s) => ({ value: s, name: text.status(s) })), [text]);
  const eventOptions = useMemo<SelectedType[]>(() => EVENTS.map((e) => ({ value: e, name: text.event(e) })), [text]);
  const query = useWebhookDeliveries(webhook.id, {
    page,
    limit: PAGE_SIZE,
    ...(statuses.length ? { status: statuses.map((s) => s.value).join(",") } : {}),
    ...(event ? { event: event.value as WebhookDeliveryEvent } : {}),
  });
  const retry = useMutationRetryWebhookDelivery(webhook.id);
  const rows = query.data?.data ?? [];
  const stamp = (v: string | null) => (v ? format.dateTime(new Date(v), { dateStyle: "short", timeStyle: "medium" }) : "-");

  const doRetry = async (row: WebhookDelivery) => {
    setRetrying(row.id);
    try {
      await retry.mutateAsync({ deliveryId: row.id });
      toast.success(t("retried"));
    } catch (error) {
      const reason = retryRefusal(error);
      if (reason) {
        toast.error(t(`retryRefused.${reason}`));
        void query.refetch();
      } else toastError(error, t("retryFailed"));
    } finally {
      setRetrying(null);
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-5xl" data-testid="webhook-deliveries">
        <SheetHeader>
          <SheetTitle className="leading-snug">{t("title", { name: webhook.name })}</SheetTitle>
          <SheetDescription className="break-all leading-snug">{t("description", { max: webhook.max_attempts })}</SheetDescription>
        </SheetHeader>

        <div className="space-y-3 px-4 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <MultiSelectChecklist
              label={t("filters.status")}
              data={statusOptions}
              selectedValues={statuses}
              setSelectedValues={(a) => {
                setStatuses(a);
                setPage(1);
              }}
            />
            <SingleSelectFilter
              label={t("filters.event")}
              data={eventOptions}
              selectedValue={event}
              setSelectedValue={(a) => {
                setEvent(a);
                setPage(1);
              }}
            />
            <Button type="button" variant="outline" size="sm" className="ml-auto" disabled={query.isFetching} onClick={() => void query.refetch()}>
              <RefreshCwIcon className={query.isFetching ? "animate-spin" : undefined} /> {t("refresh")}
            </Button>
          </div>

          {query.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : query.error && isNoPermissionError(query.error) ? (
            <NoPermission className="min-h-40 py-8" />
          ) : query.error && !query.data ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} className="min-h-40 py-8" />
          ) : rows.length === 0 ? (
            <EmptyMuted title={statuses.length || event ? t("emptyFiltered") : t("empty")} />
          ) : (
            <div className="rounded-md border">
              <Table data-testid="webhook-deliveries-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>{t("columns.event")}</TableHead>
                    <TableHead>{t("columns.status")}</TableHead>
                    <TableHead>{t("columns.attempt")}</TableHead>
                    <TableHead>{t("columns.next")}</TableHead>
                    <TableHead>{t("columns.code")}</TableHead>
                    <TableHead>{t("columns.error")}</TableHead>
                    <TableHead>{t("columns.ms")}</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">{t("columns.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const expanded = open === row.id;
                    return (
                      <Fragment key={row.id}>
                        <TableRow data-testid="webhook-delivery-row" data-status={row.status}>
                          <TableCell className="w-8 px-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-expanded={expanded}
                              aria-label={expanded ? t("collapse", { id: row.id }) : t("expand", { id: row.id })}
                              onClick={() => setOpen(expanded ? null : row.id)}
                            >
                              {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                            </Button>
                          </TableCell>
                          <TableCell className="whitespace-normal leading-snug">
                            <span className="font-medium">{text.event(row.event_type)}</span>
                            <p className="text-xs text-muted-foreground">{stamp(row.created_at)}</p>
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(row.status)}>{text.status(row.status)}</Badge>
                          </TableCell>
                          <TableCell>{t("attemptOf", { attempt: row.attempt, max: row.max_attempts })}</TableCell>
                          <TableCell className="text-xs">{row.status === "pending" || row.status === "failed" ? stamp(row.next_attempt_at) : "-"}</TableCell>
                          <TableCell>{row.last_status_code ?? "-"}</TableCell>
                          <TableCell className="max-w-40 whitespace-normal leading-snug">{row.last_error ? text.errorClass(row.last_error) : "-"}</TableCell>
                          <TableCell>{row.response_ms ?? "-"}</TableCell>
                          <TableCell className="text-right">
                            {canRetry && canRetryStatus(row.status) && row.event_type !== "webhook.test" ? (
                              <Button type="button" variant="outline" size="sm" disabled={retrying === row.id} aria-label={t("retryRow", { id: row.id })} onClick={() => void doRetry(row)}>
                                <RotateCcwIcon /> {t("retry")}
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                        {expanded ? (
                          <TableRow data-testid="webhook-delivery-detail" className="bg-muted/30 hover:bg-muted/30">
                            <TableCell />
                            <TableCell colSpan={8} className="space-y-2 whitespace-normal">
                              <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                                <div className="flex min-w-0 gap-1">
                                  <dt className="shrink-0 text-muted-foreground">{t("detail.eventId")}</dt>
                                  <dd className="break-all font-mono">{row.event_id}</dd>
                                </div>
                                <div className="flex gap-1">
                                  <dt className="text-muted-foreground">{t("detail.delivered")}</dt>
                                  <dd>{stamp(row.delivered_at)}</dd>
                                </div>
                              </dl>
                              <p className="text-xs font-medium leading-snug">{t("detail.response")}</p>
                              {row.response_body ? (
                                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-background p-2 font-mono text-xs" data-testid="webhook-delivery-body">
                                  {row.response_body}
                                </pre>
                              ) : (
                                <p className="text-xs text-muted-foreground">{t("detail.noBody")}</p>
                              )}
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {query.data?.meta && query.data.meta.total_page > 1 ? (
            <CustomPagination metaData={query.data.meta} onPageChange={setPage} isLoading={query.isFetching} rowLimit={PAGE_SIZE} setRowLimit={() => undefined} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
