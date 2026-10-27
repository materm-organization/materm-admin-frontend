import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Cookies from "js-cookie";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";

import { useApiErrorHandler } from "@/hooks/use-api-error";
import { parseApiError } from "@/lib/api-error";
import { SIGN_IN_PATH, clearSession, setTokens } from "@/lib/auth-session";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ACCESS_TOKEN_COOKIE } from "@/lib/constants/cookies";
import { PERMISSION_CATALOG } from "@/lib/constants/permissions";
import { userHasAction } from "@/lib/permissions";
import { AuthAPI } from "@/services/auth.api";
import { ApiResponse } from "@/types/api";
import { ChangePasswordPayload, CurrentUser, LoginPayload } from "@/types/user";

// Dev-only escape hatch: lets `/admin` render without a running backend or
// a real login, so the app can be previewed with zero setup — skips
// both the route guard's redirect and the current-user network call
// entirely. Gated by `NEXT_PUBLIC_DISABLE_AUTH_GUARD`, which is only set in
// `.env.development` (never `.env.production`) — a build-time constant, so
// it's identical on the server and the client's first render and can't
// cause a hydration mismatch.
const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DISABLE_AUTH_GUARD === "true";

// Dev-bypass user: holds EVERY permission key with EVERY action that key
// supports (same as a super_admin, the 22 keys / 15 actions of the catalog) so
// permission-gated nav entries, pages and buttons are all visible while
// developing without a backend. `actions: []` would mean NO access.
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
    must_change_password: false,
    permissions: PERMISSION_CATALOG.map((p, index) => ({
      id: index + 1,
      permission_key: p.permission_key,
      name: p.name,
      description: p.description,
      category: p.category,
      actions: [...p.available_actions],
    })),
  },
};

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

// Drives the `(protected)` layout's route guard, the sidebar's permission
// filtering and the forced change-password gate (`must_change_password`).
// `retry: false` + `enabled` only once we know there's a token keep an
// unauthenticated visitor from sitting on a spinner. lib/axios.ts's auth
// events (AUTHZ_CHANGED, PASSWORD_CHANGE_REQUIRED) invalidate this query via
// QueryProvider, which is how new permissions / the forced dialog show up.
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

// In-page action gating (page/sidebar visibility is RoutePermissionGuard /
// nav-main-items.ts, keyed on read access). Use this to show/hide or
// enable/disable one control (e.g. a "create" button). Built on
// `useFetchCurrentUser` (not a second /auth/me query) so it stays
// dev-bypass aware. `actions: []`, a missing key, or user data not loaded yet
// all mean NO access (false) — the opposite of the old legacy meaning.
export const useHasAction = (permissionKey: string, action: string): boolean => {
  const { data } = useFetchCurrentUser();
  return userHasAction(data?.data.permissions, permissionKey, action);
};

export const useMutationLogin = () => {
  const { toastError } = useApiErrorHandler();
  return useMutation({
    mutationFn: (payload: LoginPayload) => AuthAPI.Login(payload),
    onSuccess: (res) => {
      setTokens({ access: res.data.access, refresh: res.data.refresh });
    },
    // 401 INVALID_CREDENTIALS / 422 -> translated toast; 429/5xx/network are
    // toasted globally by QueryProvider.
    onError: (error) => toastError(error),
  });
};

// Sign-out: POST /auth/logout (revokes the session family server-side), but
// whatever the server says, the local session is always cleared and the user
// is sent to sign-in. A 401 means "already signed out" (not an error);
// any other failure shows a warning that the server session may linger.
export const useLogout = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("auth");

  const mutation = useMutation({
    mutationFn: async () => {
      if (DEV_BYPASS_AUTH) return { serverRevoked: true };
      try {
        await AuthAPI.Logout();
      } catch (error) {
        if (parseApiError(error).status === 401) return { serverRevoked: true };
        return { serverRevoked: false };
      }
      return { serverRevoked: true };
    },
    onSettled: (result) => {
      clearSession();
      // Drop every cached query so a different user signing in right after
      // doesn't briefly see this user's cached data.
      queryClient.clear();
      router.replace(SIGN_IN_PATH);
      if (result && !result.serverRevoked) toast.warning(t("notices.logoutServerFailed"));
    },
  });

  return { logout: () => mutation.mutate(), isPending: mutation.isPending };
};

// Change password (also the way out of `must_change_password`). Errors are
// handled by the dialog (field errors); on success `/auth/me` is re-read —
// awaited, so the forced dialog stays up until `must_change_password` is
// really false. The current session keeps its tokens (the backend revokes
// only the OTHER sessions).
export const useMutationChangePassword = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ChangePasswordPayload) => AuthAPI.ChangePassword(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.AUTH.ME] }),
  });
};
