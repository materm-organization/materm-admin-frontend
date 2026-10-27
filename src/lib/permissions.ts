// Pure permission helpers (no React) — usable from Server Components, hooks
// and plain modules. Semantics (doc/00 section 3, doc/05 section 2.4):
// a grant with `actions = []` means NO access, and a permission key that is
// absent from the list means no access either. `/auth/me` only lists keys the
// user can `read`, but never rely on key presence alone — check the action.
import { PERMISSION_ACTIONS } from "@/lib/constants/permissions";
import type { PermissionGrant } from "@/types/user";

export function userHasAction(
  permissions: readonly PermissionGrant[] | undefined,
  permissionKey: string,
  action: string
): boolean {
  const grant = permissions?.find((p) => p.permission_key === permissionKey);
  if (!grant || !Array.isArray(grant.actions) || grant.actions.length === 0) return false;
  return grant.actions.includes(action);
}

// Permission keys the user can `read` — what route/nav gating
// (nav-main-items.ts `anyPermission`) is checked against.
export function getReadablePermissionKeys(
  permissions: readonly PermissionGrant[] | undefined
): string[] {
  return (permissions ?? [])
    .filter((p) => Array.isArray(p.actions) && p.actions.includes(PERMISSION_ACTIONS.READ))
    .map((p) => p.permission_key);
}
