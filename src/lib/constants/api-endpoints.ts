// Every API path the app calls, centralized. Paths are relative to the axios
// instances' baseURL (which already includes `/api/v1`, see `lib/axios.ts`).
// Add a new top-level key per feature as you build it.
export const API_ENDPOINTS = {
  AUTH: {
    // LOGIN and REFRESH both sit outside the `/auth` group (REFRESH is a
    // GET, not a POST, and expects the refresh token as a Bearer header,
    // which lib/axios.ts's interceptor already does). Adjust to match your
    // own backend's route tree.
    LOGIN: "/login",
    ME: "/auth/me",
    REFRESH: "/jwt/refresh",
    CHANGE_PASSWORD: "/auth/users/change-password",
  },
} as const;
