"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { ChangePasswordDialog } from "@/components/auth/change-password-dialog";
import { NoPermission } from "@/components/layout/no-permission";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useFetchCurrentUser, useHasAccessToken } from "@/hooks/use-auth";
import { isNoPermissionError, parseApiError } from "@/lib/api-error";
import { getPermissionsForPath } from "@/lib/nav-main-items";
import { getReadablePermissionKeys } from "@/lib/permissions";

// The actual access-control boundary — the
// sidebar's own filtering is UX only, not security. Looks up the required
// permissions for the current pathname from the same config the nav uses
// (`getPermissionsForPath`), shows a spinner while the current-user fetch
// is in flight, and renders a "no permission" state if the user lacks
// `read` on every required permission. While `must_change_password` is true
// nothing of the app is rendered: only the non-dismissable change-password
// dialog (the backend also answers 403 PASSWORD_CHANGE_REQUIRED to every
// other endpoint, so there is nothing else the user could use anyway).
export function RoutePermissionGuard({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common");
  const tErrors = useTranslations("errors");
  const pathname = usePathname();
  const router = useRouter();
  // `null` = not known yet (server render / pre-hydration), `false` = no
  // cookie, `true` = cookie present. Keeping the `null` state distinct from
  // `false` is what keeps this in sync between server and client — see
  // useHasAccessToken's doc comment.
  const hasToken = useHasAccessToken();

  const { data, isLoading, isError, error, refetch, isFetching } = useFetchCurrentUser();

  // No token at all, or the current-user fetch ended in a 401 (the axios
  // interceptor already refreshed / signed out; this is the safety net) ->
  // bounce to sign-in rather than hanging on a spinner. Any OTHER failure
  // (network, 429, 5xx) is not a reason to sign the user out: it is toasted
  // globally and a retry panel is shown below.
  const sessionGone = hasToken === false || (isError && parseApiError(error).status === 401);
  useEffect(() => {
    if (sessionGone) router.replace("/auth/sign-in");
  }, [sessionGone, router]);

  if (sessionGone) {
    return null;
  }

  // 403 / auth errors on the current-user read: "no permission", no retry button, no reload.
  if (isError && isNoPermissionError(error)) {
    return <NoPermission />;
  }

  if (isError) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">{tErrors("loadAccount")}</p>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Spinner /> : null}
          {t("retry")}
        </Button>
      </div>
    );
  }

  if (hasToken === null || isLoading || !data) {
    // `min-h-[40vh]` (not `flex-1`) — unlike `flex-1`, this centers
    // correctly on its own regardless of whether the parent (`<main>` in
    // the protected layout) happens to be a flex container.
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (data.data.must_change_password) {
    return (
      <>
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner className="size-6" />
        </div>
        <ChangePasswordDialog open forced onOpenChange={() => {}} />
      </>
    );
  }

  const userPermissions = getReadablePermissionKeys(data.data.permissions);
  const requiredPermissions = getPermissionsForPath(pathname);
  const isAllowed =
    !requiredPermissions ||
    requiredPermissions.length === 0 ||
    requiredPermissions.some((p) => userPermissions.includes(p));

  if (!isAllowed) {
    return <NoPermission />;
  }

  return <>{children}</>;
}
