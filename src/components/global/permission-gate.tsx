"use client";

import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

import { useCan } from "@/hooks/use-permission";

// Shows (or disables) UI according to the user's grants (doc/07 section 5.2). UX only — the server decides.
//  - `action` (one) or `actions` (several, any-of by default, `match="all"` for all-of);
//  - `ownerId`: the `<action>_own` grant counts when the signed-in user created the thing;
//  - `mode="hide"` (default): not allowed -> `fallback` (nothing by default);
//    `mode="disable"`: not allowed -> children stay but are disabled (`disabled` + `aria-disabled` on a
//    single element child, otherwise wrapped in a disabled <fieldset>); use it only where the reason has to be
//    visible, row actions are hidden (doc/07 section 2.5.1).
// Page-level use: `<PermissionGate permission="cms.blog" action="create" fallback={<ForbiddenState />}>`.
export function PermissionGate({
  permission,
  action,
  actions,
  match = "any",
  mode = "hide",
  ownerId,
  fallback = null,
  children,
}: {
  permission: string;
  action?: string;
  actions?: readonly string[];
  match?: "any" | "all";
  mode?: "hide" | "disable";
  ownerId?: number | string | null;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const required = actions ?? (action ? [action] : []);
  const allowed = useCan(permission, required, { match, ownerId });

  if (allowed) return <>{children}</>;
  if (mode === "hide") return <>{fallback}</>;

  const only = Children.toArray(children);
  if (only.length === 1 && isValidElement(only[0])) {
    return cloneElement(only[0] as ReactElement<{ disabled?: boolean; "aria-disabled"?: boolean }>, {
      disabled: true,
      "aria-disabled": true,
    });
  }
  return (
    <fieldset disabled aria-disabled className="m-0 contents border-0 p-0">
      {children}
    </fieldset>
  );
}
