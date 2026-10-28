"use client";

import { ArrowLeftIcon, InfoIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";

import { PublishBar, type PublishBarResult } from "@/components/global/publishing/publish-bar";
import { fieldSegments, issueTarget } from "@/components/global/publishing/issue-target";
import { RevisionsTab, type RestoredRevision } from "@/components/global/revisions/revisions-tab";
import { ErrorState } from "@/components/global/states/error-state";
import { NotFoundState } from "@/components/global/states/not-found-state";
import { TranslationBadges } from "@/components/global/status/translation-badges";
import { useBreadcrumbTitle } from "@/components/layout/breadcrumb-context";
import { NoPermission } from "@/components/layout/no-permission";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePage, writeThroughPage } from "@/hooks/use-pages";
import { useCan } from "@/hooks/use-permission";
import { isNoPermissionError, parseApiError } from "@/lib/api-error";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { PageDetail } from "@/types/pages";
import type { PublishIssueTarget } from "@/types/publishing";

const TABS = ["overview", "revisions"] as const;
type Tab = (typeof TABS)[number];

// The page as far as T1.4.7 goes: the publishing bar (state, Save draft's place, Publish with its blockers, Unpublish,
// Discard, preview) and the History tab (SCR-37 for a publishable entity). The sections / details / SEO editor of SCR-20 is
// T1.4.8: it replaces the "overview" body and keeps this wiring - `PublishBar` takes `isDirty` / `flush` / `onSaveDraft`
// from the editor's form, and "Go to field" opens the field named by the pointer (here it is shown, `?field=`).
export function PageHost({ id }: { id: number }) {
  const t = useTranslations("pages.host");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const query = usePage(id);
  const page = query.data?.data.data;
  const etag = query.data?.etag;
  useBreadcrumbTitle(query.error ? null : (page?.title ?? page?.name));
  const canUpdate = useCan(PERMISSION_KEYS.CMS_PAGES, PERMISSION_ACTIONS.UPDATE);

  const tabParam = search.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "overview";
  const field = search.get("field");
  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  if (query.error && isNoPermissionError(query.error)) return <NoPermission />;
  if (query.error && parseApiError(query.error).status === 404) {
    return <NotFoundState title={t("notFoundTitle")} description={t("notFoundDescription")} backHref="/admin/pages" backLabel={t("backToList")} />;
  }
  if (query.error && !page) return <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />;
  if (!page) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // A command answered with the page and its NEW ETag: it goes straight into the cache.
  const onResult = (result: PublishBarResult) => writeThroughPage(queryClient, id, { data: result.data as Partial<PageDetail>, etag: result.etag });
  const onRestored = (result: RestoredRevision) => writeThroughPage(queryClient, id, { data: result.data, etag: result.etag });

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/pages" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
          {t("backToList")}
        </Link>
        <h1 className="mt-1 break-words text-2xl font-semibold tracking-wide">{page.title ?? page.name}</h1>
        <p className="mt-1 font-mono text-sm text-muted-foreground">{page.path}</p>
      </div>

      {page.deleted_at ? (
        <Alert>
          <AlertTitle>{t("trashedTitle")}</AlertTitle>
          <AlertDescription>{t("trashedBody")}</AlertDescription>
        </Alert>
      ) : null}

      <PublishBar
        resource="pages"
        entity={{ id: page.id, status: page.status, has_unpublished_changes: page.has_unpublished_changes, deleted_at: page.deleted_at, is_home: page.is_home, is_system: page.is_system }}
        etag={etag}
        onResult={onResult}
        onRefresh={() => query.refetch()}
        onGoToField={(target: PublishIssueTarget) =>
          setParams({
            field: target.pointer,
            sectionKey: target.sectionKey ?? null,
            sectionIndex: target.sectionIndex !== undefined ? String(target.sectionIndex) : null,
            tab: null,
          })
        }
      />

      {field ? (
        <FieldTarget
          pointer={field}
          sectionKey={search.get("sectionKey")}
          sectionIndex={search.get("sectionIndex")}
          onClose={() => setParams({ field: null, sectionKey: null, sectionIndex: null })}
        />
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value === "overview" ? null : value })}>
        <TabsList>
          <TabsTrigger value="overview">{t("tabs.overview")}</TabsTrigger>
          <TabsTrigger value="revisions">{t("tabs.revisions")}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-4 pt-2">
          <Overview page={page} />
          <Alert>
            <InfoIcon aria-hidden />
            <AlertTitle>{t("editorSoonTitle")}</AlertTitle>
            <AlertDescription>{t("editorSoonBody")}</AlertDescription>
          </Alert>
        </TabsContent>
        <TabsContent value="revisions" className="pt-2">
          <RevisionsTab resource="pages" id={id} canRestore={canUpdate && !page.deleted_at} etag={etag} onRestored={onRestored} onRefresh={() => query.refetch()} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Overview({ page }: { page: PageDetail }) {
  const t = useTranslations("pages.host.overview");
  const tPages = useTranslations("pages");
  const format = useFormatter();
  const when = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" }) : t("never"));
  const rows: Array<[string, string]> = [
    [t("path"), page.path],
    [t("template"), tPages.has(`templates.${page.template}`) ? tPages(`templates.${page.template}`) : page.template],
    [t("sections"), String(page.section_count)],
    [t("publishedAt"), when(page.published_at)],
    [t("updatedAt"), when(page.updated_at)],
  ];
  return (
    <div className="space-y-3">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <TranslationBadges status={page.translation_status} />
    </div>
  );
}

// "Go to field", as far as there is no editor: say which field the pointer names. The editor of T1.4.8 opens it instead.
function FieldTarget({ pointer, sectionKey, sectionIndex, onClose }: { pointer: string; sectionKey: string | null; sectionIndex: string | null; onClose: () => void }) {
  const t = useTranslations("pages.host.fieldTarget");
  const tp = useTranslations("publishing");
  const issue = { path: pointer, code: "", params: sectionKey ? { section_key: sectionKey, ...(sectionIndex !== null ? { section_index: Number(sectionIndex) } : {}) } : undefined };
  const target = issueTarget(issue);
  const { field, locale } = fieldSegments(issue, (segment) => (tp.has(`fields.${segment}`) ? tp(`fields.${segment}`) : undefined));
  const section =
    target.sectionPublicId !== undefined
      ? `${target.sectionIndex !== undefined ? `${target.sectionIndex + 1}. ` : ""}${target.sectionKey && tp.has(`sectionTypes.${target.sectionKey}`) ? tp(`sectionTypes.${target.sectionKey}`) : (target.sectionKey ?? "")}`
      : null;
  return (
    <Alert data-testid="field-target">
      <AlertTitle>{t("title")}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>
          {section ? `${section} › ` : ""}
          <span className="font-medium">{field || tp("fields.whole")}</span>
          {locale ? ` (${locale})` : ""}
          <code className="ms-2 break-all rounded bg-muted px-1 py-0.5 text-xs" data-testid="field-target-pointer">{pointer}</code>
        </span>
        <button type="button" className="text-sm underline underline-offset-2" onClick={onClose}>
          {t("close")}
        </button>
      </AlertDescription>
    </Alert>
  );
}
