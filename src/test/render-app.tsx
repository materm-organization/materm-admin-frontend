import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";

import { NavigationGuardProvider } from "@/components/provider/navigation-guard";
import type { PermissionGrant } from "@/types/user";

import en from "../../i18n/en.json";

// A React Query client for tests: no retries (a failing request fails the test at once), no caching between
// tests. Use with `vi.mock("next/navigation")` for `useRouter` / `useSearchParams` and `signedInAs()` for the
// current user.
export function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
}

// Renders with the real English messages, a QueryClientProvider and the NavigationGuardProvider (the unsaved
// changes guard of the editors).
export function renderApp(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  const queryClient = createTestQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Vientiane">
        <QueryClientProvider client={queryClient}>
          <NavigationGuardProvider>{children}</NavigationGuardProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  }
  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}

// `{ key: [actions] }` -> the `permissions` array of /auth/me.
export function grants(map: Record<string, string[]>): PermissionGrant[] {
  return Object.entries(map).map(([permission_key, actions], i) => ({
    id: i + 1,
    permission_key,
    name: permission_key,
    description: "",
    category: "x",
    actions,
  }));
}
