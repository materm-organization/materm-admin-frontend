// Maps API field errors (doc/05 section 1.5: `errors[]` with a JSON-Pointer
// `path`) onto react-hook-form fields. Returns how many were applied so the
// caller can fall back to a toast when none matched.
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";

import type { ApiFieldError } from "@/types/api";

// First segment of a JSON Pointer: "/new_password" -> "new_password",
// "/grants/3/actions" -> "grants", "" -> undefined.
export function firstPointerSegment(path: string): string | undefined {
  const segment = path.split("/")[1];
  if (!segment) return undefined;
  // RFC 6901 escapes.
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function applyFieldErrors<T extends FieldValues>(
  form: UseFormReturn<T>,
  fieldErrors: ApiFieldError[],
  translate: (fieldError: ApiFieldError) => string,
  // API field -> form field, only needed where the names differ
  // (e.g. `new_password` -> `password`).
  fieldMap: Record<string, Path<T>> = {}
): number {
  const known = form.getValues();
  let applied = 0;
  let focused = false;
  for (const fieldError of fieldErrors) {
    if (fieldError.in !== "body") continue;
    const apiField = firstPointerSegment(fieldError.path);
    if (!apiField) continue;
    const name = (fieldMap[apiField] ?? (apiField in known ? apiField : undefined)) as
      | Path<T>
      | undefined;
    if (!name) continue;
    form.setError(
      name,
      { type: "server", message: translate(fieldError) },
      { shouldFocus: !focused }
    );
    focused = true;
    applied += 1;
  }
  return applied;
}
