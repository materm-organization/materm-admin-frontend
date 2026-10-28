"use client";

import { useTranslations } from "next-intl";

import { LinkTabs } from "@/components/global/link-tabs";
import { SETTINGS_GROUPS } from "@/components/protected/settings/settings-groups";
import { SettingsEditor } from "@/components/protected/settings/settings-editor";

// SCR-15: the groups as a capsule tab strip under the title (`LinkTabs`: plain links with `aria-current`, not Radix
// tabs, see the portal's note on `Tabs asChild` + `next/link`) and the editor of the chosen group below it.
export function SettingsPage({ group }: { group: string }) {
  const t = useTranslations("settings");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-wide">{t("title")}</h1>
        <p className="mt-1 text-base text-muted-foreground">{t("description")}</p>
      </div>
      <LinkTabs
        label={t("groupsLabel")}
        tabs={SETTINGS_GROUPS.map((g) => ({ href: `/admin/settings/${g}`, label: t(`groups.${g}`), active: g === group }))}
      />
      <div className="min-w-0">
        <h2 className="mb-4 text-lg font-semibold">{t(`groups.${group}`)}</h2>
        <SettingsEditor group={group} />
      </div>
    </div>
  );
}
