// All axios instance creation + interceptor logic lives here, nowhere else
// This app talks to exactly one backend, so there are exactly two
// instances: an authenticated one and a public one used for login + the
// token refresh. Add another pair of instances here (with their own
// interceptors) if the app needs to talk to more than one backend.
import axios from "axios";
import Cookies from "js-cookie";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/constants/cookies";

function getApiBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (env) return env;
  if (typeof window !== "undefined") return `${window.location.origin}/api/v1`;
  return "/api/v1";
}

export const axiosInstance = axios.create({ timeout: 30000 });
export const axiosPublicInstance = axios.create({ timeout: 30000 });

// Resolve baseURL per-request (not once at module-init) so the browser
// same-origin fallback in getApiBaseUrl() is evaluated against `window`
// rather than baked in at import time.
axiosInstance.interceptors.request.use((config) => {
  config.baseURL = getApiBaseUrl();
  return config;
});
axiosPublicInstance.interceptors.request.use((config) => {
  config.baseURL = getApiBaseUrl();
  return config;
});

// Attach `Authorization: Bearer <token>` from the access-token cookie on
// every authenticated request. If a project's backend needs an extra
// header (e.g. an API key for a second, differently-authed service), give
// that service its own instance + interceptor rather than branching this
// one (see §5).
axiosInstance.interceptors.request.use((config) => {
  const token = Cookies.get(ACCESS_TOKEN_COOKIE);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

function clearAuthCookiesAndRedirect() {
  Cookies.remove(ACCESS_TOKEN_COOKIE);
  Cookies.remove(REFRESH_TOKEN_COOKIE);
  if (typeof window !== "undefined" && window.location.pathname !== "/auth/sign-in") {
    // Intentionally a hard, full-page navigation (not `useRouter().push()`)
    // — this module isn't a component/hook, and a 401 should also blow away
    // any in-memory client state, not just soft-navigate over it.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/auth/sign-in";
  }
}

// On a 401, attempt exactly one silent refresh via the public instance
// (no auth interceptor), retry the original request once, and if that also
// fails, clear cookies and hard-redirect to sign-in. `_retry` guards against
// an infinite retry loop.
axiosInstance.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as
      | (typeof error.config & { _retry?: boolean })
      | undefined;

    if (error.response?.status !== 401 || !originalRequest || originalRequest._retry) {
      if (error.response?.status === 401) {
        clearAuthCookiesAndRedirect();
      }
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      const refreshToken = Cookies.get(REFRESH_TOKEN_COOKIE);
      // GET /jwt/refresh — the refresh token travels in the `Authorization`
      // header, like the access token does, not in a request body (adjust if the
      // backend's refresh contract differs).
      const { data } = await axiosPublicInstance.get(
        API_ENDPOINTS.AUTH.REFRESH,
        { headers: { Authorization: `Bearer ${refreshToken}` } }
      );
      const newAccessToken = data?.data?.access;
      const newRefreshToken = data?.data?.refresh;
      if (!newAccessToken) throw new Error("No access token in refresh response");
      if (newRefreshToken) Cookies.set(REFRESH_TOKEN_COOKIE, newRefreshToken);

      Cookies.set(ACCESS_TOKEN_COOKIE, newAccessToken);
      originalRequest.headers = originalRequest.headers ?? {};
      originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
      return axiosInstance(originalRequest);
    } catch (refreshError) {
      clearAuthCookiesAndRedirect();
      return Promise.reject(refreshError);
    }
  }
);
