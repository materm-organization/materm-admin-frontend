"use client";

import { useFormatter, useTranslations } from "next-intl";

import { ErrorState } from "@/components/global/states/error-state";
import { NoPermission } from "@/components/layout/no-permission";
import { Skeleton } from "@/components/ui/skeleton";
import { useEntityAuditLogs } from "@/hooks/use-audit";
import { isNoPermissionError } from "@/lib/api-error";

// The History tab of a collection (`cms.collection`) or of one entry (`cms.collection_entry`): `GET /audit-logs?entity_type=&entity_id=` with the
// NUMERIC id (05 17.10), readable with `cms.collections:read` alone. Server text is shown as plain text.
export function EntityActivity({ entityType, entityId }: { entityType: "cms.collection" | "cms.collection_entry"; entityId: number }) {
  const t = useTranslations("collections.activity");
  const format = useFormatter();
  const { data, isLoading, error, refetch, isFetching } = useEntityAuditLogs({ entity_type: entityType, entity_id: entityId, limit: 20 });

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (error && isNoPermissionError(error)) return <NoPermission className="min-h-40 py-8" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} isRetrying={isFetching} className="min-h-40 py-8" />;
  const rows = data?.data ?? [];
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  return (
    <ul className="divide-y rounded-md border text-sm" data-testid="entity-activity">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <span>
            <span className="font-mono text-xs">{row.action}</span>
            {row.summary ? <span className="text-muted-foreground"> - {row.summary}</span> : null}
          </span>
          <span className="text-xs text-muted-foreground">
            {row.actor_name ?? "-"} · {format.dateTime(new Date(row.occurred_at), { dateStyle: "medium", timeStyle: "short" })}
          </span>
        </li>
      ))}
    </ul>
  );
}
