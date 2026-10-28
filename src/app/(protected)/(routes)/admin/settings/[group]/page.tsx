import { notFound } from "next/navigation";

import { SETTINGS_GROUPS } from "@/components/protected/settings/settings-groups";
import { SettingsPage } from "@/components/protected/settings/settings-page";

// /admin/settings/[group] (SCR-15): brand, contact, footer, site. `seo` is SCR-16 (/admin/seo, another key); `analytics`
// is P2 and `social` does not exist (the social links are the `social` menu). `params` is a Promise in Next 16.
export default async function SettingsGroupPage({ params }: { params: Promise<{ group: string }> }) {
  const { group } = await params;
  if (!(SETTINGS_GROUPS as readonly string[]).includes(group)) notFound();
  return <SettingsPage group={group} />;
}
