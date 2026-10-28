"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";

import { ErrorState } from "@/components/global/states/error-state";
import { NotFoundState } from "@/components/global/states/not-found-state";
import { useBreadcrumbTitle } from "@/components/layout/breadcrumb-context";
import { NoPermission } from "@/components/layout/no-permission";
import { PageEditor } from "@/components/protected/pages/editor/page-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { refetchPageSections } from "@/hooks/use-page-sections";
import { usePage } from "@/hooks/use-pages";
import { isNoPermissionError, parseApiError } from "@/lib/api-error";

// SCR-20 (T1.4.8): the host loads the page and shows who it is; `PageEditor` is the editor (PublishBar, tabs, forms).
// A re-seed (after a conflict, a discard, a restore) reads the server's version again and REMOUNTS the editor
// (`generation` is its key), so every form starts again from it.
export function PageHost({ id }: { id: number }) {
  const t = useTranslations("pages.host");
  const queryClient = useQueryClient();
  const query = usePage(id);
  const [generation, setGeneration] = useState(0);
  const page = query.data?.data.data;
  const etag = query.data?.etag;
  useBreadcrumbTitle(query.error ? null : (page?.title ?? page?.name));
  const refetchPage = query.refetch;

  const onReseed = useCallback(
    async (options: { refetchPage?: boolean } = {}) => {
      await Promise.all([options.refetchPage === false ? Promise.resolve() : refetchPage(), refetchPageSections(queryClient, id)]);
      setGeneration((g) => g + 1);
    },
    [id, queryClient, refetchPage]
  );

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

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/pages" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
          {t("backToList")}
        </Link>
        <h1 className="mt-1 break-words text-2xl font-semibold tracking-wide">{page.title ?? page.name}</h1>
        <p className="mt-1 break-all font-mono text-sm text-muted-foreground">{page.path}</p>
      </div>

      {page.deleted_at ? (
        <Alert>
          <AlertTitle>{t("trashedTitle")}</AlertTitle>
          <AlertDescription>{t("trashedBody")}</AlertDescription>
        </Alert>
      ) : null}

      <PageEditor key={generation} page={page} etag={etag} onReseed={onReseed} />
    </div>
  );
}
