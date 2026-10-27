import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { server } from "@/test/msw-server";
import { renderApp } from "@/test/render-app";

const API = "http://localhost:3000/api/v1";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const NEUTRAL = /If an account matches, we have sent a link/;

beforeEach(() => vi.useRealTimers());

describe("ForgotPasswordForm (SCR-02)", () => {
  it("shows the same neutral message whatever the server says about the account", async () => {
    const u = userEvent.setup();
    const sent: unknown[] = [];
    server.use(
      http.post(`${API}/auth/forgot-password`, async ({ request }) => {
        sent.push(await request.json());
        // The server answers 200 with ITS OWN text; the page must not show that text.
        return HttpResponse.json({ success: true, message: "SERVER-TEXT-must-not-be-shown", data: null });
      })
    );
    const first = renderApp(<ForgotPasswordForm />);
    await u.type(screen.getByLabelText("Username or e-mail"), "  nobody@example.com ");
    await u.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText(NEUTRAL)).toBeInTheDocument();
    expect(screen.queryByText(/SERVER-TEXT/)).not.toBeInTheDocument();
    const textKnown = document.body.textContent;
    expect(sent).toEqual([{ identifier: "nobody@example.com" }]);
    expect(screen.getByRole("link", { name: /Back to sign in/ })).toHaveAttribute("href", "/auth/sign-in");
    first.unmount();

    // A different identifier (an existing account) leads to the identical screen.
    renderApp(<ForgotPasswordForm />);
    await u.type(screen.getByLabelText("Username or e-mail"), "ann");
    await u.click(screen.getByRole("button", { name: "Send reset link" }));
    await screen.findByText(NEUTRAL);
    expect(document.body.textContent).toBe(textKnown);
  });

  it("validates the length (3-254) before calling the server", async () => {
    const u = userEvent.setup();
    renderApp(<ForgotPasswordForm />); // no handler: any request would fail the test
    await u.type(screen.getByLabelText("Username or e-mail"), "ab");
    await u.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText("Enter at least 3 characters")).toBeInTheDocument();
  });

  it("a 429 shows the Retry-After wait inline and disables the button", async () => {
    const u = userEvent.setup();
    server.use(
      http.post(`${API}/auth/forgot-password`, () =>
        HttpResponse.json({ success: false, code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": "42" } })
      )
    );
    renderApp(<ForgotPasswordForm />);
    await u.type(screen.getByLabelText("Username or e-mail"), "ann");
    await u.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/try again in 42 seconds/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Send reset link" })).toBeDisabled());
    expect(screen.queryByText(NEUTRAL)).not.toBeInTheDocument();
  });

  it("a long Retry-After (the 10/hour/IP budget) is shown in minutes", async () => {
    const u = userEvent.setup();
    server.use(
      http.post(`${API}/auth/forgot-password`, () =>
        HttpResponse.json({ success: false, code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": "3271" } })
      )
    );
    renderApp(<ForgotPasswordForm />);
    await u.type(screen.getByLabelText("Username or e-mail"), "ann");
    await u.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/about 55 minutes/);
  });
});
