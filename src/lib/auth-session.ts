// The browser-side session: access + refresh JWTs in cookies (js-cookie), and
// the one-shot "why was I signed out" notice the sign-in page shows. Plain
// module (no React) shared by lib/axios.ts, the auth hooks and the sign-in
// form. Tokens are NEVER logged and never put in Redux/localStorage.
import Cookies from "js-cookie";

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/constants/cookies";

export const SIGN_IN_PATH = "/auth/sign-in";
export const FORGOT_PASSWORD_PATH = "/auth/forgot-password";

// Values of the one-shot sign-in notice (`setSignInNotice`).
export const SIGN_IN_NOTICE = {
  SESSION_ENDED: "session_ended",
  PASSWORD_RESET: "password_reset",
} as const;

// `Secure` only when the page itself is https so the cookie still works on a
// plain-http dev server / LAN IP.
function cookieOptions(): Cookies.CookieAttributes {
  return {
    sameSite: "strict",
    secure: typeof window !== "undefined" && window.location.protocol === "https:",
  };
}

export const getAccessToken = () => Cookies.get(ACCESS_TOKEN_COOKIE);
export const getRefreshToken = () => Cookies.get(REFRESH_TOKEN_COOKIE);

export function setTokens(tokens: { access: string; refresh?: string }) {
  Cookies.set(ACCESS_TOKEN_COOKIE, tokens.access, cookieOptions());
  if (tokens.refresh) Cookies.set(REFRESH_TOKEN_COOKIE, tokens.refresh, cookieOptions());
}

export function clearSession() {
  Cookies.remove(ACCESS_TOKEN_COOKIE);
  Cookies.remove(REFRESH_TOKEN_COOKIE);
}

// One-shot notice for the sign-in page. sessionStorage (not a query param) so
// the sign-in page stays statically renderable; wrapped in try/catch because
// storage can throw (private mode) — the notice is only a nicety.
const NOTICE_KEY = "auth_signin_notice";

export function setSignInNotice(notice: string) {
  try {
    window.sessionStorage.setItem(NOTICE_KEY, notice);
  } catch {
    /* ignore */
  }
}

export function takeSignInNotice(): string | null {
  try {
    const value = window.sessionStorage.getItem(NOTICE_KEY);
    if (value) window.sessionStorage.removeItem(NOTICE_KEY);
    return value;
  } catch {
    return null;
  }
}
