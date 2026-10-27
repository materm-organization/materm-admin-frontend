"use client";

import { useCallback, useState } from "react";

import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";

// Deep equality of two JSON values (key order does not matter). Props are plain JSON.
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const other = Object.keys(bo).filter((k) => bo[k] !== undefined);
  return keys.length === other.length && keys.every((k) => jsonEqual(ao[k], bo[k]));
}

// Holds the props being edited next to the last saved copy: `isDirty` is a real comparison (typing and
// deleting again is clean), `markSaved` makes the current value the new baseline, `reset` throws the edits away.
// With `guard` (default) a dirty form takes part in the unsaved-changes guard (tab close, links, Back).
export function useSchemaFormState<T extends Record<string, unknown>>(
  initial: T,
  options: { guard?: boolean; onSave?: () => Promise<boolean | void> | boolean | void } = {}
) {
  const [baseline, setBaseline] = useState<T>(initial);
  const [value, setValue] = useState<T>(initial);
  const isDirty = !jsonEqual(value, baseline);
  useUnsavedChangesGuard(options.guard === false ? false : isDirty, { onSave: options.onSave });

  const reset = useCallback(
    (next?: T) => {
      const target = next ?? baseline;
      setBaseline(target);
      setValue(target);
    },
    [baseline]
  );
  const markSaved = useCallback((saved?: T) => setBaseline(saved ?? value), [value]);

  return { value, setValue, baseline, isDirty, reset, markSaved };
}
