// All axios instance creation + interceptor logic lives here, nowhere else.
// This app talks to exactly one backend, so there are exactly two instances:
// an authenticated one and a public one used for login + the token refresh.
//
// Session contract (doc/05 sections 1.4, 1.10, 2.2):
//  - 401 with UNAUTHENTICATED / TOKEN_EXPIRED / AUTHZ_CHANGED -> ONE shared
//    ("single-flight") GET /jwt/refresh for all concurrent 401s, store the
//    rotated token pair, retry each original request once.
//  - 401 SESSION_REVOKED / REFRESH_REUSED / REFRESH_REPLAY_UNAVAILABLE, or a
//    401 from the refresh call itself -> clear the session, go to sign-in.
//  - 403 and 429 NEVER sign the user out or redirect; the error is rejected
//    and shown as a toast by QueryProvider (403 PASSWORD_CHANGE_REQUIRED
//    additionally notifies the app via setAuthEventHandler, which re-reads
//    /auth/me so the forced change-password dialog opens).
import axios, { type InternalAxiosRequestConfig } from "axios";
import Cookies from "js-cookie";

import { API_ERROR_CODES, SESSION_ENDING_CODES, parseApiError } from "@/lib/api-error";
import {
  SIGN_IN_PATH,
  clearSession,
  getAccessToken,
  getRefreshToken,
  setSignInNotice,
  setTokens,
} from "@/lib/auth-session";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isSupportedLocale } from "@/lib/constants/locales";

declare module "axios" {
  interface AxiosRequestConfig {
    // The caller (e.g. logout) clears the session itself: do not redirect to
    // sign-in or leave a "session ended" notice when this request ends it.
    skipSessionRedirect?: boolean;
  }
}

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

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

// `Accept-Language: <UI locale>` (doc/07 section 6.1, F-3, C-19): the server's fallback `message` then matches
// the UI language. The UI still translates from the machine `code` first. The locale is the `locale` cookie
// (`la` default); read at call time, so a language switch applies to the very next request.
function applyAcceptLanguage(config: InternalAxiosRequestConfig) {
  const cookie = typeof document === "undefined" ? undefined : Cookies.get(LOCALE_COOKIE_NAME);
  config.headers["Accept-Language"] = isSupportedLocale(cookie) ? cookie : DEFAULT_LOCALE;
  return config;
}
axiosInstance.interceptors.request.use(applyAcceptLanguage);
axiosPublicInstance.interceptors.request.use(applyAcceptLanguage);

// Attach `Authorization: Bearer <access>` from the cookie on every
// authenticated request. Read at call time, so a retry (or another tab's
// refresh) always carries the newest token.
axiosInstance.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ---- app notifications (axios cannot reach React Query) -------------------

export type AuthEvent = "authz-changed" | "password-change-required";

let authEventHandler: ((event: AuthEvent) => void) | null = null;

// QueryProvider registers a handler that re-reads /auth/me. Returns an
// unsubscribe function.
export function setAuthEventHandler(handler: (event: AuthEvent) => void) {
  authEventHandler = handler;
  return () => {
    if (authEventHandler === handler) authEventHandler = null;
  };
}

// ---- session end -----------------------------------------------------------

let sessionEnding = false;

// Dev-only bypass (NEXT_PUBLIC_DISABLE_AUTH_GUARD, see hooks/use-auth.ts): the
// app runs without a login, so API calls without a session must not bounce
// the developer to sign-in. Never set in .env.production.
const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DISABLE_AUTH_GUARD === "true";

// Clear the session and hard-navigate to sign-in. Intentionally a full-page
// navigation (not `useRouter().push()`): this module isn't a component, and a
// dead session should also blow away any in-memory client state.
function endSession() {
  clearSession();
  if (DEV_BYPASS_AUTH || typeof window === "undefined" || sessionEnding) return;
  if (window.location.pathname === SIGN_IN_PATH) return;
  sessionEnding = true;
  setSignInNotice("session_ended");
  window.location.href = SIGN_IN_PATH;
}

// Thrown by the refresh step when the session is definitely over (as opposed
// to a transient failure such as a network error or 429, which must keep the
// session so the user can retry).
class SessionEndedError extends Error {
  constructor() {
    super("Session ended");
    this.name = "SessionEndedError";
  }
}

// ---- single-flight refresh -------------------------------------------------

let refreshInFlight: Promise<string> | null = null;

async function performRefresh(staleAccessToken: string): Promise<string> {
  // Another tab (or an earlier refresh in this tab) may have rotated the pair
  // while we waited for the lock.
  const alreadyFresh = getAccessToken();
  if (alreadyFresh && alreadyFresh !== staleAccessToken) return alreadyFresh;

  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new SessionEndedError();

  try {
    // GET /jwt/refresh: the REFRESH token travels as the Bearer header.
    // Rotation: the response carries a NEW refresh token that replaces ours.
    const { data } = await axiosPublicInstance.get(API_ENDPOINTS.AUTH.REFRESH, {
      headers: { Authorization: `Bearer ${refreshToken}` },
    });
    const access: unknown = data?.data?.access;
    const refresh: unknown = data?.data?.refresh;
    if (typeof access !== "string" || typeof refresh !== "string" || !access || !refresh) {
      throw new SessionEndedError();
    }
    setTokens({ access, refresh });
    return access;
  } catch (error) {
    // Only a 401 from the refresh endpoint ends the session. 403/429/5xx/
    // network errors reject as-is (no sign-out): the user sees a toast and
    // the next request can try again.
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      throw new SessionEndedError();
    }
    throw error;
  }
}

function refreshAccessToken(staleAccessToken: string): Promise<string> {
  // A request that failed with an old token AFTER the refresh already
  // finished must not trigger a second refresh.
  const current = getAccessToken();
  if (current && current !== staleAccessToken) return Promise.resolve(current);

  if (!refreshInFlight) {
    // `navigator.locks` (secure contexts only) serialises refreshes across
    // tabs that share the cookie; the stale-token check inside performRefresh
    // lets the loser reuse the winner's token instead of rotating again.
    const run = async (): Promise<string> =>
      typeof navigator !== "undefined" && navigator.locks
        ? await navigator.locks.request("materm-admin-auth-refresh", () =>
            performRefresh(staleAccessToken)
          )
        : await performRefresh(staleAccessToken);
    refreshInFlight = run().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

// ---- response interceptor --------------------------------------------------

axiosInstance.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error) || !error.response) return Promise.reject(error);

    const status = error.response.status;
    const { code } = parseApiError(error);
    const original = error.config as RetriableConfig | undefined;

    if (status === 403) {
      // Never redirect on 403. PASSWORD_CHANGE_REQUIRED additionally asks the
      // app to re-read /auth/me (the source of truth for the forced dialog).
      if (code === API_ERROR_CODES.PASSWORD_CHANGE_REQUIRED) {
        authEventHandler?.("password-change-required");
      }
      return Promise.reject(error);
    }

    if (status !== 401 || !original) return Promise.reject(error);

    const signOut = () => {
      if (!original.skipSessionRedirect) endSession();
    };

    // Session is gone for good — refreshing can't help.
    if (code && SESSION_ENDING_CODES.has(code)) {
      signOut();
      return Promise.reject(error);
    }
    // Already retried once with a fresh token and still 401.
    if (original._retry) {
      signOut();
      return Promise.reject(error);
    }
    original._retry = true;

    const sentAuthorization = original.headers?.Authorization;
    const staleAccessToken =
      typeof sentAuthorization === "string" ? sentAuthorization.replace(/^Bearer\s+/i, "") : "";

    try {
      await refreshAccessToken(staleAccessToken);
    } catch (refreshError) {
      if (refreshError instanceof SessionEndedError) {
        signOut();
        return Promise.reject(error);
      }
      return Promise.reject(refreshError);
    }

    if (code === API_ERROR_CODES.AUTHZ_CHANGED) authEventHandler?.("authz-changed");
    // The request interceptor re-attaches the (new) access token from the cookie.
    return axiosInstance(original);
  }
);
