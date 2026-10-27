"use client";

import { useMemo } from "react";

import { useFetchCurrentUser } from "@/hooks/use-auth";
import { useRoles } from "@/hooks/use-roles";
import type { RoleSummary } from "@/types/iam";

// Roles the signed-in user may hand out (BR-21): a role with `is_super` can only be given (or taken away) by a
// user who is in a `is_super` role. The role list is how that is known (`CurrentUser.roleID` vs `GET /roles`);
// if the list is unavailable the signed-in user is treated as NOT super (the super role stays hidden). UX only —
// the server answers 403 SUPER_ADMIN_PROTECTED anyway.
export function useAssignableRoles(enabled = true) {
  const roles = useRoles(enabled);
  const { data: me } = useFetchCurrentUser();
  const all = useMemo(() => roles.data?.data ?? [], [roles.data]);
  const meIsSuper = all.find((r) => r.id === me?.data.roleID)?.is_super === true;
  const assignable = useMemo<RoleSummary[]>(() => all.filter((r) => meIsSuper || !r.is_super), [all, meIsSuper]);
  return { roles: all, assignable, meIsSuper, isLoading: roles.isLoading, meId: me?.data.id };
}
