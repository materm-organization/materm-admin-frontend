"use client";

import { useEffect, useId, useRef } from "react";

import { useNavigationGuardContext } from "@/components/provider/navigation-guard";

// Marks the current page as having unsaved changes while `isDirty` is true (doc/07 section 2.5.5): the tab
// close / reload prompt, link clicks, `guardedNavigate` and the Back button then ask "discard changes?".
// `onSave` (optional) adds a "Save and leave" choice: return `false` (or throw) when the save did not go
// through so the user stays. It is always called through a ref, so passing an inline function is fine.
export function useUnsavedChangesGuard(
  isDirty: boolean,
  options: { onSave?: () => Promise<boolean | void> | boolean | void } = {}
) {
  const id = useId();
  const { register, update } = useNavigationGuardContext();
  const onSaveRef = useRef(options.onSave);

  useEffect(() => {
    onSaveRef.current = options.onSave;
    update(id, { onSave: options.onSave ? () => onSaveRef.current?.() : undefined });
  });

  const hasSaver = Boolean(options.onSave);
  useEffect(() => {
    if (!isDirty) return;
    return register(id, { onSave: hasSaver ? () => onSaveRef.current?.() : undefined });
  }, [isDirty, hasSaver, id, register]);
}
