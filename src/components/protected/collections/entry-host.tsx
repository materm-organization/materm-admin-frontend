"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { ErrorState } from "@/components/global/states/error-state";
import { NotFoundState } from "@/components/global/states/not-found-state";
import { useBreadcrumbTitle } from "@/components/layout/breadcrumb-context";
import { NoPermission } from "@/components/layout/no-permission";
import { EntryEditor } from "@/components/protected/collections/entry-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useCollection, useCollectionEntry } from "@/hooks/use-collections";
import { isNoPermissionError, parseApiError } from "@/lib/api-error";

// SCR-41 `/admin/collections/[key]/[id]`: loads the definition (its schemas) and the entry (its working copy and ETag); `EntryEditor` is the editor,
// remounted after a re-seed (a conflict, a discard, a restore). An id of another collection is a 404 from the server.
export function EntryHost({ collectionKey, id }: { collectionKey: string; id: number }) {
  const t = useTranslations("collections.entries.host");
  const collectionQuery = useCollection(collectionKey);
  const entryQuery = useCollectionEntry(collectionKey, id);
  const [generation, setGeneration] = useState(0);
  const collection = collectionQuery.data?.data.data;
  const entry = entryQuery.data?.data.data;
  useBreadcrumbTitle(entryQuery.error ? null : (entry?.title ?? (entry ? `#${entry.id}` : undefined)));
  const refetchEntry = entryQuery.refetch;
  const onReseed = useCallback(
    async (options: { refetch?: boolean } = {}) => {
      if (options.refetch !== false) await refetchEntry();
      setGeneration((g) => g + 1);
    },
    [refetchEntry]
  );

  const error = entryQuery.error ?? collectionQuery.error;
  if (error && isNoPermissionError(error)) return <NoPermission />;
  if (error && parseApiError(error).status === 404) {
    return <NotFoundState title={t("notFoundTitle")} description={t("notFoundDescription")} backHref={`/admin/collections/${encodeURIComponent(collectionKey)}`} backLabel={t("backToList")} />;
  }
  if (error && !(collection && entry)) return <ErrorState error={error} onRetry={() => { void collectionQuery.refetch(); void entryQuery.refetch(); }} isRetrying={entryQuery.isFetching} />;
  if (!collection || !entry) {
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
        <Link href={`/admin/collections/${encodeURIComponent(collectionKey)}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
          {t("backToList")}
        </Link>
        <h1 className="mt-1 break-words text-2xl font-semibold tracking-wide">{entry.title ?? t("untitled")}</h1>
        <p className="mt-1 break-all text-sm text-muted-foreground">{collection.name} · <span className="font-mono">#{entry.id}</span></p>
      </div>
      {entry.deleted_at ? (
        <Alert>
          <AlertTitle>{t("trashedTitle")}</AlertTitle>
          <AlertDescription className="leading-snug">{t("trashedBody")}</AlertDescription>
        </Alert>
      ) : null}
      <EntryEditor key={generation} collection={collection} entry={entry} etag={entryQuery.data?.etag} onReseed={onReseed} />
    </div>
  );
}
