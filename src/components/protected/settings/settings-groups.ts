// The groups SCR-15 edits, in the order of the vertical tabs (doc/07 section 3.8). `seo` has its own screen
// (`cms.seo`), `analytics` is P2 (404 in P1), there is no `social` group (C-03).
export const SETTINGS_GROUPS = ["brand", "contact", "footer", "site"] as const;
export type SettingsGroupName = (typeof SETTINGS_GROUPS)[number];
