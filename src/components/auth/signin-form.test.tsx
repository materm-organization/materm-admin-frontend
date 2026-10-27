import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SignInForm } from "@/components/auth/signin-form";
import { SIGN_IN_NOTICE, setSignInNotice, takeSignInNotice } from "@/lib/auth-session";
import { renderApp } from "@/test/render-app";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => {
  takeSignInNotice();
  Object.values(toast).forEach((fn) => fn.mockReset());
});

describe("SignInForm", () => {
  it("links to the forgot-password page", () => {
    renderApp(<SignInForm />);
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/auth/forgot-password");
  });

  it("shows the 'password was reset' notice left by SCR-03 (and only once)", async () => {
    setSignInNotice(SIGN_IN_NOTICE.PASSWORD_RESET);
    renderApp(<SignInForm />);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Your password was reset. Sign in with the new password.", {
        id: "password-reset",
      })
    );
    expect(toast.info).not.toHaveBeenCalled();
    expect(takeSignInNotice()).toBeNull();
  });

  it("keeps the 'session ended' notice for a forced sign-out", async () => {
    setSignInNotice(SIGN_IN_NOTICE.SESSION_ENDED);
    renderApp(<SignInForm />);
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });
});
