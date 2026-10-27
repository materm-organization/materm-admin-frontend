// Maps API field errors (doc/05 section 1.5: `errors[]` with a JSON-Pointer
// `path`) onto react-hook-form fields. Returns how many were applied so the
// caller can fall back to a toast when none matched.
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";

import type { ApiFieldError } from "@/types/api";

// RFC 6901: "~1" -> "/", "~0" -> "~" (in this order).
function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

// All segments of a JSON Pointer, unescaped: "/items/1/title/la" -> ["items","1","title","la"],
// "" (the whole object) -> []. A pointer that does not start with "/" is not a pointer -> [].
export function parsePointer(path: string): string[] {
  if (!path || !path.startsWith("/")) return [];
  return path.slice(1).split("/").map(unescapePointerSegment);
}

// First segment of a JSON Pointer: "/new_password" -> "new_password",
// "/grants/3/actions" -> "grants", "" -> undefined.
export function firstPointerSegment(path: string): string | undefined {
  const segment = parsePointer(path)[0];
  return segment ? segment : undefined;
}

// Whole JSON Pointer as a react-hook-form dotted path (doc/07 section 4.6, closes F-7):
// "/items/1/title/la" -> "items.1.title.la", "/new_password" -> "new_password".
// "" (the whole object) or a pointer with an empty segment ("/a//b") -> undefined: it names no field.
// A key that itself contains a "." cannot be told apart in a dotted path; the content schemas never use one.
export function pointerToFieldPath(path: string): string | undefined {
  const segments = parsePointer(path);
  if (segments.length === 0 || segments.some((segment) => segment === "")) return undefined;
  return segments.join(".");
}

export type ApplyFieldErrorsOptions = {
  // false (default): only the FIRST pointer segment is mapped (flat forms, `fieldMap` keys are API fields).
  // true: the whole pointer becomes a nested path (`/items/1/title/la` -> `items.1.title.la`); `fieldMap` is
  // looked up by the full dotted path first, then by the first segment.
  nested?: boolean;
  // Called for each placed error with its form path (dotted) so an editor can switch the locale tab, expand the
  // array item and focus the field before the error is shown.
  onLocatedError?: (path: string, fieldError: ApiFieldError) => void;
};

export function applyFieldErrors<T extends FieldValues>(
  form: UseFormReturn<T>,
  fieldErrors: ApiFieldError[],
  translate: (fieldError: ApiFieldError) => string,
  // API field -> form field, only needed where the names differ
  // (e.g. `new_password` -> `password`).
  fieldMap: Record<string, Path<T>> = {},
  options: ApplyFieldErrorsOptions = {}
): number {
  const known = form.getValues();
  let applied = 0;
  let focused = false;
  for (const fieldError of fieldErrors) {
    if (fieldError.in !== "body") continue;
    const apiField = firstPointerSegment(fieldError.path);
    if (!apiField) continue;

    let name: string | undefined;
    if (options.nested) {
      const full = pointerToFieldPath(fieldError.path);
      if (!full) continue;
      const mappedHead = fieldMap[apiField];
      if (fieldMap[full]) {
        name = fieldMap[full];
      } else if (mappedHead) {
        // The head is renamed, the tail is kept: "new_password" -> "password", "a/1/b" -> "x.1.b".
        name = `${mappedHead}${full.slice(apiField.length)}`;
      } else if (apiField in known) {
        name = full;
      }
    } else {
      name = fieldMap[apiField] ?? (apiField in known ? apiField : undefined);
    }
    if (!name) continue;

    form.setError(
      name as Path<T>,
      { type: "server", message: translate(fieldError) },
      { shouldFocus: !focused }
    );
    options.onLocatedError?.(name, fieldError);
    focused = true;
    applied += 1;
  }
  return applied;
}
