"use client";

import { useTranslations } from "next-intl";

// The "no permission" state: shown instead of a retry panel or an endless spinner when a read ends in a 403
// (or an auth error that did not end the session). There is nothing to retry: the user simply may not see this.
export function NoPermission() {
  const t = useTranslations("common");

  return (
    <div
      role="alert"
      className="flex min-h-[40vh] flex-col items-center justify-center gap-1 text-center"
    >
      <p className="text-sm font-medium">{t("noPermissionTitle")}</p>
      <p className="text-sm text-muted-foreground">
        {t("noPermissionDescription")}
      </p>
    </div>
  );
}
