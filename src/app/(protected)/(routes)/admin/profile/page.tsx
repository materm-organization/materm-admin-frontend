import { getTranslations } from "next-intl/server";

import { ProfileView } from "@/components/protected/profile/profile-view";

// /admin/profile (SCR-06) — open to every signed-in user (`ROUTE_ONLY_PERMISSIONS`); no `iam.users` grant needed.
export default async function ProfilePage() {
  const t = await getTranslations("profile");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-wide">{t("title")}</h1>
        <p className="mt-1 text-base text-muted-foreground">{t("description")}</p>
      </div>
      <ProfileView />
    </div>
  );
}
