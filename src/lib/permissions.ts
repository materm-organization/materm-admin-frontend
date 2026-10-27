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

export type CanOptions = {
  // How to combine several actions: any one (default) or all of them.
  match?: "any" | "all";
  // Who created the thing (`created_by`) and who is signed in: lets the `<action>_own` variant of a grant
  // (`update_own`, `delete_own`) count when they are the same person (doc/07 section 5.2).
  ownerId?: number | string | null;
  currentUserId?: number | string | null;
};

// `true` when the user holds `action` on `permissionKey`, or `<action>_own` and owns the thing. Same strictness
// as `userHasAction`: no grant / empty `actions` = false.
export function userCan(
  permissions: readonly PermissionGrant[] | undefined,
  permissionKey: string,
  actions: string | readonly string[],
  options: CanOptions = {}
): boolean {
  const list = typeof actions === "string" ? [actions] : [...actions];
  if (list.length === 0) return false;
  const isOwner =
    options.ownerId !== undefined &&
    options.ownerId !== null &&
    options.currentUserId !== undefined &&
    options.currentUserId !== null &&
    String(options.ownerId) === String(options.currentUserId);

  const check = (action: string) =>
    userHasAction(permissions, permissionKey, action) ||
    (isOwner && userHasAction(permissions, permissionKey, `${action}_own`));

  return options.match === "all" ? list.every(check) : list.some(check);
}
