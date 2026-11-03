"use client";

import { useFormatter, useTranslations } from "next-intl";

import { ErrorState } from "@/components/global/states/error-state";
import { NoPermission } from "@/components/layout/no-permission";
import { Skeleton } from "@/components/ui/skeleton";
import { useEntityAuditLogs } from "@/hooks/use-audit";
import { isNoPermissionError } from "@/lib/api-error";

// The audit trail of one author (`entity_type=cms.author&entity_id=`): the tab shape only, so `cms.blog:read` is enough (doc/05 15.4, 13.9).
export function AuthorActivity({ authorId }: { authorId: number }) {
  const t = useTranslations("authors.activity");
  const format = useFormatter();
  const { data, isLoading, error, refetch, isFetching } = useEntityAuditLogs({ entity_type: "cms.author", entity_id: authorId, limit: 20 });

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (error && isNoPermissionError(error)) return <NoPermission className="min-h-40 py-8" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} isRetrying={isFetching} className="min-h-40 py-8" />;

  const rows = data?.data ?? [];
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  return (
    <ul className="divide-y rounded-md border text-sm" data-testid="author-activity">
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
