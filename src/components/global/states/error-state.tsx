"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { parseApiError } from "@/lib/api-error";

// "Error": a read that failed with a network error / 5xx (already toasted once by QueryProvider). Shows a
// retry button and the server's `request_id` when there is one. NEVER use it for a 403 / auth error: those
// are `NoPermission` / `ForbiddenState` and must not be retried (CLAUDE.md).
export function ErrorState({
  error,
  onRetry,
  isRetrying = false,
  title,
  description,
  className,
}: {
  error?: unknown;
  onRetry?: () => void;
  isRetrying?: boolean;
  title?: string;
  description?: string;
  // Default fills the content area; pass a smaller min-height when it sits inside a sheet, dialog or tab.
  className?: string;
}) {
  const t = useTranslations("states.error");
  const tCommon = useTranslations("common");
  const requestId = error === undefined ? undefined : parseApiError(error).requestId;

  return (
    <div
      role="alert"
      className={cn(
        "flex min-h-[calc(100svh-10rem)] flex-col items-center justify-center gap-3 text-center",
        className,
      )}
    >
      <TriangleAlertIcon className="size-6 text-muted-foreground" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium">{title ?? t("title")}</p>
        <p className="text-sm text-muted-foreground">{description ?? t("description")}</p>
        {requestId ? (
          <p className="font-mono text-xs text-muted-foreground">
            {t("reference", { requestId })}
          </p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? <Spinner /> : null}
          {tCommon("retry")}
        </Button>
      ) : null}
    </div>
  );
}
