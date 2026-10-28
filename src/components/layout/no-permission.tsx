"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

// The "no permission" state: shown instead of a retry panel or an endless spinner when a read ends in a 403
// (or an auth error that did not end the session). There is nothing to retry: the user simply may not see this.
export function NoPermission({ className }: { className?: string }) {
  const t = useTranslations("common");

  return (
    <div
      role="alert"
      className={cn(
        "flex min-h-[calc(100svh-10rem)] flex-col items-center justify-center gap-1 text-center",
        className,
      )}
    >
      <p className="text-sm font-medium">{t("noPermissionTitle")}</p>
      <p className="text-sm text-muted-foreground">
        {t("noPermissionDescription")}
      </p>
    </div>
  );
}
