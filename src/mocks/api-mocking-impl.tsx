"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { createMockAdapter } from "@/mocks/axios-adapter";
import { mockApiHandlers } from "@/mocks/handlers";
import { getMockDb, resetMockDb } from "@/mocks/mock-db";
import { touchPageAsSomeoneElse } from "@/mocks/mock-pages";
import { axiosInstance, axiosPublicInstance } from "@/lib/axios";

// Points the admin's axios instances at the in-memory API (`mocks/mock-db.ts`) while mounted, and says so in a
// thin banner. Used by the dev playground (`/admin/dev-tools/media`) and, with `NEXT_PUBLIC_API_MOCKING=true`, by
// the whole app (`ApiMocking`). Installed during the first render so the first request is already mocked.
export default function ApiMockingImpl({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  useState(() => {
    const adapter = createMockAdapter(mockApiHandlers);
    axiosInstance.defaults.adapter = adapter;
    axiosPublicInstance.defaults.adapter = adapter;
    // For a browser click-through (Playwright): the model is per tab, so "somebody else saved the page" can not be done
    // from a second tab. `__MATERM_MOCK__.touchPage(9)` bumps the page's lock_version once; the next command with the old
    // ETag is a 409 CONFLICT_LOCK_VERSION. Only exists in a build with NEXT_PUBLIC_API_MOCKING=true.
    (window as unknown as { __MATERM_MOCK__?: unknown }).__MATERM_MOCK__ = {
      touchPage: (id: number) => touchPageAsSomeoneElse(getMockDb(), id),
      pages: () => getMockDb().pages.map((p) => ({ id: p.id, status: p.status, lock_version: p.lock_version, deleted_at: p.deleted_at })),
    };
    return true;
  });
  return (
    <>
      <div
        role="status"
        data-testid="api-mock-banner"
        className="flex items-center justify-between gap-2 border-b border-amber-500/50 bg-amber-100 px-3 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      >
        <span>API mocking is ON: the CMS screens (pages, media, menus, settings, revisions ...) talk to an in-memory model, not a backend.</span>
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => {
            resetMockDb();
            void queryClient.invalidateQueries();
          }}
        >
          Reset mock data
        </button>
      </div>
      {children}
    </>
  );
}
