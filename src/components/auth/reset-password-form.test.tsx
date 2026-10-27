import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Cookies from "js-cookie";
import { http, HttpResponse } from "msw";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { takeSignInNotice } from "@/lib/auth-session";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/constants/cookies";
import { server } from "@/test/msw-server";
import { renderApp } from "@/test/render-app";

const API = "http://localhost:3000/api/v1";
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PASSWORD = "a long passphrase 2026";
const TOKEN = "tok_ABCdef-123";

const openLink = (hash = `#token=${TOKEN}`) =>
  window.history.replaceState(null, "", `/auth/reset-password${hash}`);

async function fillAndSubmit(u: ReturnType<typeof userEvent.setup>, password = PASSWORD, confirm = password) {
  const [pw, cf] = await screen.findAllByLabelText(/password$/i, { selector: "input" });
  await u.type(pw, password);
  await u.type(cf, confirm);
  await u.click(screen.getByRole("button", { name: "Set new password" }));
}

beforeEach(() => {
  router.replace.mockReset();
  Cookies.remove(ACCESS_TOKEN_COOKIE);
  Cookies.remove(REFRESH_TOKEN_COOKIE);
  takeSignInNotice();
});
afterEach(() => window.history.replaceState(null, "", "/"));

describe("ResetPasswordForm (SCR-03)", () => {
  it("takes the token from the fragment, removes it from the address bar, and sends it only in the body", async () => {
    const u = userEvent.setup();
    openLink();
    const bodies: unknown[] = [];
    let url = "";
    server.use(
      http.post(`${API}/auth/reset-password`, async ({ request }) => {
        url = request.url;
        bodies.push(await request.json());
        return HttpResponse.json({ success: true, data: null });
      })
    );
    // Strict Mode runs effects twice (`next dev`): the second run must not find "no token".
    renderApp(
      <StrictMode>
        <ResetPasswordForm />
      </StrictMode>
    );
    await screen.findByRole("button", { name: "Set new password" });
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(TOKEN);

    await fillAndSubmit(u);
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ token: TOKEN, new_password: PASSWORD });
    expect(url).not.toContain(TOKEN);
  });

  it("success: drops any old session, leaves a sign-in notice and goes to sign-in", async () => {
    const u = userEvent.setup();
    openLink();
    Cookies.set(ACCESS_TOKEN_COOKIE, "old-access");
    Cookies.set(REFRESH_TOKEN_COOKIE, "old-refresh");
    server.use(http.post(`${API}/auth/reset-password`, () => HttpResponse.json({ success: true, data: null })));
    renderApp(<ResetPasswordForm />);
    await fillAndSubmit(u);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/auth/sign-in"));
    expect(Cookies.get(ACCESS_TOKEN_COOKIE)).toBeUndefined();
    expect(Cookies.get(REFRESH_TOKEN_COOKIE)).toBeUndefined();
    expect(takeSignInNotice()).toBe("password_reset");
  });

  it("an invalid / expired token (400 INVALID_TOKEN) shows the invalid state with a link to forgot-password", async () => {
    const u = userEvent.setup();
    openLink();
    server.use(
      http.post(`${API}/auth/reset-password`, () =>
        HttpResponse.json({ success: false, code: "INVALID_TOKEN" }, { status: 400 })
      )
    );
    renderApp(<ResetPasswordForm />);
    await fillAndSubmit(u);
    expect(await screen.findByText("This link is invalid or has expired")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/auth/forgot-password");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("no token in the URL: invalid state at once, no request is made", async () => {
    openLink("");
    renderApp(<ResetPasswordForm />); // no handler: any request would fail the test
    expect(await screen.findByText("This link is invalid or has expired")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/auth/forgot-password");
  });

  it("a recently used password (422 password_policy.reused) is shown on the field and the token stays usable", async () => {
    const u = userEvent.setup();
    openLink();
    let calls = 0;
    server.use(
      http.post(`${API}/auth/reset-password`, () => {
        calls += 1;
        return HttpResponse.json(
          {
            success: false,
            code: "VALIDATION_FAILED",
            errors: [{ in: "body", path: "/new_password", code: "password_policy.reused" }],
          },
          { status: 422 }
        );
      })
    );
    renderApp(<ResetPasswordForm />);
    await fillAndSubmit(u);
    expect(await screen.findByText("This password was used recently.")).toBeInTheDocument();
    // Still the form (not the invalid-link state), and the matching checklist row is red.
    expect(screen.getByRole("button", { name: "Set new password" })).toBeEnabled();
    const row = screen.getByText("Not one of your recent passwords (checked when you save)").closest("li");
    expect(row).toHaveAttribute("data-state", "fail");
    expect(calls).toBe(1);
  });

  it("checks length (12) and confirmation on the client before sending", async () => {
    const u = userEvent.setup();
    openLink();
    renderApp(<ResetPasswordForm />); // no handler
    await fillAndSubmit(u, "short", "different");
    expect(await screen.findByText("At least 12 characters", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
  });

  it("the live checklist turns the length row green at 12 characters", async () => {
    const u = userEvent.setup();
    openLink();
    renderApp(<ResetPasswordForm />);
    const [pw] = await screen.findAllByLabelText(/password$/i, { selector: "input" });
    const row = () => screen.getByText("At least 12 characters", { selector: "span" }).closest("li");
    await u.type(pw, "elevenchars");
    expect(row()).toHaveAttribute("data-state", "fail");
    await u.type(pw, "!");
    expect(row()).toHaveAttribute("data-state", "ok");
  });
});
