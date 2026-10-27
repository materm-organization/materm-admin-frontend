import { getTranslations } from "next-intl/server";

import { SystemStatusView } from "@/components/protected/system/system-status";

// /admin/system (SCR-45) — the route guard requires `read` on `ops.system` (lib/nav-main-items.ts).
export default async function SystemPage() {
  const t = await getTranslations("system");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-wide">{t("title")}</h1>
        <p className="mt-1 text-base text-muted-foreground">{t("description")}</p>
      </div>
      <SystemStatusView />
    </div>
  );
}
