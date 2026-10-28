import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "@/components/protected/settings/settings-page";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, roleID: 2, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/settings/brand",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  me.current = { id: 6, roleID: 2, permissions: grants({ "cms.settings": ["read", "update"], "cms.locales": ["read"] }) };
});

describe("SettingsPage when the group cannot be loaded", () => {
  useMockApi();

  it("shows the error state and stops asking: the number of requests stays the same, no refetch loop", async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/settings/brand`, () => {
        calls += 1;
        return HttpResponse.json({ success: false, error: { code: "INTERNAL_ERROR", message: "boom" } }, { status: 500 });
      })
    );
    renderApp(<SettingsPage group="brand" />);
    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toBeInTheDocument();
    // the group navigation stays, so the user can still switch to another group
    expect(screen.getByRole("navigation")).toBeVisible();
    expect(screen.getAllByRole("link").length).toBeGreaterThanOrEqual(4);
    // and so does the group title above the state
    expect(screen.getByRole("heading", { level: 2 })).toBeVisible();
    const settled = calls;
    expect(settled).toBeGreaterThanOrEqual(1);
    // give a loop time to show itself: the editor must not be remounted into more and more requests
    await new Promise((r) => setTimeout(r, 1500));
    expect(calls).toBe(settled);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
