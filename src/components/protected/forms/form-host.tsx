"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { ErrorState } from "@/components/global/states/error-state";
import { NotFoundState } from "@/components/global/states/not-found-state";
import { useBreadcrumbTitle } from "@/components/layout/breadcrumb-context";
import { NoPermission } from "@/components/layout/no-permission";
import { FormEditor } from "@/components/protected/forms/form-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormDetail } from "@/hooks/use-forms";
import { isNoPermissionError, parseApiError } from "@/lib/api-error";

// SCR-31 (T1.5.7): the host loads the form and shows who it is; `FormEditor` is the editor. A re-seed (after a conflict, a discard, a
// restore) reads the server's version again and REMOUNTS the editor (`generation` is its key), so every form starts again from it.
export function FormHost({ id }: { id: number }) {
  const t = useTranslations("forms.host");
  const query = useFormDetail(id);
  const [generation, setGeneration] = useState(0);
  const form = query.data?.data.data;
  const etag = query.data?.etag;
  useBreadcrumbTitle(query.error ? null : form?.name);
  const refetchForm = query.refetch;

  const onReseed = useCallback(
    async (options: { refetchForm?: boolean } = {}) => {
      if (options.refetchForm !== false) await refetchForm();
      setGeneration((g) => g + 1);
    },
    [refetchForm]
  );

  if (query.error && isNoPermissionError(query.error)) return <NoPermission />;
  if (query.error && parseApiError(query.error).status === 404) {
    return <NotFoundState title={t("notFoundTitle")} description={t("notFoundDescription")} backHref="/admin/forms" backLabel={t("backToList")} />;
  }
  if (query.error && !form) return <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />;
  if (!form) {
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
        <Link href="/admin/forms" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
          {t("backToList")}
        </Link>
        <h1 className="mt-1 break-words text-2xl font-semibold tracking-wide">{form.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-mono">{form.slug}</span>
          {form.is_system ? <span> - {t("system")}</span> : null}
          {form.submissions_new !== undefined ? (
            <>
              {" - "}
              <Link href={`/admin/forms/submissions?form_id=${form.id}`} className="underline-offset-4 hover:underline">
                {t("messages", { count: form.submissions_new })}
              </Link>
            </>
          ) : null}
        </p>
      </div>

      <FormEditor key={generation} form={form} etag={etag} onReseed={onReseed} />
    </div>
  );
}
