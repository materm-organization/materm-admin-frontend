"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { ErrorState } from "@/components/global/states/error-state";
import { NotFoundState } from "@/components/global/states/not-found-state";
import { useBreadcrumbTitle } from "@/components/layout/breadcrumb-context";
import { NoPermission } from "@/components/layout/no-permission";
import { SharedSectionEditor } from "@/components/protected/sections/shared-section-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { useSharedSection } from "@/hooks/use-shared-sections";
import { isNoPermissionError, parseApiError } from "@/lib/api-error";

// SCR-22 `/admin/sections/[id]`: loads the shared section (working copy + ETag); `SharedSectionEditor` is remounted after a re-seed (a conflict, a discard, a
// restore of a revision). A section in the trash is a 404 for a caller without `cms.sections:delete` (05 10.3).
export function SharedSectionHost({ id }: { id: number }) {
  const t = useTranslations("sharedSections.host");
  const query = useSharedSection(id);
  const [generation, setGeneration] = useState(0);
  const section = query.data?.data.data;
  useBreadcrumbTitle(query.error ? null : (section?.name ?? undefined));
  const refetch = query.refetch;
  const onReseed = useCallback(
    async (options: { refetch?: boolean } = {}) => {
      if (options.refetch !== false) await refetch();
      setGeneration((g) => g + 1);
    },
    [refetch]
  );

  if (query.error && isNoPermissionError(query.error)) return <NoPermission />;
  if (query.error && parseApiError(query.error).status === 404) {
    return <NotFoundState title={t("notFoundTitle")} description={t("notFoundDescription")} backHref="/admin/sections" backLabel={t("backToList")} />;
  }
  if (query.error && !section) return <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />;
  if (!section) {
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
      <Link href="/admin/sections" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        {t("backToList")}
      </Link>
      <SharedSectionEditor key={generation} section={section} etag={query.data?.etag} onReseed={onReseed} />
    </div>
  );
}
