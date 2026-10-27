// Every API path the app calls, centralized. Paths are relative to the axios
// instances' baseURL (which already includes `/api/v1`, see `lib/axios.ts`).
// Contract: doc/05-api-spec.md. Add a new top-level key per feature.
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
  },
  ROLES: {
    LIST: "/roles",
  },
} as const;
