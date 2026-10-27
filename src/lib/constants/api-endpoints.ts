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
  },
} as const;
