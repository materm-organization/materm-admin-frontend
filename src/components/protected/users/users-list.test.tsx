import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UsersList } from "@/components/protected/users/users-list";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "http://localhost:3000/api/v1";

const me = vi.hoisted(() => ({ current: { id: 1, roleID: 1, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
const nav = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    usePathname: () => "/admin/users",
    useRouter: () => ({ push: nav.push, replace: nav.push }),
    useSearchParams: () => React.useMemo(() => new URLSearchParams(nav.search), []),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const user = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id, public_id: "x", username: name.toLowerCase(), email: `${name.toLowerCase()}@example.com`, name, image: "",
  role_id: 2, role_key: "editor", role_name: "Editor", status: true, state: "active", must_change_password: false,
  allowed_locales: [], preferred_locale: null, last_login_at: null, password_changed_at: null, invited_at: null,
  accepted_at: null, locked_until: null, created_at: "", updated_at: "", ...over,
});
const ROLES = [
  { id: 1, role_key: "super_admin", name: "Super admin", is_system: true, is_super: true, user_count: 1, sort_order: 10 },
  { id: 2, role_key: "editor", name: "Editor", is_system: true, is_super: false, user_count: 3, sort_order: 30 },
  { id: 3, role_key: "author", name: "Author", is_system: true, is_super: false, user_count: 1, sort_order: 40 },
];

// The filter pills and the column headers share the words "Role" / "Status": the pill is the button outside <th>.
const filterButton = (name: RegExp) =>
  screen.getAllByRole("button", { name }).find((b) => !b.closest("th")) as HTMLElement;
const headerButton = (name: string) => within(screen.getByRole("columnheader", { name })).getByRole("button");

let queries: URLSearchParams[] = [];
beforeEach(() => {
  nav.search = "";
  nav.push.mockReset();
  queries = [];
  me.current = { id: 1, roleID: 1, permissions: grants({ "iam.users": ["read", "create"], "iam.roles": ["read"] }) };
  server.use(
    http.get(`${API}/roles`, () => HttpResponse.json({ success: true, data: ROLES, meta: { total: 3, page: 1, limit: 100, total_page: 1 } })),
    http.get(`${API}/users`, ({ request }) => {
      queries.push(new URL(request.url).searchParams);
      return HttpResponse.json({
        success: true,
        data: [user(7, "Ann"), user(8, "Bob", { state: "locked", role_id: 3, role_name: "Author" })],
        meta: { total: 2, page: 1, limit: 10, total_page: 1 },
      });
    })
  );
});

describe("UsersList (SCR-07): role / state filters and sort live in the URL", () => {
  it("names link to the detail page; the default request sorts by name", async () => {
    renderApp(<UsersList />);
    expect(await screen.findByRole("link", { name: "Ann" })).toHaveAttribute("href", "/admin/users/7");
    expect(queries[0].get("sort")).toBe("name");
    expect(queries[0].has("role_id")).toBe(false);
    expect(queries[0].has("state")).toBe(false);
  });

  it("picking roles writes role_id (comma list) to the URL and resets the page", async () => {
    const u = userEvent.setup();
    renderApp(<UsersList />);
    await screen.findByRole("link", { name: "Ann" });
    await u.click(filterButton(/Role/));
    const list = await screen.findByRole("listbox");
    await u.click(within(list).getByText("Editor"));
    await u.click(within(list).getByText("Author"));
    await u.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/admin/users?role_id=2%2C3", { scroll: false }));
  });

  it("the state filter writes state to the URL", async () => {
    const u = userEvent.setup();
    renderApp(<UsersList />);
    await screen.findByRole("link", { name: "Ann" });
    await u.click(filterButton(/Status/));
    const list = await screen.findByRole("listbox");
    await u.click(within(list).getByText("Locked"));
    await u.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/admin/users?state=locked", { scroll: false }));
  });

  it("the URL is the state: filters and sort from the link go to the API; invalid values are dropped", async () => {
    nav.search = "role_id=2,3&state=locked&sort=-last_login_at&page=2";
    renderApp(<UsersList />);
    await screen.findByRole("link", { name: "Ann" });
    expect(queries[0].get("role_id")).toBe("2,3");
    expect(queries[0].get("state")).toBe("locked");
    expect(queries[0].get("sort")).toBe("-last_login_at");
    expect(queries[0].get("page")).toBe("2");
  });

  it("garbage filter values never reach the API (no 422 from a hand-typed URL)", async () => {
    nav.search = "role_id=abc&state=bogus&sort=password";
    renderApp(<UsersList />);
    await screen.findByRole("link", { name: "Ann" });
    expect(queries[0].has("role_id")).toBe(false);
    expect(queries[0].has("state")).toBe(false);
    expect(queries[0].get("sort")).toBe("name");
  });

  it("sorting by the role column sends the API field `role`", async () => {
    const u = userEvent.setup();
    renderApp(<UsersList />);
    await screen.findByRole("link", { name: "Ann" });
    await u.click(headerButton("Role"));
    expect(nav.push).toHaveBeenCalledWith("/admin/users?sort=role", { scroll: false });
    // Status is not in the sort allow-list: no button.
    expect(within(screen.getByRole("columnheader", { name: "Status" })).queryByRole("button")).not.toBeInTheDocument();
  });

  it("clear filters appears with a filter and the empty state says so", async () => {
    nav.search = "state=disabled";
    server.use(http.get(`${API}/users`, () => HttpResponse.json({ success: true, data: [], meta: { total: 0, page: 1, limit: 10, total_page: 0 } })));
    renderApp(<UsersList />);
    expect(await screen.findByText("No items match your filters")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Clear filters" }).length).toBeGreaterThan(0);
  });
});

describe("UsersList (SCR-07): invite / add buttons", () => {
  it("'Invite user' opens the dialog in invite mode and shows the e-mail delivery result; 'Add user' keeps the temporary-password mode", async () => {
    const u = userEvent.setup();
    server.use(
      http.post(`${API}/users`, () =>
        HttpResponse.json(
          {
            success: true,
            data: {
              user: user(9, "Noy"),
              temporary_password: null,
              invitation_expires_at: "2026-10-30T09:00:00Z",
              email_delivery: "logged_only",
            },
          },
          { status: 201 }
        )
      )
    );
    renderApp(<UsersList />);
    await screen.findByRole("link", { name: "Ann" });

    await u.click(screen.getByRole("button", { name: "Invite user" }));
    let dialog = await screen.findByRole("dialog", { name: "Invite user" });
    expect(within(dialog).queryByLabelText(/^Username/)).not.toBeInTheDocument();
    await u.type(within(dialog).getByLabelText(/^Full name/), "Noy");
    await u.type(within(dialog).getByLabelText(/^E-mail/), "noy@example.com");
    await u.click(within(dialog).getByRole("combobox"));
    await u.click(await screen.findByRole("option", { name: "Editor" }));
    await u.click(within(dialog).getByRole("button", { name: "Send invitation" }));

    const result = await screen.findByRole("dialog", { name: "Invitation created" });
    expect(within(result).getByRole("status")).toHaveTextContent(/printed in the server log/);
    await u.click(within(result).getByRole("button", { name: "Done" }));

    await u.click(screen.getByRole("button", { name: "Add user" }));
    dialog = await screen.findByRole("dialog", { name: "Add user" });
    expect(within(dialog).getByLabelText(/^Username/)).toBeInTheDocument();
  });
});
