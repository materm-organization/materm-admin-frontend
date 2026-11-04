"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { ErrorState } from "@/components/global/states/error-state";
import { NotFoundState } from "@/components/global/states/not-found-state";
import { useBreadcrumbTitle } from "@/components/layout/breadcrumb-context";
import { NoPermission } from "@/components/layout/no-permission";
import { DefinitionEditor } from "@/components/protected/collections/definition-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { useCollection } from "@/hooks/use-collections";
import { isNoPermissionError, parseApiError } from "@/lib/api-error";

// SCR-40 `/admin/collections/[key]/schema`: loads the definition (with its schemas and ETag) and renders the editor, remounted after a re-seed.
export function DefinitionHost({ collectionKey }: { collectionKey: string }) {
  const t = useTranslations("collections.host");
  const query = useCollection(collectionKey);
  const [generation, setGeneration] = useState(0);
  const collection = query.data?.data.data;
  useBreadcrumbTitle(query.error ? null : collection?.name);
  const refetch = query.refetch;
  const onReseed = useCallback(async () => {
    await refetch();
    setGeneration((g) => g + 1);
  }, [refetch]);

  if (query.error && isNoPermissionError(query.error)) return <NoPermission />;
  if (query.error && parseApiError(query.error).status === 404) {
    return <NotFoundState title={t("notFoundTitle")} description={t("notFoundDescription")} backHref="/admin/collections" backLabel={t("backToList")} />;
  }
  if (query.error && !collection) return <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />;
  if (!collection) {
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
        <Link href="/admin/collections" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
          {t("backToList")}
        </Link>
        <h1 className="mt-1 break-words text-2xl font-semibold tracking-wide">{collection.name}</h1>
        <p className="mt-1 break-all font-mono text-sm text-muted-foreground">{collection.key} · {t("version", { version: collection.schema_version })}</p>
      </div>
      <DefinitionEditor key={generation} collection={collection} etag={query.data?.etag} onReseed={onReseed} />
    </div>
  );
}
