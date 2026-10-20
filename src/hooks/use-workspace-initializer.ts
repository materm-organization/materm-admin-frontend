"use client";

import { useEffect } from "react";

import { useAppDispatch } from "@/redux/hooks";
import { setActiveWorkspaceId } from "@/redux/slices/ui.slice";

const STORAGE_KEY = "app_active_workspace_id";

// Cross-cutting client-state sync hook, mounted once at the protected
// layout level: syncs the example active-workspace UI state from
// localStorage on mount. Kept deliberately minimal — there is no real
// workspace/tenant API to sync against yet.
export function useWorkspaceInitializer() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) dispatch(setActiveWorkspaceId(stored));
    } catch {
      // localStorage can throw (private mode, disabled storage) — the
      // example workspace context simply stays null in that case.
    }
  }, [dispatch]);
}
