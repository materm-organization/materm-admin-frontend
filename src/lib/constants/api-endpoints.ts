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
  },
  POSTS: {
    LIST: "/posts",
    DETAIL: (id: number | string) => `/posts/${id}`,
  },
  ALBUMS: {
    LIST: "/albums",
    DETAIL: (id: number | string) => `/albums/${id}`,
    ITEMS: (id: number | string) => `/albums/${id}/items`,
  },
  CATEGORIES: {
    LIST: "/categories",
    DETAIL: (id: number | string) => `/categories/${id}`,
  },
  FAQ_GROUPS: {
    LIST: "/faq-groups",
  },
  FORMS: {
    LIST: "/forms",
    DETAIL: (id: number | string) => `/forms/${id}`,
  },
} as const;
