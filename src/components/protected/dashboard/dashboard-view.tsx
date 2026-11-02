"use client";

import { ActivityIcon, ArrowRightIcon, CheckCircle2Icon, ClockIcon, FileEditIcon, ImageOffIcon, InboxIcon, LanguagesIcon, LayersIcon, LayoutDashboardIcon, ServerCogIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { ErrorState } from "@/components/global/states/error-state";
import { NoPermission } from "@/components/layout/no-permission";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFetchCurrentUser } from "@/hooks/use-auth";
import { useDashboardSummary } from "@/hooks/use-dashboard";
import { cn } from "@/lib/utils";
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

type Tone = "calm" | "primary" | "destructive";

const TILE: Record<Tone, string> = {
  calm: "bg-muted text-muted-foreground",
  primary: "bg-primary/15 text-foreground",
  destructive: "bg-destructive/10 text-destructive",
};
const EDGE: Record<Tone, string> = { calm: "", primary: "border-l-4 border-l-primary", destructive: "border-l-4 border-l-destructive" };

function DashCard({
  title,
  description,
  icon,
  testId,
  children,
  footer,
  tone = "calm",
  badge,
  className,
}: {
  title: string;
  description?: string;
  icon: ReactNode;
  testId: string;
  children: ReactNode;
  footer?: ReactNode;
  tone?: Tone;
  badge?: ReactNode;
  className?: string;
}) {
  return (
    <Card data-testid={testId} data-attention={tone !== "calm"} className={cn("gap-3 py-4 shadow-none", EDGE[tone], className)}>
      <CardHeader className="gap-1 px-4">
        <CardTitle role="heading" aria-level={2} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold leading-snug">
          <span className="flex min-w-0 flex-1 basis-40 items-center gap-2">
            <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center rounded-md [&_svg]:size-4", TILE[tone])}>
              {icon}
            </span>
            <span className="min-w-0">{title}</span>
          </span>
          {badge ? <span className="ms-auto shrink-0 ps-9">{badge}</span> : null}
        </CardTitle>
        {description ? <CardDescription className="leading-snug">{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 px-4">
        {children}
        {footer ? <div className="mt-auto border-t pt-3">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}

function CardLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return null;
  return (
    <Link
      href={href}
      className="group inline-flex min-h-8 items-center gap-1 rounded-sm text-sm font-medium leading-snug underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {children}
      <ArrowRightIcon className="size-3.5 transition-transform rtl:rotate-180 motion-safe:group-hover:translate-x-0.5 rtl:motion-safe:group-hover:-translate-x-0.5" aria-hidden />
    </Link>
  );
}

const KpiNumber = ({ value, label, danger }: { value: number; label: string; danger?: boolean }) => (
  <p className="flex items-baseline gap-2">
    <span className={cn("text-4xl font-semibold leading-none tabular-nums", danger && "text-destructive")}>{value}</span>
    <span className="text-sm leading-snug text-muted-foreground">{label}</span>
  </p>
);

function AllClear({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs leading-snug text-muted-foreground">
      <CheckCircle2Icon className="size-4 shrink-0" aria-hidden />
      {text}
    </p>
  );
}

function EmptyList({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <Empty className="gap-2 border-0 p-2 md:p-4">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

const KPI_GRID = "grid items-stretch gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";
// Columns that pack: cards of any height sit under each other without holes (a grid would leave a blank under a short card).
const SKELETON_GRID = "grid items-start gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3";
const DETAIL_GRID = "columns-1 gap-4 lg:columns-2 xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid";
const ACTIVITY_ROWS = 5;
const SKELETON = "motion-reduce:animate-none";

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
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground sm:text-base">{t("description")}</p>
    </div>
  );
  const page = "mx-auto w-full max-w-[96rem] space-y-6";

  if (query.isLoading) {
    return (
      <div className={page} aria-busy="true" data-testid="dashboard-loading">
        {header}
        <span className="sr-only" role="status">
          {t("loading")}
        </span>
        <div className={KPI_GRID} aria-hidden>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className={`h-32 w-full rounded-xl ${SKELETON}`} />
          ))}
        </div>
        <div className={SKELETON_GRID} aria-hidden>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className={`h-56 w-full rounded-xl ${SKELETON}`} />
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
      <div className={page}>
        {header}
        <ErrorState className="min-h-[40svh]" error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />
      </div>
    );
  }

  const cards = data ? (Object.keys(data).filter((k) => k !== "generated_at") as Array<keyof DashboardSummary>) : [];
  if (!data || cards.length === 0) {
    // The first page after the dashboard itself (`getFirstAllowedAdminPath` would answer the dashboard, which is open to everybody).
    const group = buildNavMainItemsForUser(readable).find((g) => g.url !== ADMIN_ROOT);
    const first = group ? (group.items?.[0]?.url ?? group.url) : null;
    return (
      <div className={page}>
        {header}
        <Card className="shadow-none" data-testid="dashboard-welcome">
          <CardHeader className="flex-row items-start gap-3">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground [&_svg]:size-5">
              <LayoutDashboardIcon />
            </span>
            <div className="space-y-1.5">
              <CardTitle className="leading-snug">{t("welcome.title")}</CardTitle>
              <CardDescription className="leading-snug">{first ? t("welcome.body") : t("welcome.nothing")}</CardDescription>
            </div>
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

  const hasKpi = Boolean(data.submissions_new || data.failed_jobs || data.media_missing_alt);
  const kpis = [
    data.submissions_new && { testId: "card-submissions-new", count: data.submissions_new.count, label: t("messages.label", { count: data.submissions_new.count }), href: href("/admin/forms/submissions?status=new"), open: t("messages.open") },
    data.failed_jobs && { testId: "card-failed-jobs", count: data.failed_jobs.count, label: t("jobs.label", { count: data.failed_jobs.count }), href: href("/admin/system"), open: t("jobs.open") },
    data.media_missing_alt && { testId: "card-missing-alt", count: data.media_missing_alt.count, label: t("alt.label", { count: data.media_missing_alt.count }), href: href("/admin/media?missing_alt=true"), open: t("alt.open") },
  ].filter((k): k is NonNullable<typeof k> => Boolean(k));
  // Nothing needs attention: one slim strip instead of three tall cards (or a blank where they would be).
  const allClear = kpis.every((k) => k.count === 0);
  const attention = <Badge variant="outline">{t("attention")}</Badge>;
  const attentionDanger = <Badge variant="destructive">{t("attention")}</Badge>;

  return (
    <div className={page}>
      {header}
      <div className="space-y-6" data-testid="dashboard-cards">
        {allClear ? (
          <section aria-label={t("sections.glance")} data-testid="dashboard-all-clear" className="rounded-xl border bg-card px-4 py-3 text-card-foreground">
            <p className="flex items-center gap-2 text-sm font-medium leading-snug">
              <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
                <CheckCircle2Icon />
              </span>
              {t("nothingNeeded")}
            </p>
            {kpis.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-x-8 gap-y-2 border-t pt-3">
                {kpis.map((k) => (
                  <li key={k.testId} data-testid={k.testId} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xl font-semibold leading-none tabular-nums">{k.count}</span>
                    <span className="text-sm leading-snug text-muted-foreground">{k.label}</span>
                    <CardLink href={k.href}>{k.open}</CardLink>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {hasKpi && !allClear ? (
          <section aria-label={t("sections.glance")} className={KPI_GRID}>
            {data.submissions_new ? (
              <DashCard
                testId="card-submissions-new"
                className="h-full"
                tone={data.submissions_new.count > 0 ? "primary" : "calm"}
                badge={data.submissions_new.count > 0 ? attention : undefined}
                title={t("messages.title")}
                icon={<InboxIcon />}
                footer={<CardLink href={href("/admin/forms/submissions?status=new")}>{t("messages.open")}</CardLink>}
              >
                <KpiNumber value={data.submissions_new.count} label={t("messages.label", { count: data.submissions_new.count })} />
                {data.submissions_new.count === 0 ? <AllClear text={t("allClear")} /> : null}
              </DashCard>
            ) : null}

            {data.failed_jobs ? (
              <DashCard
                testId="card-failed-jobs"
                className="h-full"
                tone={data.failed_jobs.count > 0 ? "destructive" : "calm"}
                badge={data.failed_jobs.count > 0 ? attentionDanger : undefined}
                title={t("jobs.title")}
                icon={<TriangleAlertIcon />}
                footer={<CardLink href={href("/admin/system")}>{t("jobs.open")}</CardLink>}
              >
                <KpiNumber value={data.failed_jobs.count} label={t("jobs.label", { count: data.failed_jobs.count })} danger={data.failed_jobs.count > 0} />
                {data.failed_jobs.count === 0 ? <AllClear text={t("allClear")} /> : null}
              </DashCard>
            ) : null}

            {data.media_missing_alt ? (
              <DashCard
                testId="card-missing-alt"
                className="h-full"
                tone={data.media_missing_alt.count > 0 ? "primary" : "calm"}
                badge={data.media_missing_alt.count > 0 ? attention : undefined}
                title={t("alt.title")}
                icon={<ImageOffIcon />}
                footer={<CardLink href={href("/admin/media?missing_alt=true")}>{t("alt.open")}</CardLink>}
              >
                <KpiNumber value={data.media_missing_alt.count} label={t("alt.label", { count: data.media_missing_alt.count })} />
                {data.media_missing_alt.count === 0 ? <AllClear text={t("allClear")} /> : null}
              </DashCard>
            ) : null}
          </section>
        ) : null}

        <section aria-label={t("sections.details")} className={DETAIL_GRID}>
          {data.my_drafts ? (
            <DashCard testId="card-my-drafts" title={t("drafts.title")} description={t("drafts.description", { count: data.my_drafts.count })} icon={<FileEditIcon />}>
              {data.my_drafts.items.length === 0 ? (
                <EmptyList icon={<CheckCircle2Icon />} text={t("drafts.none")} />
              ) : (
                <ul className="divide-y">
                  {data.my_drafts.items.map((item) => {
                    const link = href(EDIT_ROUTE[item.entity_type]?.(item.id) ?? "");
                    return (
                      <li
                        key={`${item.entity_type}-${item.id}`}
                        className="relative -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2.5 text-sm hover:bg-muted/50 focus-within:bg-muted/50"
                      >
                        <div className="min-w-0">
                          {link ? (
                            <Link
                              href={link}
                              className="block truncate font-medium leading-snug underline-offset-4 after:absolute after:inset-0 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                            >
                              {item.title}
                            </Link>
                          ) : (
                            <span className="block truncate font-medium leading-snug">{item.title}</span>
                          )}
                          <span className="text-xs leading-snug text-muted-foreground">
                            {t(`entities.${ENTITY_KEY[item.entity_type] ?? "pages"}`)} - <time dateTime={item.updated_at}>{when(item.updated_at)}</time>
                          </span>
                        </div>
                        <Badge variant={item.has_unpublished_changes ? "secondary" : "outline"} className="shrink-0">
                          {item.has_unpublished_changes ? t("drafts.pending") : t("drafts.draft")}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </DashCard>
          ) : null}

          {data.recent_activity ? (
            <DashCard
              testId="card-activity"
              title={t("activity.title")}
              description={t("activity.proposal")}
              icon={<ActivityIcon />}
              footer={<CardLink href={href("/admin/audit")}>{t("activity.open")}</CardLink>}
            >
              {data.recent_activity.length === 0 ? (
                <EmptyList icon={<InboxIcon />} text={t("activity.none")} />
              ) : (
                <ul className="divide-y">
                  {data.recent_activity.slice(0, ACTIVITY_ROWS).map((row) => (
                    <li key={row.id} className="relative py-2 ps-4 text-sm">
                      <span aria-hidden className="absolute start-0 top-[0.9rem] size-1.5 rounded-full bg-primary/60" />
                      <p className="break-words leading-snug">{row.summary}</p>
                      <p className="text-xs leading-snug text-muted-foreground">
                        {row.actor?.name ?? t("activity.system")} - <time dateTime={row.created_at}>{when(row.created_at)}</time>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </DashCard>
          ) : null}

          {data.translation ? (
            <DashCard testId="card-translation" title={t("translation.title")} description={t("translation.description")} icon={<LanguagesIcon />}>
              {data.translation.length === 0 ? (
                <EmptyList icon={<LanguagesIcon />} text={t("translation.none")} />
              ) : (
                <ul className="space-y-4">
                  {data.translation.map((row) => (
                    <li key={row.locale_code} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-mono text-xs font-medium uppercase">{row.locale_code}</span>
                        <span className="tabular-nums">{row.percent}%</span>
                      </div>
                      <Progress className="h-2" value={row.percent} aria-label={t("translation.aria", { locale: row.locale_code, percent: row.percent })} />
                    </li>
                  ))}
                </ul>
              )}
            </DashCard>
          ) : null}

          {data.content_counts ? (
            <DashCard testId="card-content-counts" title={t("content.title")} description={t("content.proposal")} icon={<LayersIcon />}>
              <Table className="text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-8 px-0 text-xs font-normal text-muted-foreground">{t("content.kind")}</TableHead>
                    <TableHead className="h-8 px-0 text-end text-xs font-normal text-muted-foreground">{t("content.draft")}</TableHead>
                    <TableHead className="h-8 ps-2 pe-0 text-end text-xs font-normal text-muted-foreground">{t("content.published")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.content_counts.map((row) => (
                    <TableRow key={row.entity_type}>
                      <TableHead scope="row" className="h-auto px-0 py-2 text-start font-medium whitespace-normal text-foreground">
                        {t(`entities.${ENTITY_KEY[row.entity_type] ?? "pages"}`)}
                      </TableHead>
                      <TableCell className="px-0 py-2 text-end tabular-nums">{row.draft}</TableCell>
                      <TableCell className="ps-2 pe-0 py-2 text-end tabular-nums">{row.published}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DashCard>
          ) : null}

          {data.relay ? (
            <DashCard
              testId="card-relay"
              tone={data.relay.failed > 0 ? "destructive" : "calm"}
              badge={data.relay.failed > 0 ? attentionDanger : undefined}
              title={t("relay.title")}
              description={t("relay.proposal")}
              icon={<ServerCogIcon />}
              footer={<CardLink href={href("/admin/system")}>{t("relay.open")}</CardLink>}
            >
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="mb-1 text-xs leading-snug text-muted-foreground">{t("relay.pending")}</dt>
                  <dd className="text-2xl font-semibold leading-none tabular-nums">{data.relay.pending}</dd>
                </div>
                <div>
                  <dt className="mb-1 text-xs leading-snug text-muted-foreground">{t("relay.failed")}</dt>
                  <dd className={cn("text-2xl font-semibold leading-none tabular-nums", data.relay.failed > 0 && "text-destructive")}>{data.relay.failed}</dd>
                </div>
              </dl>
              <p className="flex items-center gap-1.5 border-t pt-3 text-xs leading-snug text-muted-foreground">
                <ClockIcon className="size-3.5 shrink-0" aria-hidden />
                {data.relay.last_success_at ? t("relay.lastSuccess", { when: when(data.relay.last_success_at) }) : t("relay.neverSucceeded")}
              </p>
              {data.relay.failed > 0 ? (
                <p role="status" className="text-sm font-medium leading-snug text-destructive">
                  {t("relay.attention")}
                </p>
              ) : null}
            </DashCard>
          ) : null}
        </section>
      </div>
      <p className="flex items-center gap-1.5 text-xs leading-snug text-muted-foreground">
        <ClockIcon className="size-3.5 shrink-0" aria-hidden />
        {t("updated", { when: when(data.generated_at) })}
      </p>
    </div>
  );
}
