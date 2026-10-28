import { redirect } from "next/navigation";

import { SETTINGS_GROUPS } from "@/components/protected/settings/settings-groups";

// /admin/settings goes to the first group (doc/07 section 3.8).
export default function SettingsIndexPage() {
  redirect(`/admin/settings/${SETTINGS_GROUPS[0]}`);
}
