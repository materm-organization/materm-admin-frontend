"use client";

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { isGloballyToasted, isNoPermissionError, parseApiError } from "@/lib/api-error";
import { translateApiError } from "@/lib/api-error-messages";
import { setAuthEventHandler } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";

// The caches below are created once, but the translator changes with the
// locale: the latest handler is installed from an effect.
let reportGlobalError: (error: unknown) => void = () => {};

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("errors");

  // Global toast for errors a form can't sensibly handle itself: network
  // failures, 403 (not PASSWORD_CHANGE_REQUIRED), 429, 5xx. Never signs out or
  // redirects (that is lib/axios.ts, and only for 401). `id` dedupes identical
  // toasts when several queries fail together.
  useEffect(() => {
    reportGlobalError = (error) => {
      const parsed = parseApiError(error);
      if (!isGloballyToasted(parsed)) return;
      toast.error(translateApiError(t, parsed), {
        id: parsed.code ?? (parsed.isNetworkError ? "NETWORK_ERROR" : String(parsed.status)),
      });
    };
  }, [t]);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        // A read that ends in 403 / an auth error is shown by the page as the "no permission" state
        // (NoPermission): no toast for it. Mutations still toast.
        queryCache: new QueryCache({
          onError: (error) => {
            if (!isNoPermissionError(error)) reportGlobalError(error);
          },
        }),
        mutationCache: new MutationCache({ onError: (error) => reportGlobalError(error) }),
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            // Never retry a 4xx (403 and auth errors would only reload the same refusal); one retry for a
            // network error or a 5xx.
            retry: (failureCount, error) => {
              const status = parseApiError(error).status;
              if (status !== undefined && status >= 400 && status < 500) return false;
              return failureCount < 1;
            },
          },
        },
      })
  );

  // lib/axios.ts can't reach React Query: it reports AUTHZ_CHANGED (the
  // permissions changed server-side) and 403 PASSWORD_CHANGE_REQUIRED here,
  // and re-reading /auth/me is the answer to both — fresh permissions, or
  // `must_change_password: true` which opens the forced change-password
  // dialog in the protected layout.
  useEffect(
    () =>
      setAuthEventHandler(() => {
        void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.AUTH.ME] });
      }),
    [queryClient]
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* `process.env.NODE_ENV` is statically replaced at build time, so
          Next.js dead-code-eliminates this (and the devtools import) out of
          production bundles. */}
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
