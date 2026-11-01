// Every API path the app calls, centralized. Paths are relative to the axios
// instances' baseURL (which already includes `/api/v1`, see `lib/axios.ts`).
// Contract: doc/05-api-spec.md. Add a new top-level key per feature; a path with a
// parameter is a function (`USERS.DETAIL(id)`).
export const API_ENDPOINTS = {
  AUTH: {
    // LOGIN and REFRESH sit outside the `/auth` group. REFRESH is a GET and
    // expects the REFRESH token as the Bearer (lib/axios.ts does this).
    LOGIN: "/login",
    REFRESH: "/jwt/refresh",
    LOGOUT: "/auth/logout",
    ME: "/auth/me",
    CHANGE_PASSWORD: "/auth/users/change-password",
    // P1 (doc/05 sections 2.6 - 2.10). The first four are public (no session); the tokens travel in the BODY.
    FORGOT_PASSWORD: "/auth/forgot-password",
    RESET_PASSWORD: "/auth/reset-password",
    INVITATION_VERIFY: "/auth/invitations/verify",
    INVITATION_ACCEPT: "/auth/invitations/accept",
    PROFILE: "/auth/profile",
  },
  USERS: {
    LIST: "/users",
    CREATE: "/users",
    DETAIL: (id: number | string) => `/users/${id}`,
    ACTIVATE: (id: number | string) => `/users/${id}/activate`,
    DEACTIVATE: (id: number | string) => `/users/${id}/deactivate`,
    UNLOCK: (id: number | string) => `/users/${id}/unlock`,
    // P1 commands (doc/05 sections 3.1.9 - 3.1.12).
    RESET_PASSWORD: (id: number | string) => `/users/${id}/reset-password`,
    FORCE_PASSWORD_CHANGE: (id: number | string) => `/users/${id}/force-password-change`,
    REVOKE_SESSIONS: (id: number | string) => `/users/${id}/revoke-sessions`,
    RESEND_INVITATION: (id: number | string) => `/users/${id}/invitation/resend`,
  },
  ROLES: {
    LIST: "/roles",
    CREATE: "/roles",
    DETAIL: (id: number | string) => `/roles/${id}`,
    PERMISSIONS: (id: number | string) => `/roles/${id}/permissions`,
  },
  PERMISSIONS: {
    LIST: "/permissions",
  },
  AUDIT: {
    LIST: "/audit-logs",
    DETAIL: (id: number | string) => `/audit-logs/${id}`,
  },
  LOCALES: {
    LIST: "/locales",
    DETAIL: (code: string) => `/locales/${encodeURIComponent(code)}`,
  },
  SYSTEM: {
    STATUS: "/system/status",
    // POST (doc/05 section 11.8): `ops.system:execute`.
    CACHE_PURGE: "/system/cache/purge",
  },
  // CMS (doc/05 sections 6.2 - 6.12, 10.6). Only what the schema form engine reads (pickers + the registry)
  // is here; the editors of each feature add their own keys.
  SECTION_TYPES: {
    LIST: "/section-types",
    DETAIL: (key: string) => `/section-types/${encodeURIComponent(key)}`,
  },
  // Media library (doc/05 section 11.6): no upload in P1 (P2).
  MEDIA: {
    ASSETS: "/media/assets",
    ASSET: (id: number | string) => `/media/assets/${id}`,
    ASSET_RESTORE: (id: number | string) => `/media/assets/${id}/restore`,
    ASSET_USAGES: (id: number | string) => `/media/assets/${id}/usages`,
    FOLDERS: "/media/folders",
    FOLDER: (id: number | string) => `/media/folders/${id}`,
    // P2 (FR-MEDIA-01 / 08). Note the paths: NOT under `/media/assets` (as agreed with the backend task).
    UPLOADS: "/media/uploads",
    ASSET_FILE: (id: number | string) => `/media/${id}/file`,
  },
  // Revisions of the save-live entities (doc/05 section 11.7). `base` = `/menus/main`, `/settings/brand`,
  // `/ui-strings/<key>`, `/categories/3`, `/tags/5`, `/media/assets/7` (see `lib/revision-resources.ts`).
  REVISIONS: {
    LIST: (base: string) => `${base}/revisions`,
    DETAIL: (base: string, revId: number | string) => `${base}/revisions/${revId}`,
    RESTORE: (base: string, revId: number | string) => `${base}/revisions/${revId}/restore`,
  },
  PAGES: {
    LIST: "/pages",
    DETAIL: (id: number | string) => `/pages/${id}`,
    RESTORE: (id: number | string) => `/pages/${id}/restore`,
    SET_HOME: (id: number | string) => `/pages/${id}/set-home`,
    REFERENCES: (id: number | string) => `/pages/${id}/references`,
    SECTIONS: (id: number | string) => `/pages/${id}/sections`,
    // `PUT` (05 12.5.7): the whole order in one request. Not a section id.
    SECTIONS_ORDER: (id: number | string) => `/pages/${id}/sections/order`,
    SECTION: (id: number | string, sectionId: number | string) => `/pages/${id}/sections/${sectionId}`,
  },
  // Templates of the pages (doc/05 section 12.4): a registry in the backend's code, 4 rows, not paginated.
  PAGE_TEMPLATES: {
    LIST: "/page-templates",
  },
  // Publish engine (doc/05 section 12.7), the same three commands for every publishable entity. `base` = the
  // entity's URL (`/pages/12`, later `/posts/3`): see `lib/publishable-resources.ts`.
  PUBLISHING: {
    PUBLISH: (base: string) => `${base}/publish`,
    UNPUBLISH: (base: string) => `${base}/unpublish`,
    DISCARD_DRAFT: (base: string) => `${base}/discard-draft`,
  },
  // Preview links (doc/05 section 12.9): `base` = the entity's URL like PUBLISHING (`/pages/12`); a revoke names only the link.
  PREVIEW_LINKS: {
    COLLECTION: (base: string) => `${base}/preview-links`,
    DETAIL: (id: number | string) => `/preview-links/${id}`,
  },
  // Posts (doc/05 section 13.3). `SLUG_CHECK` is a fixed segment next to `/posts/{id}`.
  POSTS: {
    LIST: "/posts",
    DETAIL: (id: number | string) => `/posts/${id}`,
    RESTORE: (id: number | string) => `/posts/${id}/restore`,
    MEDIA: (id: number | string) => `/posts/${id}/media`,
    SLUG_CHECK: "/posts/slug-check",
  },
  ALBUMS: {
    LIST: "/albums",
    DETAIL: (id: number | string) => `/albums/${id}`,
    ITEMS: (id: number | string) => `/albums/${id}/items`,
    // T1.5.6 (doc/05 section 13.4): `ITEMS_ORDER` is a fixed segment next to `.../items/{itemId}`.
    RESTORE: (id: number | string) => `/albums/${id}/restore`,
    ITEM: (id: number | string, itemId: number | string) => `/albums/${id}/items/${itemId}`,
    ITEMS_ORDER: (id: number | string) => `/albums/${id}/items/order`,
  },
  // Save-live (doc/05 sections 11.2 - 11.5). Revisions of these are in `REVISIONS` above.
  MENUS: {
    LIST: "/menus",
    DETAIL: (key: string) => `/menus/${encodeURIComponent(key)}`,
    ITEMS: (key: string) => `/menus/${encodeURIComponent(key)}/items`,
    ITEM: (key: string, id: number | string) => `/menus/${encodeURIComponent(key)}/items/${id}`,
    ITEMS_ORDER: (key: string) => `/menus/${encodeURIComponent(key)}/items/order`,
  },
  SETTINGS: {
    LIST: "/settings",
    GROUP: (group: string) => `/settings/${encodeURIComponent(group)}`,
  },
  UI_STRINGS: {
    LIST: "/ui-strings",
    // PUT / DELETE: one language of one key.
    CELL: (key: string, locale: string) => `/ui-strings/${encodeURIComponent(key)}/${encodeURIComponent(locale)}`,
    BUNDLE_SYNC: "/ui-strings/bundle-sync",
  },
  CATEGORIES: {
    LIST: "/categories",
    DETAIL: (id: number | string) => `/categories/${id}`,
    RESTORE: (id: number | string) => `/categories/${id}/restore`,
  },
  TAGS: {
    LIST: "/tags",
    DETAIL: (id: number | string) => `/tags/${id}`,
    RESTORE: (id: number | string) => `/tags/${id}/restore`,
  },
  FAQ_GROUPS: {
    LIST: "/faq-groups",
    // T1.5.6 (doc/05 section 13.5).
    DETAIL: (id: number | string) => `/faq-groups/${id}`,
    RESTORE: (id: number | string) => `/faq-groups/${id}/restore`,
    ITEMS: (id: number | string) => `/faq-groups/${id}/items`,
    ITEM: (id: number | string, itemId: number | string) => `/faq-groups/${id}/items/${itemId}`,
    ITEMS_ORDER: (id: number | string) => `/faq-groups/${id}/items/order`,
  },
  FORMS: {
    LIST: "/forms",
    DETAIL: (id: number | string) => `/forms/${id}`,
    // PUT (05 13.6.4): the whole recipient set; `If-Match` = `recipients_etag`.
    RECIPIENTS: (id: number | string) => `/forms/${id}/recipients`,
  },
  // Submissions inbox (05 13.7). `SUMMARY`, `EXPORT` and `BULK_STATUS` are fixed segments next to `/submissions/{id}`.
  SUBMISSIONS: {
    LIST: "/submissions",
    SUMMARY: "/submissions/summary",
    EXPORT: "/submissions/export",
    BULK_STATUS: "/submissions/bulk-status",
    DETAIL: (id: number | string) => `/submissions/${id}`,
    NOTES: (id: number | string) => `/submissions/${id}/notes`,
  },
  // Dashboard (05 13.8).
  DASHBOARD: {
    SUMMARY: "/dashboard/summary",
  },
} as const;
