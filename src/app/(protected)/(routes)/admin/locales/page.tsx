import { getTranslations } from "next-intl/server";

import { LocalesList } from "@/components/protected/locales/locales-list";

// /admin/locales (SCR-12) — the route guard requires `read` on `cms.locales` (lib/nav-main-items.ts).
export default async function LocalesPage() {
  const t = await getTranslations("locales");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-wide">{t("title")}</h1>
        <p className="mt-1 text-base text-muted-foreground">{t("description")}</p>
      </div>
      <LocalesList />
    </div>
  );
}
