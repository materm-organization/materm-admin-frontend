"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import { isGloballyToasted, parseApiError } from "@/lib/api-error";
import { translateApiError, translateFieldError } from "@/lib/api-error-messages";
import { applyFieldErrors } from "@/lib/form-errors";

// What a form's mutation `onError` uses. The split of responsibilities:
//  - network errors, 403 (not PASSWORD_CHANGE_REQUIRED), 429 and 5xx are toasted
//    ONCE by QueryProvider's global handler (so no double toast);
//  - everything else (400/404/409/422, 401 on login) is handled here: field
//    errors go onto the form, other messages become a toast.
export function useApiErrorHandler() {
  const t = useTranslations("errors");

  const translate = useCallback(
    (error: unknown, fallback?: string) => translateApiError(t, parseApiError(error), fallback),
    [t]
  );

  const toastError = useCallback(
    (error: unknown, fallback?: string) => {
      const parsed = parseApiError(error);
      if (isGloballyToasted(parsed)) return;
      toast.error(translateApiError(t, parsed, fallback));
    },
    [t]
  );

  // Puts `errors[]` onto the form; if none could be placed, toasts instead.
  // Returns true when the error was fully handled here or globally.
  const handleFormError = useCallback(
    <T extends FieldValues>(
      form: UseFormReturn<T>,
      error: unknown,
      options: { fieldMap?: Record<string, Path<T>>; fallback?: string } = {}
    ) => {
      const parsed = parseApiError(error);
      if (isGloballyToasted(parsed)) return;
      const applied = applyFieldErrors(
        form,
        parsed.fieldErrors,
        (fe) => translateFieldError(t, fe),
        options.fieldMap
      );
      if (applied === 0) toast.error(translateApiError(t, parsed, options.fallback));
    },
    [t]
  );

  return { translate, toastError, handleFormError };
}
