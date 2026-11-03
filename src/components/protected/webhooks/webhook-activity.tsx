"use client";

import { useFormatter, useTranslations } from "next-intl";

import { ErrorState } from "@/components/global/states/error-state";
import { NoPermission } from "@/components/layout/no-permission";
import { Skeleton } from "@/components/ui/skeleton";
import { useEntityAuditLogs } from "@/hooks/use-audit";
import { isNoPermissionError } from "@/lib/api-error";
import { auditActionSuffix } from "@/lib/webhooks";

const KNOWN_ACTIONS = ["created", "updated", "deleted", "secret_rotated", "tested", "retried", "disabled"];

// The History tab of one webhook (`entity_type=ops.webhook&entity_id=`): the tab shape only, so `ops.webhooks:read` is enough (doc/05 16.9, 13.9).
// The server's `summary` is plain text and is shown as such; the audit `after` never holds the secret.
export function WebhookActivity({ webhookId }: { webhookId: number }) {
  const t = useTranslations("webhooks.activity");
  const format = useFormatter();
  const { data, isLoading, error, refetch, isFetching } = useEntityAuditLogs({ entity_type: "ops.webhook", entity_id: webhookId, limit: 20 });

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (error && isNoPermissionError(error)) return <NoPermission className="min-h-40 py-8" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} isRetrying={isFetching} className="min-h-40 py-8" />;

  const rows = data?.data ?? [];
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  return (
    <ul className="divide-y rounded-md border text-sm" data-testid="webhook-activity">
      {rows.map((row) => {
        const suffix = auditActionSuffix(row.action);
        return (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0 leading-snug">
              <span className="font-medium">{KNOWN_ACTIONS.includes(suffix) ? t(`actions.${suffix}`) : row.action}</span>
              {row.summary ? <span className="text-muted-foreground"> - {row.summary}</span> : null}
            </span>
            <span className="text-xs text-muted-foreground">
              {row.actor_type === "system" ? t("systemActor") : (row.actor_name ?? "-")} · {format.dateTime(new Date(row.occurred_at), { dateStyle: "medium", timeStyle: "short" })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
