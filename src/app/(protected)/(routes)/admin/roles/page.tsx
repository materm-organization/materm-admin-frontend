import { getTranslations } from "next-intl/server";

import { RolesList } from "@/components/protected/roles/roles-list";

// /admin/roles (SCR-09) — the route guard requires `read` on `iam.roles` (lib/nav-main-items.ts).
export default async function RolesPage() {
  const t = await getTranslations("roles");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-wide">{t("title")}</h1>
        <p className="mt-1 text-base text-muted-foreground">{t("description")}</p>
      </div>
      <RolesList />
    </div>
  );
}
