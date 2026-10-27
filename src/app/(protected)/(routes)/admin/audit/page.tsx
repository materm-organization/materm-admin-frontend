import { getTranslations } from "next-intl/server";

import { AuditList } from "@/components/protected/audit/audit-list";

// /admin/audit (SCR-11) — the route guard requires `read` on `ops.audit` (lib/nav-main-items.ts).
export default async function AuditPage() {
  const t = await getTranslations("audit");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-wide">{t("title")}</h1>
        <p className="mt-1 text-base text-muted-foreground">{t("description")}</p>
      </div>
      <AuditList />
    </div>
  );
}
