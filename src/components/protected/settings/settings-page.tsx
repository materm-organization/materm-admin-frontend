"use client";

import { useTranslations } from "next-intl";

import { LinkTabs } from "@/components/global/link-tabs";
import { SETTINGS_GROUPS } from "@/components/protected/settings/settings-groups";
import { SettingsEditor } from "@/components/protected/settings/settings-editor";
import { useSettingsGroup } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";

// SCR-15: the groups as a capsule tab strip under the title (`LinkTabs`: plain links with `aria-current`, not Radix
// tabs, see the portal's note on `Tabs asChild` + `next/link`) and the editor of the chosen group below it.
export function SettingsPage({ group }: { group: string }) {
  const t = useTranslations("settings");
  // A group that cannot be read at all (no permission / not found / failed with nothing cached): the tab strip
  // STAYS (the user can still go to another group) and the state is centred in the content area, so that column
  // drops its reading width. The TREE stays the same in every state (only classes change):
  // moving the editor to another place in the tree would remount it, and a mounting observer on an errored query
  // refetches (retryOnMount) - an endless refetch loop.
  const query = useSettingsGroup(group);
  const unreadable = !!query.error && !query.data;
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
      <div className={cn("min-w-0", !unreadable && "max-w-3xl")}>
        <h2 className="mb-4 text-lg font-semibold">{t(`groups.${group}`)}</h2>
        <SettingsEditor group={group} />
      </div>
    </div>
  );
}
