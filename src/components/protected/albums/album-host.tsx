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
import { AlbumEditor } from "@/components/protected/albums/album-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useAlbum, albumItemsQueryKey } from "@/hooks/use-albums";
import { isNoPermissionError, parseApiError } from "@/lib/api-error";

// SCR-29 (T1.5.6): the host loads the album and shows who it is; `AlbumEditor` is the editor (PublishBar, tabs, forms). A re-seed (after a
// conflict, a discard, a restore) reads the server's version again and REMOUNTS the editor (`generation` is its key).
export function AlbumHost({ id }: { id: number }) {
  const t = useTranslations("albums.host");
  const queryClient = useQueryClient();
  const query = useAlbum(id);
  const [generation, setGeneration] = useState(0);
  const album = query.data?.data.data;
  const etag = query.data?.etag;
  useBreadcrumbTitle(query.error ? null : (album?.title ?? album?.key));
  const refetchAlbum = query.refetch;

  const onReseed = useCallback(
    async (options: { refetchAlbum?: boolean } = {}) => {
      if (options.refetchAlbum !== false) await refetchAlbum();
      // The pictures changed with the album (a discard, a restore, somebody else's edit).
      await queryClient.invalidateQueries({ queryKey: albumItemsQueryKey(id) });
      setGeneration((g) => g + 1);
    },
    [id, queryClient, refetchAlbum]
  );

  if (query.error && isNoPermissionError(query.error)) return <NoPermission />;
  if (query.error && parseApiError(query.error).status === 404) {
    return <NotFoundState title={t("notFoundTitle")} description={t("notFoundDescription")} backHref="/admin/galleries" backLabel={t("backToList")} />;
  }
  if (query.error && !album) return <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />;
  if (!album) {
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
        <Link href="/admin/galleries" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
          {t("backToList")}
        </Link>
        <h1 className="mt-1 break-words text-2xl font-semibold tracking-wide">{album.title ?? t("untitled")}</h1>
        <p className="mt-1 break-all font-mono text-sm text-muted-foreground">{album.key}</p>
      </div>

      {album.deleted_at ? (
        <Alert>
          <AlertTitle>{t("trashedTitle")}</AlertTitle>
          <AlertDescription>{t("trashedBody")}</AlertDescription>
        </Alert>
      ) : null}

      <AlbumEditor key={generation} album={album} etag={etag} onReseed={onReseed} />
    </div>
  );
}
