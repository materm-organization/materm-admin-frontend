"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { z } from "zod";

import { CustomPagination } from "@/components/global/custom-pagination";
import { MultiSelectChecklist, type MultiSelectOption } from "@/components/global/multi-select-checklist";
import { StatusBadge } from "@/components/global/status/status-badge";
import { EmptyFiltered } from "@/components/global/states/empty-filtered";
import { ErrorState } from "@/components/global/states/error-state";
import { FetchingBar } from "@/components/global/states/fetching-bar";
import { NoPermission } from "@/components/layout/no-permission";
import { QueueCalendar } from "@/components/protected/publishing/queue-calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFetchCurrentUser } from "@/hooks/use-auth";
import { useListParams } from "@/hooks/use-list-params";
import { usePublishingQueue } from "@/hooks/use-publishing-queue";
import { isNoPermissionError } from "@/lib/api-error";
import { DISPLAY_TIME_ZONE } from "@/lib/datetime";
import type { ListParamsConfig } from "@/lib/list-params";
import { userCan } from "@/lib/permissions";
import { DEFAULT_QUEUE_TAB, QUEUE_DEFAULT_LIMIT, QUEUE_KINDS, QUEUE_KIND_KEYS, QUEUE_TABS, queueRowHref, queueRowKey, queueScheduleHealth } from "@/lib/publishing-queue";
import type { UserRef } from "@/types/media";
import type { QueueAwaitingItem, QueueChangesItem, QueueKind, QueueRowBase, QueueScheduledItem, QueueTab } from "@/types/publishing-queue";

const kindList = z
  .string()
  .transform((v) => v.split(",").filter(Boolean))
  .pipe(z.array(z.enum(QUEUE_KINDS as [QueueKind, ...QueueKind[]])).min(1).max(QUEUE_KINDS.length))
  .optional();

// URL state: ?tab=awaiting_review|scheduled|unpublished_changes&kind=pages,posts&page=2 (doc/07 SCR-39). A tab or kind the URL spells wrong is dropped.
const QUEUE_LIST_CONFIG = {
  filters: { tab: z.enum(QUEUE_TABS as [QueueTab, ...QueueTab[]]).default(DEFAULT_QUEUE_TAB), kind: kindList },
  defaultLimit: QUEUE_DEFAULT_LIMIT,
} satisfies ListParamsConfig;

const person = (u: UserRef | undefined, fallback: string) => u?.name ?? fallback;

// SCR-39 (doc/07, FR-PUB-14): the publishing queue. ONE request carries the counts of the three tabs and the rows of every tab (the active one is
// shown); a person sees only the kinds they may read (the server leaves the rest out). A row opens the editor: the publish bar there holds the
// approve / reject / publish commands (a queue row has no ETag, so nothing is written from here).
export function PublishingQueueScreen() {
  const t = useTranslations("publishingQueue");
  const tKinds = useTranslations("publishingQueue.kinds");
  const format = useFormatter();
  const me = useFetchCurrentUser().data?.data;
  const list = useListParams(QUEUE_LIST_CONFIG);
  const { tab, kind } = list.params.filters;
  const { page, limit } = list.params;
  const queue = usePublishingQueue({ kind, page, limit });
  const [mountedAt] = useState(() => Date.now());
  const now = queue.dataUpdatedAt || mountedAt;

  const kindOptions = useMemo<MultiSelectOption[]>(
    () => QUEUE_KINDS.filter((k) => userCan(me?.permissions, QUEUE_KIND_KEYS[k], "read")).map((k) => ({ value: k, name: tKinds(k) })),
    [me?.permissions, tKinds]
  );
  const selectedKinds = useMemo(() => (kind ?? []).map((k) => ({ value: k, name: tKinds(k) })), [kind, tKinds]);

  const when = (iso: string | null | undefined) => (iso ? format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short", timeZone: DISPLAY_TIME_ZONE }) : "");
  const header = (
    <div>
      <h1 className="text-2xl font-semibold tracking-wide">{t("title")}</h1>
      <p className="mt-1 text-base text-muted-foreground">{t("description")}</p>
    </div>
  );

  if (queue.error && isNoPermissionError(queue.error)) {
    return (
      <div className="space-y-4">
        {header}
        <NoPermission />
      </div>
    );
  }
  if (queue.error && !queue.data) {
    return (
      <div className="space-y-4">
        {header}
        <ErrorState error={queue.error} onRetry={() => void queue.refetch()} isRetrying={queue.isFetching} />
      </div>
    );
  }

  const data = queue.data;
  const active = data?.[tab];
  const meta = active ? { total: active.count, page, limit, total_page: Math.max(1, Math.ceil(active.count / limit)) } : undefined;

  const kindCell = (row: QueueRowBase) => (
    <TableCell>
      <span className="text-sm">{tKinds(row.entity_type)}</span>
      {row.collection_key ? <span className="block font-mono text-xs text-muted-foreground">{row.collection_key}</span> : null}
    </TableCell>
  );
  const titleCell = (row: QueueRowBase) => (
    <TableCell className="max-w-72">
      <Link href={queueRowHref(row)} className="block truncate font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" title={row.title}>
        {row.title}
      </Link>
    </TableCell>
  );
  const actionsCell = (row: QueueRowBase, review: boolean) => (
    <TableCell className="text-end">
      <div className="flex flex-col items-end gap-1">
        {row.can.read ? (
          <Button asChild size="sm" variant="outline">
            <Link href={queueRowHref(row)} aria-label={t("openLabel", { title: row.title })}>
              {t("open")}
            </Link>
          </Button>
        ) : null}
        {review && row.can.review ? <span className="text-xs text-muted-foreground" data-testid="approve-hint">{t("approveHint")}</span> : null}
      </div>
    </TableCell>
  );

  const awaitingRow = (row: QueueAwaitingItem) => (
    <TableRow key={queueRowKey(row)} data-testid="queue-row">
      {titleCell(row)}
      {kindCell(row)}
      <TableCell>
        <StatusBadge status={row.status} />
      </TableCell>
      <TableCell className="text-sm">
        {row.submitted_at
          ? row.submitted_by
            ? t("submittedBy", { name: person(row.submitted_by, t("someone")), when: when(row.submitted_at) })
            : t("submittedAt", { when: when(row.submitted_at) })
          : <span className="text-muted-foreground">{t("submittedUnknown")}</span>}
        <span className="block text-xs text-muted-foreground">{t("editedBy", { name: person(row.updated_by, t("someone")), when: when(row.updated_at) })}</span>
      </TableCell>
      {actionsCell(row, true)}
    </TableRow>
  );

  const scheduledRow = (row: QueueScheduledItem) => {
    const health = queueScheduleHealth(row);
    const changes = row.schedule?.action === "apply_revision" || row.status === "published";
    return (
      <TableRow key={queueRowKey(row)} data-testid="queue-row" data-health={health}>
        {titleCell(row)}
        {kindCell(row)}
        <TableCell>
          <div className="flex flex-wrap gap-1">
            <StatusBadge status={row.status} hasUnpublishedChanges={row.status === "published"} scheduleHealth={health} />
            {row.status === "published" && health !== "ok" && health !== "running" ? <StatusBadge status="scheduled" scheduleHealth={health} /> : null}
          </div>
        </TableCell>
        <TableCell className="text-sm">
          <span className="font-medium">{row.run_at ? t("scheduledFor", { when: when(row.run_at) }) : <span className="text-muted-foreground">{t("noTime")}</span>}</span>
          {row.schedule ? <span className="block text-xs text-muted-foreground">{t(changes ? "action.apply_revision" : "action.publish")}</span> : null}
          {health === "failed" ? (
            <span className="block text-xs text-destructive" data-testid="failed-note">
              {t("failedAfter", { attempts: row.schedule?.attempts ?? 0 })}
              {row.schedule?.last_error ? ` ${t("failedReason", { reason: row.schedule.last_error })}` : ""}
            </span>
          ) : health === "overdue" ? (
            <span className="block text-xs text-amber-900 dark:text-amber-200">{t("overdueNote")}</span>
          ) : null}
        </TableCell>
        {actionsCell(row, false)}
      </TableRow>
    );
  };

  const changesRow = (row: QueueChangesItem) => (
    <TableRow key={queueRowKey(row)} data-testid="queue-row">
      {titleCell(row)}
      {kindCell(row)}
      <TableCell>
        <StatusBadge status={row.status} hasUnpublishedChanges />
      </TableCell>
      <TableCell className="text-sm">{t("editedBy", { name: person(row.draft_updated_by, t("someone")), when: when(row.draft_updated_at) })}</TableCell>
      {actionsCell(row, false)}
    </TableRow>
  );

  const whenHeader = tab === "scheduled" ? t("columns.scheduled") : t("columns.when");
  const rows = (() => {
    if (!data || !active) return null;
    if (tab === "awaiting_review") return data.awaiting_review?.items.map(awaitingRow);
    if (tab === "scheduled") return data.scheduled?.items.map(scheduledRow);
    return data.unpublished_changes?.items.map(changesRow);
  })();

  const body = queue.isLoading ? (
    <div className="space-y-2" aria-busy="true" data-testid="queue-loading">
      <span className="sr-only" role="status">
        {t("loading")}
      </span>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-12 w-full motion-reduce:animate-none" />
      ))}
    </div>
  ) : !active || active.items.length === 0 ? (
    kind ? (
      <EmptyFiltered onClear={() => list.setFilters({ kind: undefined })} />
    ) : (
      <div className="flex flex-col items-center gap-1 py-12 text-center" data-testid="queue-empty">
        <p className="text-sm font-medium">{t(`empty.${tab}`)}</p>
        <p className="text-sm text-muted-foreground">{t(`emptyHint.${tab}`)}</p>
      </div>
    )
  ) : (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.title")}</TableHead>
            <TableHead>{t("columns.kind")}</TableHead>
            <TableHead>{t("columns.status")}</TableHead>
            <TableHead>{whenHeader}</TableHead>
            <TableHead className="text-end">
              <span className="sr-only">{t("columns.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{rows}</TableBody>
      </Table>
    </div>
  );

  return (
    <div className="space-y-4">
      {header}
      <Tabs value={tab} onValueChange={(v) => list.setFilters({ tab: v as QueueTab })}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList aria-label={t("tabsLabel")} className="h-auto flex-wrap">
            {QUEUE_TABS.map((name) => {
              const count = data?.[name]?.count;
              return (
                <TabsTrigger key={name} value={name} data-testid={`tab-${name}`}>
                  {t(`tabs.${name}`)}
                  {count !== undefined ? (
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px] tabular-nums" data-testid={`tab-count-${name}`}>
                      {count}
                    </Badge>
                  ) : null}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {kindOptions.length > 1 ? (
            <div className="flex items-center gap-2">
              <MultiSelectChecklist
                label={t("filters.kind")}
                data={kindOptions}
                selectedValues={selectedKinds}
                setSelectedValues={(action) => {
                  const next = typeof action === "function" ? action(selectedKinds) : action;
                  list.setFilters({ kind: next.length > 0 ? (next.map((o) => o.value) as QueueKind[]) : undefined });
                }}
              />
              {kind ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => list.setFilters({ kind: undefined })}>
                  {t("filters.clear")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <TabsContent value={tab} className="space-y-4">
          {tab === "scheduled" && data?.scheduled && data.scheduled.items.length > 0 ? <QueueCalendar items={data.scheduled.items} now={now} total={data.scheduled.count} /> : null}
          <div>
            <FetchingBar active={queue.isFetching && !queue.isLoading} />
            {body}
          </div>
          {meta && active && active.count > 0 ? (
            <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {t("showing", { shown: active.items.length, count: active.count })}
              </p>
              {meta.total_page > 1 ? <CustomPagination metaData={meta} onPageChange={list.setPage} isLoading={queue.isFetching} rowLimit={limit} setRowLimit={list.setLimit} /> : null}
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
