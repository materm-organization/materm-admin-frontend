import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Cookies from "js-cookie";
import { http, HttpResponse } from "msw";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AcceptInviteForm } from "@/components/auth/accept-invite-form";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/constants/cookies";
import { server } from "@/test/msw-server";
import { renderApp } from "@/test/render-app";

const API = "http://localhost:3000/api/v1";
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const TOKEN = "inv_TOKEN-xyz";
const PASSWORD = "a long passphrase 2026";
const VERIFIED = {
  email: "noy@example.com",
  name: "Noy Phommasan",
  role_name: "Editor",
  expires_at: "2026-10-30T09:00:00Z",
  suggested_username: "noy",
};
const verifyOk = (over: Record<string, unknown> = {}) =>
  http.post(`${API}/auth/invitations/verify`, () => HttpResponse.json({ success: true, data: { ...VERIFIED, ...over } }));
const tokenPair = { access: "new-access", refresh: "new-refresh", expires_in: 900 };

const openLink = (hash = `#token=${TOKEN}`) => window.history.replaceState(null, "", `/auth/accept-invite${hash}`);

async function submit(u: ReturnType<typeof userEvent.setup>, username?: string) {
  if (username !== undefined) {
    const input = await screen.findByLabelText("Username");
    await u.clear(input);
    await u.type(input, username);
  }
  const [pw, cf] = await screen.findAllByLabelText(/^(Password|Confirm password)$/, { selector: "input" });
  await u.type(pw, PASSWORD);
  await u.type(cf, PASSWORD);
  await u.click(screen.getByRole("button", { name: "Create account and sign in" }));
}

beforeEach(() => {
  router.replace.mockReset();
  Cookies.remove(ACCESS_TOKEN_COOKIE);
  Cookies.remove(REFRESH_TOKEN_COOKIE);
});
afterEach(() => window.history.replaceState(null, "", "/"));

describe("AcceptInviteForm (SCR-04)", () => {
  it("verifies first (token in the body), strips the fragment, and shows who is invited with the suggested username", async () => {
    openLink();
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/auth/invitations/verify`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ success: true, data: VERIFIED });
      })
    );
    renderApp(
      <StrictMode>
        <AcceptInviteForm />
      </StrictMode>
    );
    expect(await screen.findByText("noy@example.com")).toBeInTheDocument();
    expect(screen.getByText("Editor")).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveValue("noy");
    expect(screen.getByLabelText("Full name")).toHaveValue("Noy Phommasan");
    expect(bodies).toEqual([{ token: TOKEN }]);
    expect(window.location.href).not.toContain(TOKEN);
  });

  it("accept: signs the invitee in with the returned token pair and goes to /admin", async () => {
    const u = userEvent.setup();
    openLink();
    const sent: unknown[] = [];
    server.use(
      verifyOk(),
      http.post(`${API}/auth/invitations/accept`, async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ success: true, data: tokenPair });
      })
    );
    renderApp(<AcceptInviteForm />);
    await submit(u);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/admin"));
    // Name was not edited -> not sent (the server keeps the inviter's).
    expect(sent).toEqual([{ token: TOKEN, username: "noy", password: PASSWORD }]);
    expect(Cookies.get(ACCESS_TOKEN_COOKIE)).toBe("new-access");
    expect(Cookies.get(REFRESH_TOKEN_COOKIE)).toBe("new-refresh");
  });

  it("a username that is taken (409 CONFLICT_DUPLICATE at /username) is shown on the field; the form stays", async () => {
    const u = userEvent.setup();
    openLink();
    server.use(
      verifyOk(),
      http.post(`${API}/auth/invitations/accept`, () =>
        HttpResponse.json(
          { success: false, code: "CONFLICT_DUPLICATE", errors: [{ in: "body", path: "/username", code: "duplicate" }] },
          { status: 409 }
        )
      )
    );
    renderApp(<AcceptInviteForm />);
    await submit(u, "ann");
    expect(await screen.findByText("This value is already in use.")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
    expect(Cookies.get(ACCESS_TOKEN_COOKIE)).toBeUndefined();
    expect(screen.getByLabelText("Username")).toHaveValue("ann");
  });

  it("a 409 without errors[] still lands on the username field", async () => {
    const u = userEvent.setup();
    openLink();
    server.use(
      verifyOk(),
      http.post(`${API}/auth/invitations/accept`, () =>
        HttpResponse.json({ success: false, code: "CONFLICT_DUPLICATE" }, { status: 409 })
      )
    );
    renderApp(<AcceptInviteForm />);
    await submit(u);
    expect(await screen.findByText("This value is already in use.")).toBeInTheDocument();
  });

  it("an expired / used link (400 INVALID_TOKEN on verify) shows the invalid state", async () => {
    openLink();
    server.use(
      http.post(`${API}/auth/invitations/verify`, () =>
        HttpResponse.json({ success: false, code: "INVALID_TOKEN" }, { status: 400 })
      )
    );
    renderApp(<AcceptInviteForm />);
    expect(await screen.findByText("This invitation is invalid or has expired")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/auth/sign-in");
  });

  it("the link goes stale between verify and accept (400 INVALID_TOKEN on accept) -> invalid state", async () => {
    const u = userEvent.setup();
    openLink();
    server.use(
      verifyOk(),
      http.post(`${API}/auth/invitations/accept`, () =>
        HttpResponse.json({ success: false, code: "INVALID_TOKEN" }, { status: 400 })
      )
    );
    renderApp(<AcceptInviteForm />);
    await submit(u);
    expect(await screen.findByText("This invitation is invalid or has expired")).toBeInTheDocument();
  });

  it("no token in the URL: invalid state, no request", async () => {
    openLink("");
    renderApp(<AcceptInviteForm />);
    expect(await screen.findByText("This invitation is invalid or has expired")).toBeInTheDocument();
  });

  it("when this browser is signed in as someone else it says so, and ends that old session on accept", async () => {
    const u = userEvent.setup();
    openLink();
    Cookies.set(ACCESS_TOKEN_COOKIE, "old-access");
    Cookies.set(REFRESH_TOKEN_COOKIE, "old-refresh");
    let logoutAuth: string | null = null;
    let acceptAuth: string | null | undefined;
    server.use(
      verifyOk({ suggested_username: null }),
      http.post(`${API}/auth/invitations/accept`, ({ request }) => {
        acceptAuth = request.headers.get("authorization");
        return HttpResponse.json({ success: true, data: tokenPair });
      }),
      http.post(`${API}/auth/logout`, ({ request }) => {
        logoutAuth = request.headers.get("authorization");
        return HttpResponse.json({ success: true, data: null });
      })
    );
    renderApp(<AcceptInviteForm />);
    expect(await screen.findByRole("note")).toHaveTextContent(/signed in to another account/);
    expect(screen.getByLabelText("Username")).toHaveValue("");
    await submit(u, "noy.p");
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/admin"));
    // The public accept call never carries the old Bearer token.
    expect(acceptAuth).toBeNull();
    expect(logoutAuth).toBe("Bearer old-access");
    expect(Cookies.get(ACCESS_TOKEN_COOKIE)).toBe("new-access");
  });
});
