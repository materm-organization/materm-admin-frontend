import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import Cookies from "js-cookie";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/constants/cookies";
import { AuthAPI } from "@/services/auth.api";
import { ApiErrorResponse, ApiResponse } from "@/types/api";
import { ChangePasswordPayload, CurrentUser, LoginPayload } from "@/types/user";

// Dev-only escape hatch: lets `/admin` render without a running backend or
// a real login, so the app can be previewed with zero setup — skips
// both the route guard's redirect and the current-user network call
// entirely. Gated by `NEXT_PUBLIC_DISABLE_AUTH_GUARD`, which is only set in
// `.env.development` (never `.env.production`) — a build-time constant, so
// it's identical on the server and the client's first render and can't
// cause a hydration mismatch. Remove this block once real login is
// wired up end-to-end against the backend.
const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DISABLE_AUTH_GUARD === "true";

// Permission-less dev user returned in bypass mode. Add `permissions` entries
// here (keep them in sync with nav-main-items.ts's `anyPermission` keys) so
// permission-gated nav entries and pages are visible while developing without
// a backend — a key missing here just means that nav entry silently never
// shows up in dev-bypass mode.
const DEV_BYPASS_USER: ApiResponse<CurrentUser> = {
  success: true,
  data: {
    id: 0,
    name: "Dev Bypass User",
    username: "dev",
    image: "",
    roleID: 0,
    role_name: "Dev",
    status: true,
    permissions: [],
  },
};

function toastApiError(error: unknown, fallback: string) {
  if (axios.isAxiosError<ApiErrorResponse>(error)) {
    toast.error(error.response?.data?.message || fallback);
  } else {
    toast.error(error instanceof Error ? error.message : fallback);
  }
}

const noopSubscribe = () => () => {};

// Whether the access-token cookie exists. `useSyncExternalStore` (not
// `typeof window !== "undefined"` read during render) so the server-render
// and the client's first render agree — the cookie doesn't exist on the
// server, so both must return `null` ("unknown yet") rather than the server
// returning `false` and the client immediately returning `true`/`false`,
// which is a hydration mismatch for the guard and the sidebar.
export function useHasAccessToken(): boolean | null {
  const hasCookie = useSyncExternalStore(
    noopSubscribe,
    () => !!Cookies.get(ACCESS_TOKEN_COOKIE),
    () => null
  );
  return DEV_BYPASS_AUTH ? true : hasCookie;
}

// Drives the `(protected)` layout's route guard and the sidebar's
// permission filtering (via `role`). `retry: false` + `enabled` only once
// we know there's a token keep an unauthenticated visitor from sitting on a
// spinner for the default 3-retry backoff — with no cookie, there's
// nothing to fetch, so the guard redirects immediately instead of waiting
// on a network error.
export const useFetchCurrentUser = () => {
  const hasToken = useHasAccessToken();

  return useQuery({
    queryKey: [API_ENDPOINTS.AUTH.ME, DEV_BYPASS_AUTH],
    queryFn: () => (DEV_BYPASS_AUTH ? Promise.resolve(DEV_BYPASS_USER) : AuthAPI.Me()),
    enabled: hasToken === true,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
};

// In-page action gating (not page/sidebar visibility — that's
// RoutePermissionGuard/nav-main-items.ts, keyed on permission_key alone).
// Use this to show/hide or enable/disable a single control (e.g. a delete
// button) based on the current user's actual granted actions for one
// permission. Built on `useFetchCurrentUser` above (not a second /auth/me
// query) so it stays dev-bypass aware — the dev-bypass user's
// permissions have an empty `actions` array, which means "not yet
// action-scoped", i.e. full legacy access, so every action check returns
// true in dev-bypass mode.
//
// If the permission isn't in the user's granted list at all, false. If
// found but `actions` is empty/undefined, true (full legacy access, never
// "no access" — see PermissionGrant's doc comment). If `actions` is
// non-empty, true only when it includes the requested action.
export const useHasAction = (permissionKey: string, action: string): boolean => {
  const { data } = useFetchCurrentUser();
  const permission = data?.data.permissions.find(
    (p) => p.permission_key === permissionKey
  );
  if (!permission) return false;
  if (!permission.actions || permission.actions.length === 0) return true;
  return permission.actions.includes(action);
};

export const useMutationLogin = () => {
  const t = useTranslations("auth");
  return useMutation({
    mutationFn: (payload: LoginPayload) => AuthAPI.Login(payload),
    onSuccess: (res) => {
      Cookies.set(ACCESS_TOKEN_COOKIE, res.data.access);
      Cookies.set(REFRESH_TOKEN_COOKIE, res.data.refresh);
    },
    onError: () => toast.error(t("toast.error")),
  });
};

export const useMutationChangePassword = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ChangePasswordPayload) => AuthAPI.ChangePassword(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.AUTH.ME] });
    },
    onError: (error) => toastApiError(error, "Something went wrong"),
  });
};
