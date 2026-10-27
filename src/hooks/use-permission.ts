"use client";

import { useFetchCurrentUser } from "@/hooks/use-auth";
import { type CanOptions, userCan } from "@/lib/permissions";

// `useHasAction` for several actions and "own" grants: `true` when the signed-in user holds any (or, with
// `match: "all"`, all) of `actions` on `permissionKey`; with `ownerId` the `<action>_own` grant counts for the
// creator. Built on `useFetchCurrentUser` (dev-bypass aware). Loading / no user = false.
export function useCan(
  permissionKey: string,
  actions: string | readonly string[],
  options: Pick<CanOptions, "match" | "ownerId"> = {}
): boolean {
  const { data } = useFetchCurrentUser();
  return userCan(data?.data.permissions, permissionKey, actions, {
    ...options,
    currentUserId: data?.data.id,
  });
}

// Can the user edit something created by `createdBy`: `update`, or `update_own` for their own thing.
export function useCanEditOwn(permissionKey: string, createdBy: number | string | null | undefined) {
  return useCan(permissionKey, "update", { ownerId: createdBy });
}
