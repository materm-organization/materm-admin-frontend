import { getTranslations } from "next-intl/server";

// Placeholder landing page for the protected area — replace with real content.
export default async function AdminDashboardPage() {
  const t = await getTranslations("dashboard");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-wide">{t("title")}</h1>
        <p className="mt-1 text-base text-muted-foreground">{t("description")}</p>
      </div>
    </div>
  );
}
