"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { createMockAdapter } from "@/mocks/axios-adapter";
import { mockApiHandlers } from "@/mocks/handlers";
import { getMockDb, resetMockDb } from "@/mocks/mock-db";
import { touchPageAsSomeoneElse } from "@/mocks/mock-pages";
import { exhaustPreviewRate, fillPreviewLinks, previewLinkSummary, setPreviewUnconfigured } from "@/mocks/mock-preview";
import { axiosInstance, axiosPublicInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";

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
      // Preview links (T1.4.4): `setPreviewUnconfigured(true)` = the server has no portal URL (503 `preview.portalUrl`);
      // `exhaustPreviewRate()` = 30 links were issued in the last hour (the next one is a 429); `fillPreviewLinks(8, n)` adds
      // n active links of mine to a page (page 8 starts with 19: the cap is 20); `previewLinks()` lists them WITHOUT any url.
      setPreviewUnconfigured: (on: boolean) => setPreviewUnconfigured(getMockDb(), on),
      exhaustPreviewRate: () => exhaustPreviewRate(getMockDb()),
      fillPreviewLinks: (pageId: number, count: number) => fillPreviewLinks(getMockDb(), pageId, count),
      previewLinks: () => previewLinkSummary(getMockDb()),
      pages: () => getMockDb().pages.map((p) => ({ id: p.id, status: p.status, lock_version: p.lock_version, deleted_at: p.deleted_at })),
      // "I am a translator": the model acts as a translate-only writer (403 rules of 05 12.3.3 / 12.5.6) AND the signed-in
      // user keeps only `read` + `translate` on pages / sections / seo, so the editor shows its translator mode.
      // `setTranslateOnly(false)` gives every action back. The cached `/auth/me` is overwritten (the dev bypass user).
      setTranslateOnly: (on: boolean) => {
        getMockDb().translateOnly = on ? ["pages", "sections", "seo"] : [];
        queryClient.setQueriesData<{ data: { permissions: Array<{ permission_key: string; actions: string[]; available?: string[] }> } }>(
          { queryKey: [API_ENDPOINTS.AUTH.ME] },
          (old) => {
            if (!old) return old;
            const original = ((window as unknown as { __MATERM_FULL_ME__?: typeof old.data.permissions }).__MATERM_FULL_ME__ ??= structuredClone(old.data.permissions));
            const permissions = on
              ? original.map((p) => (["cms.pages", "cms.sections", "cms.seo"].includes(p.permission_key) ? { ...p, actions: p.actions.filter((a) => a === "read" || a === "translate") } : p))
              : original;
            return { ...old, data: { ...old.data, permissions } };
          }
        );
      },
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
