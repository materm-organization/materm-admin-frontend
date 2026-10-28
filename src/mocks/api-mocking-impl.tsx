"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { createMockAdapter } from "@/mocks/axios-adapter";
import { mockApiHandlers } from "@/mocks/handlers";
import { resetMockDb } from "@/mocks/mock-db";
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
    return true;
  });
  return (
    <>
      <div
        role="status"
        data-testid="api-mock-banner"
        className="flex items-center justify-between gap-2 border-b border-amber-500/50 bg-amber-100 px-3 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      >
        <span>API mocking is ON: the media library, revisions and cache purge talk to an in-memory model, not a backend.</span>
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
