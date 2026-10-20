"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { Spinner } from "@/components/ui/spinner";
import { useFetchCurrentUser, useHasAccessToken } from "@/hooks/use-auth";
import { getPermissionsForPath } from "@/lib/nav-main-items";

// The actual access-control boundary — the
// sidebar's own filtering is UX only, not security. Looks up the required
// permissions for the current pathname from the same config the nav uses
// (`getPermissionsForPath`), shows a spinner while the current-user fetch
// is in flight, and renders a "no permission" state if the user lacks
// every required permission.
export function RoutePermissionGuard({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common");
  const pathname = usePathname();
  const router = useRouter();
  // `null` = not known yet (server render / pre-hydration), `false` = no
  // cookie, `true` = cookie present. Keeping the `null` state distinct from
  // `false` is what keeps this in sync between server and client — see
  // useHasAccessToken's doc comment.
  const hasToken = useHasAccessToken();

  const { data, isLoading, isError } = useFetchCurrentUser();

  // No token at all, or the current-user fetch failed outright (network
  // error or a 401 the axios interceptor didn't already redirect on) ->
  // bounce to sign-in immediately rather than hanging on a spinner.
  useEffect(() => {
    if (hasToken === false || isError) {
      router.replace("/auth/sign-in");
    }
  }, [hasToken, isError, router]);

  if (hasToken === false || isError) {
    return null;
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

  const userPermissions = data.data.permissions.map((p) => p.permission_key);
  const requiredPermissions = getPermissionsForPath(pathname);
  const isAllowed =
    !requiredPermissions ||
    requiredPermissions.length === 0 ||
    requiredPermissions.some((p) => userPermissions.includes(p));

  if (!isAllowed) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm font-medium">{t("noPermissionTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("noPermissionDescription")}</p>
      </div>
    );
  }

  return <>{children}</>;
}
