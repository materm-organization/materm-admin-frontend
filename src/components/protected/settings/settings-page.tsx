"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { SETTINGS_GROUPS } from "@/components/protected/settings/settings-groups";
import { SettingsEditor } from "@/components/protected/settings/settings-editor";
import { useSettingsGroup } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";

// SCR-15: vertical group navigation (plain links with `aria-current`, not Radix tabs: see the portal's note on
// `Tabs asChild` + `next/link`) and the editor of the chosen group.
export function SettingsPage({ group }: { group: string }) {
  const t = useTranslations("settings");
  // A group that cannot be read at all (no permission / not found / failed with nothing cached): the group
  // navigation STAYS (the user can still go to another group) and the state is centred in the free area to its
  // right, so that column drops its reading width. The TREE stays the same in every state (only classes change):
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
      <div className="flex flex-col gap-6 md:flex-row">
        <nav aria-label={t("groupsLabel")} className="flex shrink-0 gap-1 overflow-x-auto md:w-48 md:flex-col">
          {SETTINGS_GROUPS.map((g) => (
            <Link
              key={g}
              href={`/admin/settings/${g}`}
              aria-current={g === group ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2 text-sm whitespace-nowrap hover:bg-accent",
                g === group && "bg-accent font-medium"
              )}
            >
              {t(`groups.${g}`)}
            </Link>
          ))}
        </nav>
        <div className={cn("min-w-0 flex-1", !unreadable && "max-w-3xl")}>
          <h2 className="mb-4 text-lg font-semibold">{t(`groups.${group}`)}</h2>
          <SettingsEditor group={group} />
        </div>
      </div>
    </div>
  );
}
