// Permission catalog — mirrors the backend seed `doc/sql/seeds/002_iam_catalog.sql`
// (22 permission keys, 15 distinct actions). Used for the dev-bypass user
// (NEXT_PUBLIC_DISABLE_AUTH_GUARD) so permission-gated UI is not empty without
// a backend, and as the single place that names keys/actions. The server is
// the real authority: it re-checks every request from the role's live grants.
export const PERMISSION_KEYS = {
  CMS_PAGES: "cms.pages",
  CMS_SECTIONS: "cms.sections",
  CMS_MENUS: "cms.menus",
  CMS_BLOG: "cms.blog",
  CMS_CATEGORIES: "cms.categories",
  CMS_GALLERIES: "cms.galleries",
  CMS_FAQ: "cms.faq",
  CMS_COLLECTIONS: "cms.collections",
  MEDIA_LIBRARY: "media.library",
  FORMS_MANAGE: "forms.manage",
  FORMS_SUBMISSIONS: "forms.submissions",
  CMS_LOCALES: "cms.locales",
  CMS_UI_STRINGS: "cms.ui_strings",
  CMS_SEO: "cms.seo",
  CMS_REDIRECTS: "cms.redirects",
  CMS_SETTINGS: "cms.settings",
  IAM_USERS: "iam.users",
  IAM_ROLES: "iam.roles",
  OPS_AUDIT: "ops.audit",
  OPS_WEBHOOKS: "ops.webhooks",
  OPS_API_KEYS: "ops.api_keys",
  OPS_SYSTEM: "ops.system",
} as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[keyof typeof PERMISSION_KEYS];

export const PERMISSION_ACTIONS = {
  READ: "read",
  CREATE: "create",
  UPDATE: "update",
  UPDATE_OWN: "update_own",
  DELETE: "delete",
  DELETE_OWN: "delete_own",
  PUBLISH: "publish",
  UNPUBLISH: "unpublish",
  SCHEDULE: "schedule",
  REVIEW: "review",
  TRANSLATE: "translate",
  EXPORT: "export",
  IMPORT: "import",
  MANAGE_SCHEMA: "manage_schema",
  EXECUTE: "execute",
} as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[keyof typeof PERMISSION_ACTIONS];

type CatalogEntry = {
  permission_key: PermissionKey;
  name: string;
  description: string;
  category: string;
  available_actions: readonly string[];
};

// Ordered by the seed's `sort_order` (10..220).
export const PERMISSION_CATALOG: readonly CatalogEntry[] = [
  { permission_key: "cms.pages", name: "Pages", description: "Pages: route, template, home flag, SEO, lifecycle", category: "content", available_actions: ["read", "create", "update", "delete", "publish", "unpublish", "schedule", "review", "translate"] },
  { permission_key: "cms.sections", name: "Sections", description: "Page sections, shared sections, section types on/off", category: "content", available_actions: ["read", "create", "update", "delete", "publish", "unpublish", "translate", "manage_schema"] },
  { permission_key: "cms.menus", name: "Menus", description: "main / footer / social menus and items", category: "content", available_actions: ["read", "create", "update", "delete", "translate"] },
  { permission_key: "cms.blog", name: "Blog posts", description: "Posts, gallery, scheduling", category: "content", available_actions: ["read", "create", "update", "update_own", "delete", "delete_own", "publish", "unpublish", "schedule", "review", "translate", "export"] },
  { permission_key: "cms.categories", name: "Categories & tags", description: "Blog categories and tags", category: "content", available_actions: ["read", "create", "update", "delete", "translate"] },
  { permission_key: "cms.galleries", name: "Galleries", description: "Albums, items, captions", category: "content", available_actions: ["read", "create", "update", "delete", "publish", "unpublish", "schedule", "translate"] },
  { permission_key: "cms.faq", name: "FAQ", description: "FAQ groups and items", category: "content", available_actions: ["read", "create", "update", "delete", "publish", "unpublish", "translate"] },
  { permission_key: "cms.collections", name: "Collections", description: "Admin-defined content types and their entries", category: "content", available_actions: ["read", "create", "update", "delete", "publish", "unpublish", "schedule", "translate", "export", "import", "manage_schema"] },
  { permission_key: "media.library", name: "Media library", description: "Upload, folders, alt text, focal point, delete", category: "media", available_actions: ["read", "create", "update", "update_own", "delete", "delete_own", "translate"] },
  { permission_key: "forms.manage", name: "Forms", description: "Form definitions, validation, recipients, messages", category: "forms", available_actions: ["read", "create", "update", "delete", "publish", "unpublish", "translate", "manage_schema"] },
  { permission_key: "forms.submissions", name: "Form submissions", description: "Inbox (personal data)", category: "forms", available_actions: ["read", "update", "delete", "export"] },
  { permission_key: "cms.locales", name: "Languages", description: "Locales, default, fallback, date formats, translation status", category: "localization", available_actions: ["read", "create", "update", "delete", "export", "import"] },
  { permission_key: "cms.ui_strings", name: "UI strings", description: "UI string overrides per key/locale", category: "localization", available_actions: ["read", "update", "translate", "export", "import"] },
  { permission_key: "cms.seo", name: "SEO", description: "Site-wide SEO, robots, sitemap, SEO fields of pages/posts", category: "seo", available_actions: ["read", "update", "translate"] },
  { permission_key: "cms.redirects", name: "Redirects", description: "301/302 redirects", category: "seo", available_actions: ["read", "create", "update", "delete", "export", "import"] },
  { permission_key: "cms.settings", name: "Site settings", description: "Brand, contact info, analytics ids", category: "settings", available_actions: ["read", "update", "translate"] },
  { permission_key: "iam.users", name: "Users", description: "Invite/edit/disable users, assign role, revoke sessions", category: "iam", available_actions: ["read", "create", "update", "delete"] },
  { permission_key: "iam.roles", name: "Roles & permissions", description: "Roles and the grant matrix", category: "iam", available_actions: ["read", "create", "update", "delete"] },
  { permission_key: "ops.audit", name: "Audit log", description: "View / export the audit trail", category: "ops", available_actions: ["read", "export"] },
  { permission_key: "ops.webhooks", name: "Webhooks", description: "Outbound webhooks and deliveries", category: "ops", available_actions: ["read", "create", "update", "delete", "execute"] },
  { permission_key: "ops.api_keys", name: "API keys", description: "Machine-to-machine keys", category: "ops", available_actions: ["read", "create", "delete"] },
  { permission_key: "ops.system", name: "System", description: "Health, jobs, backups, cache, runtime config", category: "ops", available_actions: ["read", "update", "execute"] },
];
