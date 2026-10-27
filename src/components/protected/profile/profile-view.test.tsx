import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Cookies from "js-cookie";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileView } from "@/components/protected/profile/profile-view";
import { server } from "@/test/msw-server";
import { renderApp } from "@/test/render-app";

const API = "http://localhost:3000/api/v1";
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/admin/profile" }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const profileOf = (over: Record<string, unknown> = {}) => ({
  id: 4, public_id: "p", username: "ann", name: "Ann", email: "ann@example.com", role_key: "editor", role_name: "Editor",
  preferred_locale: null, allowed_locales: [], last_login_at: "2026-10-26T08:00:00Z", password_changed_at: null, ...over,
});
const ok = (data: unknown, etag?: string) =>
  HttpResponse.json({ success: true, data }, etag ? { headers: { ETag: etag } } : undefined);

beforeEach(() => {
  router.refresh.mockReset();
  toasts.success.mockReset();
  toasts.error.mockReset();
  Cookies.remove("locale");
});

describe("ProfileView (SCR-06)", () => {
  it("PATCHes only what changed with If-Match, then uses the new ETag for the next save", async () => {
    const u = userEvent.setup();
    const sent: { ifMatch: string | null; body: unknown }[] = [];
    server.use(
      http.get(`${API}/auth/profile`, () => ok(profileOf(), '"p1"')),
      http.patch(`${API}/auth/profile`, async ({ request }) => {
        sent.push({ ifMatch: request.headers.get("if-match"), body: await request.json() });
        return ok(profileOf({ name: `Ann ${sent.length}` }), `"p${sent.length + 1}"`);
      })
    );
    renderApp(<ProfileView />);
    expect(await screen.findByText("ann@example.com")).toBeInTheDocument(); // read-only facts
    const name = await screen.findByLabelText(/^Full name/);
    await u.clear(name);
    await u.type(name, "Ann 1");
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ ifMatch: '"p1"', body: { name: "Ann 1" } });
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Profile updated"));

    const again = await screen.findByLabelText(/^Full name/);
    await waitFor(() => expect(again).toHaveValue("Ann 1"));
    await u.clear(again);
    await u.type(again, "Ann 2");
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].ifMatch).toBe('"p2"');
    expect(router.refresh).not.toHaveBeenCalled(); // language untouched
  });

  it("an ETag conflict (409) opens the ConflictDialog; loading the latest version shows the other person's data", async () => {
    const u = userEvent.setup();
    let gets = 0;
    server.use(
      http.get(`${API}/auth/profile`, () => {
        gets += 1;
        return gets === 1 ? ok(profileOf(), '"p1"') : ok(profileOf({ name: "Ann from another tab" }), '"p9"');
      }),
      http.patch(`${API}/auth/profile`, () =>
        HttpResponse.json({ success: false, code: "CONFLICT_LOCK_VERSION" }, { status: 409 })
      )
    );
    renderApp(<ProfileView />);
    const name = await screen.findByLabelText(/^Full name/);
    await u.clear(name);
    await u.type(name, "My edit");
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    const dialog = await screen.findByRole("dialog", { name: "Someone else changed this item" });
    await u.click(within(dialog).getByRole("button", { name: "Keep my changes to review" }));
    expect(await within(dialog).findByText("My edit")).toBeInTheDocument();
    await u.click(within(dialog).getByRole("button", { name: "Back" }));
    await u.click(within(dialog).getByRole("button", { name: /Load the latest version/ }));
    await waitFor(() => expect(screen.getByLabelText(/^Full name/)).toHaveValue("Ann from another tab"));
  });

  it("saving a different preferred language also switches the admin UI (cookie + refresh)", async () => {
    const u = userEvent.setup();
    let body: unknown;
    server.use(
      http.get(`${API}/auth/profile`, () => ok(profileOf(), '"p1"')),
      http.patch(`${API}/auth/profile`, async ({ request }) => {
        body = await request.json();
        return ok(profileOf({ preferred_locale: "la" }), '"p2"');
      })
    );
    renderApp(<ProfileView />);
    await u.click(await screen.findByRole("combobox", { name: /Preferred language/ }));
    await u.click(await screen.findByRole("option", { name: "ລາວ" }));
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(body).toEqual({ preferred_locale: "la" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(Cookies.get("locale")).toBe("la");
  });

  it("a 403 on the read shows the no-permission state, not a retry panel", async () => {
    server.use(
      http.get(`${API}/auth/profile`, () => HttpResponse.json({ success: false, code: "FORBIDDEN" }, { status: 403 }))
    );
    renderApp(<ProfileView />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});
