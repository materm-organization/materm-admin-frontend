import { getTranslations } from "next-intl/server";

import { UsersList } from "@/components/protected/users/users-list";

// /admin/users — the route guard (RoutePermissionGuard) requires `read` on
// `iam.users`, from the same config as the sidebar (lib/nav-main-items.ts).
export default async function UsersPage() {
  const t = await getTranslations("users");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-wide">{t("title")}</h1>
        <p className="mt-1 text-base text-muted-foreground">{t("description")}</p>
      </div>
      <UsersList />
    </div>
  );
}
