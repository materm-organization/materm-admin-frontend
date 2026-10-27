"use client";

import { CircleAlertIcon, CircleCheckIcon, CircleMinusIcon, CircleXIcon, RefreshCwIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ComponentType } from "react";

import { ErrorState } from "@/components/global/states/error-state";
import { NoPermission } from "@/components/layout/no-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { SYSTEM_STATUS_REFETCH_MS, useSystemStatus } from "@/hooks/use-system";
import { isNoPermissionError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import type { DependencyStatus, OverallStatus } from "@/types/system";

type Status = OverallStatus | DependencyStatus;

const STATUS_STYLE: Record<Status, { icon: ComponentType<{ className?: string }>; className: string }> = {
  ok: { icon: CircleCheckIcon, className: "text-green-700 dark:text-green-400" },
  degraded: { icon: CircleAlertIcon, className: "text-amber-700 dark:text-amber-400" },
  down: { icon: CircleXIcon, className: "text-red-700 dark:text-red-400" },
  // Not configured is NOT a failure: grey.
  not_configured: { icon: CircleMinusIcon, className: "text-muted-foreground" },
};

// Status is never colour alone: icon + word.
function StatusLabel({ status }: { status: Status }) {
  const t = useTranslations("system.status");
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.not_configured;
  const Icon = style.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium", style.className)}>
      <Icon className="size-4" aria-hidden />
      {t.has(status) ? t(status) : status}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right break-all">{children}</dd>
    </div>
  );
}

// SCR-45 (doc/07 section 3.28): read-only cards — overall state, service, the four dependencies (database,
// redis, file store, mailer), counters. Re-read every 30 s and with the refresh button. No config values or
// hosts are shown (the endpoint does not return them).
export function SystemStatusView() {
  const t = useTranslations("system");
  const format = useFormatter();
  const { data, isLoading, isFetching, error, refetch, dataUpdatedAt } = useSystemStatus();

  if (error && isNoPermissionError(error)) return <NoPermission />;
  if (error && !data) return <ErrorState error={error} onRetry={() => void refetch()} isRetrying={isFetching} />;
  if (isLoading || !data) {
    return (
      <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    );
  }

  const status = data.data;
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "medium" });
  const days = Math.floor(status.service.uptime_seconds / 86400);
  const hours = Math.floor((status.service.uptime_seconds % 86400) / 3600);
  const minutes = Math.floor((status.service.uptime_seconds % 3600) / 60);
  const counters = Object.entries(status.counters ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-lg" role="status">
          {t("overall")}: <StatusLabel status={status.status} />
        </p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {t("updated", {
              time: format.dateTime(new Date(dataUpdatedAt), { timeStyle: "medium" }),
              seconds: SYSTEM_STATUS_REFETCH_MS / 1000,
            })}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? <Spinner /> : <RefreshCwIcon />}
            {t("refresh")}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("service.title")}</CardTitle>
            <CardDescription>{status.service.name}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl>
              <Row label={t("service.version")}>{status.service.version}</Row>
              <Row label={t("service.commit")}>
                <span className="font-mono text-xs">{status.service.commit || "—"}</span>
              </Row>
              <Row label={t("service.environment")}>{status.service.environment}</Row>
              <Row label={t("service.startedAt")}>{when(status.service.started_at)}</Row>
              <Row label={t("service.uptime")}>{t("service.uptimeValue", { days, hours, minutes })}</Row>
              <Row label={t("service.serverTime")}>{when(status.service.server_time)}</Row>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("dependencies.title")}</CardTitle>
            <CardDescription>{t("dependencies.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {status.dependencies.map((dep) => (
                <li key={dep.name} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="font-medium">
                    {t.has(`dependencies.names.${dep.name}`) ? t(`dependencies.names.${dep.name}`) : dep.name}
                  </span>
                  <span className="flex items-center gap-3">
                    {dep.latency_ms !== null && dep.latency_ms !== undefined ? (
                      <span className="text-xs text-muted-foreground">{t("dependencies.latency", { ms: dep.latency_ms })}</span>
                    ) : null}
                    {dep.error_code ? (
                      <Badge variant="outline" className="font-mono">
                        {t.has(`errorCodes.${dep.error_code}`) ? t(`errorCodes.${dep.error_code}`) : dep.error_code}
                      </Badge>
                    ) : null}
                    <StatusLabel status={dep.status} />
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("counters.title")}</CardTitle>
            <CardDescription>{t("counters.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            {counters.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("counters.empty")}</p>
            ) : (
              <dl>
                {counters.map(([key, value]) => (
                  <Row key={key} label={t.has(`counters.names.${key}`) ? t(`counters.names.${key}`) : key}>
                    {format.number(value)}
                  </Row>
                ))}
              </dl>
            )}
          </CardContent>
        </Card>

        {status.outbox ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("outbox.title")}</CardTitle>
              <CardDescription>{t("outbox.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl>
                <Row label={t("outbox.pending")}>{format.number(status.outbox.pending ?? 0)}</Row>
                <Row label={t("outbox.failed")}>{format.number(status.outbox.failed ?? 0)}</Row>
                <Row label={t("outbox.lastSuccess")}>
                  {status.outbox.last_success_at ? when(status.outbox.last_success_at) : "—"}
                </Row>
              </dl>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
