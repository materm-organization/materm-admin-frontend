import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RoutePermissionGuard } from "@/components/layout/route-permission-guard";
import { apiError } from "@/test/api-error";
import { renderWithIntl } from "@/test/render";
import type { PermissionGrant } from "@/types/user";

const state = vi.hoisted(() => ({
  pathname: "/admin",
  query: {} as Record<string, unknown>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/hooks/use-auth", () => ({
  useHasAccessToken: () => true,
  useFetchCurrentUser: () => state.query,
}));
vi.mock("@/components/auth/change-password-dialog", () => ({
  ChangePasswordDialog: () => <div>forced-change-password</div>,
}));

const grant = (key: string, actions: string[]): PermissionGrant => ({
  id: 1,
  permission_key: key,
  name: key,
  description: "",
  category: "x",
  actions,
});

function signedIn(permissions: PermissionGrant[], mustChange = false) {
  state.query = {
    data: { data: { id: 1, permissions, must_change_password: mustChange } },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  };
}

function renderAt(pathname: string) {
  state.pathname = pathname;
  return renderWithIntl(
    <RoutePermissionGuard>
      <p>page content</p>
    </RoutePermissionGuard>
  );
}

beforeEach(() => {
  signedIn([]);
});

describe("RoutePermissionGuard", () => {
  it("the dashboard is open to any authenticated user", () => {
    renderAt("/admin");
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("an unregistered /admin/xyz route is denied (default-deny), not opened by /admin", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderAt("/admin/xyz");
    expect(screen.queryByText("page content")).not.toBeInTheDocument();
    expect(screen.getByText("Page not found")).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("/admin/xyz"));
  });

  it("a registered route needs read on its key", () => {
    renderAt("/admin/users");
    expect(screen.getByText("No permission")).toBeInTheDocument();
    expect(screen.queryByText("page content")).not.toBeInTheDocument();
  });

  it("a user with read on the key gets the page, including sub-pages", () => {
    signedIn([grant("iam.users", ["read"])]);
    renderAt("/admin/users/5");
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("a grant with actions [] is no access", () => {
    signedIn([grant("iam.users", [])]);
    renderAt("/admin/users");
    expect(screen.getByText("No permission")).toBeInTheDocument();
  });

  it("a 403 on the current-user read is the NoPermission state, with no retry button", () => {
    state.query = {
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      error: apiError(403, { code: "FORBIDDEN" }),
      refetch: vi.fn(),
    };
    renderAt("/admin");
    expect(screen.getByText("No permission")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("a server error on the current-user read offers a retry", () => {
    state.query = {
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      error: apiError(500, { code: "INTERNAL_ERROR" }),
      refetch: vi.fn(),
    };
    renderAt("/admin");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("must_change_password renders only the forced dialog", () => {
    signedIn([grant("iam.users", ["read"])], true);
    renderAt("/admin/users");
    expect(screen.getByText("forced-change-password")).toBeInTheDocument();
    expect(screen.queryByText("page content")).not.toBeInTheDocument();
  });
});
