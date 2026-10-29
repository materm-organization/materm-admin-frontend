"use client";

import { ActivityIcon, ArrowRightIcon, FileEditIcon, ImageOffIcon, InboxIcon, LanguagesIcon, ServerCogIcon, TriangleAlertIcon, WorkflowIcon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { ErrorState } from "@/components/global/states/error-state";
import { NoPermission } from "@/components/layout/no-permission";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetchCurrentUser } from "@/hooks/use-auth";
import { useDashboardSummary } from "@/hooks/use-dashboard";
import { isNoPermissionError, parseApiError } from "@/lib/api-error";
import { ADMIN_ROOT, buildNavMainItemsForUser, getPermissionsForPath, isRouteAllowed } from "@/lib/nav-main-items";
import { getReadablePermissionKeys } from "@/lib/permissions";
import type { DashboardEntityType, DashboardSummary } from "@/types/dashboard";

// Where an entity of each kind is edited (its detail route). A card links only to a route this admin has AND the user may open.
const EDIT_ROUTE: Record<DashboardEntityType, (id: number) => string> = {
  "cms.pages": (id) => `/admin/pages/${id}`,
  "cms.posts": (id) => `/admin/blog/posts/${id}`,
  "cms.albums": (id) => `/admin/galleries/${id}`,
  "cms.faq_groups": (id) => `/admin/faq/${id}`,
  "forms.forms": (id) => `/admin/forms/${id}`,
};
const ENTITY_KEY: Record<DashboardEntityType, string> = {
  "cms.pages": "pages",
  "cms.posts": "posts",
  "cms.albums": "albums",
  "cms.faq_groups": "faqGroups",
  "forms.forms": "forms",
};

function DashCard({ title, description, icon, testId, children, footer }: { title: string; description?: string; icon: ReactNode; testId: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card data-testid={testId} className="gap-3 py-4 shadow-none">
      <CardHeader className="gap-1 px-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden className="text-muted-foreground">{icon}</span>
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        {children}
        {footer}
      </CardContent>
    </Card>
  );
}

function CardLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return null;
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline">
      {children}
      <ArrowRightIcon className="size-3.5 rtl:rotate-180" aria-hidden />
    </Link>
  );
}

const BigNumber = ({ value, label }: { value: number; label: string }) => (
  <p className="flex items-baseline gap-2">
    <span className="text-3xl font-semibold tabular-nums">{value}</span>
    <span className="text-sm text-muted-foreground">{label}</span>
  </p>
);

// SCR-05 (doc/07 section 3.2, doc/05 13.8): the landing page. ONE request; the server leaves out the cards the person may not see, and the
// page shows exactly the cards that came. Every link goes only to a route that exists in this admin and that the person may open.
// `content_counts`, `recent_activity` and `relay` are PROPOSED additions to the documented cards (see `types/dashboard.d.ts`).
export function DashboardView() {
  const t = useTranslations("dashboard");
  const format = useFormatter();
  const me = useFetchCurrentUser().data?.data;
  const readable = getReadablePermissionKeys(me?.permissions);
  const query = useDashboardSummary();
  const data = query.data;

  // A link target, or null when this admin has no such page or the person may not open it.
  const href = (url: string): string | null => {
    const path = url.split("?")[0];
    const access = getPermissionsForPath(path);
    return access.kind !== "unknown" && isRouteAllowed(access, readable) ? url : null;
  };
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  const header = (
    <div>
      <h1 className="text-2xl font-semibold tracking-wide">{t("title")}</h1>
      <p className="mt-1 text-base text-muted-foreground">{t("description")}</p>
    </div>
  );

  if (query.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" data-testid="dashboard-loading">
        {header}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      </div>
    );
  }
  if (query.error && isNoPermissionError(query.error)) return <NoPermission />;
  // A backend that does not have the endpoint yet (404, before T1.5.4 is deployed) has nothing to show: the welcome, not an error page.
  const notThere = query.error ? parseApiError(query.error).status === 404 : false;
  if ((query.error && !notThere) || (!data && !notThere)) {
    return (
      <div className="space-y-4">
        {header}
        <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />
      </div>
    );
  }

  const cards = data ? (Object.keys(data).filter((k) => k !== "generated_at") as Array<keyof DashboardSummary>) : [];
  if (!data || cards.length === 0) {
    // The first page after the dashboard itself (`getFirstAllowedAdminPath` would answer the dashboard, which is open to everybody).
    const group = buildNavMainItemsForUser(readable).find((g) => g.url !== ADMIN_ROOT);
    const first = group ? (group.items?.[0]?.url ?? group.url) : null;
    return (
      <div className="space-y-4">
        {header}
        <Card className="shadow-none" data-testid="dashboard-welcome">
          <CardHeader>
            <CardTitle>{t("welcome.title")}</CardTitle>
            <CardDescription>{first ? t("welcome.body") : t("welcome.nothing")}</CardDescription>
          </CardHeader>
          {first ? (
            <CardContent>
              <CardLink href={first}>{t("welcome.open")}</CardLink>
            </CardContent>
          ) : null}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="dashboard-cards">
        {data.my_drafts ? (
          <DashCard testId="card-my-drafts" title={t("drafts.title")} description={t("drafts.description", { count: data.my_drafts.count })} icon={<FileEditIcon className="size-4" />}>
            {data.my_drafts.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("drafts.none")}</p>
            ) : (
              <ul className="divide-y">
                {data.my_drafts.items.map((item) => {
                  const link = href(EDIT_ROUTE[item.entity_type]?.(item.id) ?? "");
                  return (
                    <li key={`${item.entity_type}-${item.id}`} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <div className="min-w-0">
                        {link ? (
                          <Link href={link} className="block truncate font-medium underline-offset-4 hover:underline">
                            {item.title}
                          </Link>
                        ) : (
                          <span className="block truncate font-medium">{item.title}</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {t(`entities.${ENTITY_KEY[item.entity_type] ?? "pages"}`)} - {when(item.updated_at)}
                        </span>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {item.has_unpublished_changes ? t("drafts.pending") : t("drafts.draft")}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </DashCard>
        ) : null}

        {data.submissions_new ? (
          <DashCard
            testId="card-submissions-new"
            title={t("messages.title")}
            icon={<InboxIcon className="size-4" />}
            footer={<CardLink href={href("/admin/forms/submissions?status=new")}>{t("messages.open")}</CardLink>}
          >
            <BigNumber value={data.submissions_new.count} label={t("messages.label", { count: data.submissions_new.count })} />
          </DashCard>
        ) : null}

        {data.failed_jobs ? (
          <DashCard
            testId="card-failed-jobs"
            title={t("jobs.title")}
            icon={<TriangleAlertIcon className="size-4" />}
            footer={<CardLink href={href("/admin/system")}>{t("jobs.open")}</CardLink>}
          >
            <BigNumber value={data.failed_jobs.count} label={t("jobs.label", { count: data.failed_jobs.count })} />
          </DashCard>
        ) : null}

        {data.translation ? (
          <DashCard testId="card-translation" title={t("translation.title")} description={t("translation.description")} icon={<LanguagesIcon className="size-4" />}>
            {data.translation.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("translation.none")}</p>
            ) : (
              <ul className="space-y-3">
                {data.translation.map((row) => (
                  <li key={row.locale_code} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-mono uppercase">{row.locale_code}</span>
                      <span className="tabular-nums">{row.percent}%</span>
                    </div>
                    <Progress value={row.percent} aria-label={t("translation.aria", { locale: row.locale_code, percent: row.percent })} />
                  </li>
                ))}
              </ul>
            )}
          </DashCard>
        ) : null}

        {data.media_missing_alt ? (
          <DashCard
            testId="card-missing-alt"
            title={t("alt.title")}
            icon={<ImageOffIcon className="size-4" />}
            footer={<CardLink href={href("/admin/media?missing_alt=true")}>{t("alt.open")}</CardLink>}
          >
            <BigNumber value={data.media_missing_alt.count} label={t("alt.label", { count: data.media_missing_alt.count })} />
          </DashCard>
        ) : null}

        {data.content_counts ? (
          <DashCard testId="card-content-counts" title={t("content.title")} description={t("content.proposal")} icon={<WorkflowIcon className="size-4" />}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="pb-1 font-normal">{t("content.kind")}</th>
                  <th scope="col" className="pb-1 text-right font-normal">{t("content.draft")}</th>
                  <th scope="col" className="pb-1 text-right font-normal">{t("content.published")}</th>
                </tr>
              </thead>
              <tbody>
                {data.content_counts.map((row) => (
                  <tr key={row.entity_type} className="border-t">
                    <th scope="row" className="py-1 text-left font-normal">{t(`entities.${ENTITY_KEY[row.entity_type] ?? "pages"}`)}</th>
                    <td className="py-1 text-right tabular-nums">{row.draft}</td>
                    <td className="py-1 text-right tabular-nums">{row.published}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DashCard>
        ) : null}

        {data.recent_activity ? (
          <DashCard
            testId="card-activity"
            title={t("activity.title")}
            description={t("activity.proposal")}
            icon={<ActivityIcon className="size-4" />}
            footer={<CardLink href={href("/admin/audit")}>{t("activity.open")}</CardLink>}
          >
            {data.recent_activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("activity.none")}</p>
            ) : (
              <ul className="divide-y">
                {data.recent_activity.map((row) => (
                  <li key={row.id} className="py-2 text-sm">
                    <p className="break-words">{row.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.actor?.name ?? t("activity.system")} - {when(row.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </DashCard>
        ) : null}

        {data.relay ? (
          <DashCard
            testId="card-relay"
            title={t("relay.title")}
            description={t("relay.proposal")}
            icon={<ServerCogIcon className="size-4" />}
            footer={<CardLink href={href("/admin/system")}>{t("relay.open")}</CardLink>}
          >
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-muted-foreground">{t("relay.pending")}</dt>
                <dd className="text-xl font-semibold tabular-nums">{data.relay.pending}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("relay.failed")}</dt>
                <dd className={data.relay.failed > 0 ? "text-xl font-semibold tabular-nums text-destructive" : "text-xl font-semibold tabular-nums"}>{data.relay.failed}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">{data.relay.last_success_at ? t("relay.lastSuccess", { when: when(data.relay.last_success_at) }) : t("relay.neverSucceeded")}</p>
            {data.relay.failed > 0 ? (
              <p role="status" className="text-sm font-medium text-destructive">
                {t("relay.attention")}
              </p>
            ) : null}
          </DashCard>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{t("updated", { when: when(data.generated_at) })}</p>
    </div>
  );
}
