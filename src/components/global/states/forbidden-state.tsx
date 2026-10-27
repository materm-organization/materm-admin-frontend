"use client";

import { NoPermission } from "@/components/layout/no-permission";

// "Forbidden" in the standard state set (doc/07 section 2.4): a route/action refused by `PermissionGate`, or a
// read that ended in 403 / an auth error. It IS the existing `NoPermission` panel — one look, one place; this
// name is what pages use so the set reads the same everywhere (loading / empty / error / forbidden / not found).
export function ForbiddenState() {
  return <NoPermission />;
}
