"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { ErrorState } from "@/components/global/states/error-state";
import { NotFoundState } from "@/components/global/states/not-found-state";
import { useBreadcrumbTitle } from "@/components/layout/breadcrumb-context";
import { NoPermission } from "@/components/layout/no-permission";
import { FaqEditor } from "@/components/protected/faq/faq-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { faqItemsQueryKey, useFaqGroup } from "@/hooks/use-faq";
import { isNoPermissionError, parseApiError } from "@/lib/api-error";

// SCR-30 (T1.5.6): the host loads the group and shows who it is; `FaqEditor` is the editor. A re-seed (after a conflict, a discard, a
// restore) reads the server's version again and REMOUNTS the editor (`generation` is its key), so every draft starts again from it.
export function FaqHost({ id }: { id: number }) {
  const t = useTranslations("faq.host");
  const queryClient = useQueryClient();
  const query = useFaqGroup(id);
  const [generation, setGeneration] = useState(0);
  const group = query.data?.data.data;
  const etag = query.data?.etag;
  useBreadcrumbTitle(query.error ? null : group?.name);
  const refetchGroup = query.refetch;

  const onReseed = useCallback(
    async (options: { refetchGroup?: boolean } = {}) => {
      if (options.refetchGroup !== false) await refetchGroup();
      await queryClient.invalidateQueries({ queryKey: faqItemsQueryKey(id) });
      setGeneration((g) => g + 1);
    },
    [id, queryClient, refetchGroup]
  );

  if (query.error && isNoPermissionError(query.error)) return <NoPermission />;
  if (query.error && parseApiError(query.error).status === 404) {
    return <NotFoundState title={t("notFoundTitle")} description={t("notFoundDescription")} backHref="/admin/faq" backLabel={t("backToList")} />;
  }
  if (query.error && !group) return <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />;
  if (!group) {
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
        <Link href="/admin/faq" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
          {t("backToList")}
        </Link>
        <h1 className="mt-1 break-words text-2xl font-semibold tracking-wide">{group.name}</h1>
        <p className="mt-1 break-all font-mono text-sm text-muted-foreground">{group.key}</p>
      </div>

      {group.deleted_at ? (
        <Alert>
          <AlertTitle>{t("trashedTitle")}</AlertTitle>
          <AlertDescription>{t("trashedBody")}</AlertDescription>
        </Alert>
      ) : null}

      <FaqEditor key={generation} group={group} etag={etag} onReseed={onReseed} />
    </div>
  );
}
