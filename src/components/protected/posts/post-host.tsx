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
import { PostEditor } from "@/components/protected/posts/post-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { usePost } from "@/hooks/use-posts";
import { isNoPermissionError, parseApiError } from "@/lib/api-error";

// SCR-25 (T1.5.5): the host loads the post and shows who it is; `PostEditor` is the editor (PublishBar, tabs, forms). A re-seed
// (after a conflict, a discard, a restore) reads the server's version again and REMOUNTS the editor (`generation` is its key),
// so every form starts again from it.
export function PostHost({ id }: { id: number }) {
  const t = useTranslations("posts.host");
  const queryClient = useQueryClient();
  const query = usePost(id);
  const [generation, setGeneration] = useState(0);
  const post = query.data?.data.data;
  const etag = query.data?.etag;
  useBreadcrumbTitle(query.error ? null : post?.title);
  const refetchPost = query.refetch;

  const onReseed = useCallback(
    async (options: { refetchPost?: boolean } = {}) => {
      if (options.refetchPost !== false) await refetchPost();
      void queryClient.invalidateQueries({ queryKey: ["/categories"] });
      setGeneration((g) => g + 1);
    },
    [queryClient, refetchPost]
  );

  if (query.error && isNoPermissionError(query.error)) return <NoPermission />;
  if (query.error && parseApiError(query.error).status === 404) {
    return <NotFoundState title={t("notFoundTitle")} description={t("notFoundDescription")} backHref="/admin/blog/posts" backLabel={t("backToList")} />;
  }
  if (query.error && !post) return <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />;
  if (!post) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const slug = post.slug;
  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/blog/posts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
          {t("backToList")}
        </Link>
        <h1 className="mt-1 break-words text-2xl font-semibold tracking-wide">{post.title ?? t("untitled")}</h1>
        {slug ? <p className="mt-1 break-all font-mono text-sm text-muted-foreground">/blog/{slug}</p> : null}
      </div>

      {post.deleted_at ? (
        <Alert>
          <AlertTitle>{t("trashedTitle")}</AlertTitle>
          <AlertDescription>{t("trashedBody")}</AlertDescription>
        </Alert>
      ) : null}

      <PostEditor key={generation} post={post} etag={etag} onReseed={onReseed} />
    </div>
  );
}
