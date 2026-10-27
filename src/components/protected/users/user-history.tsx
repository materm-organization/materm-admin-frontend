"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import { ErrorState } from "@/components/global/states/error-state";
import { NoPermission } from "@/components/layout/no-permission";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuditLogs } from "@/hooks/use-audit";
import { useCan } from "@/hooks/use-permission";
import { isNoPermissionError } from "@/lib/api-error";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";

// The "History" tab of SCR-08: the audit trail of this user (`entity_type=iam.user&entity_id=`). The request
// carries NO other filter, so `iam.users:read` is enough (doc/05 section 5.1, FR-AUDIT-03). A link to the full
// audit log is shown when the viewer also has `ops.audit:read`.
export function UserHistory({ userId }: { userId: number }) {
  const t = useTranslations("users.history");
  const format = useFormatter();
  const canAudit = useCan(PERMISSION_KEYS.OPS_AUDIT, PERMISSION_ACTIONS.READ);
  const { data, isLoading, error, refetch, isFetching } = useAuditLogs({
    entity_type: "iam.user",
    entity_id: userId,
    limit: 20,
  });

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (error && isNoPermissionError(error)) return <NoPermission />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} isRetrying={isFetching} />;

  const rows = data?.data ?? [];
  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                <span className="font-mono text-xs">{row.action}</span>
                {row.summary ? <span className="text-muted-foreground"> — {row.summary}</span> : null}
              </span>
              <span className="text-xs text-muted-foreground">
                {row.actor_name ?? "—"} ·{" "}
                {format.dateTime(new Date(row.occurred_at), { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canAudit ? (
        <Link
          href={`/admin/audit?entity_type=iam.user&entity_id=${userId}`}
          className="text-sm underline-offset-4 hover:underline"
        >
          {t("viewAll")}
        </Link>
      ) : null}
    </div>
  );
}
