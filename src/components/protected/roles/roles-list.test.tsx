import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RolesList } from "@/components/protected/roles/roles-list";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "http://localhost:3000/api/v1";

const me = vi.hoisted(() => ({ current: { id: 1, roleID: 99, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
const nav = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    usePathname: () => "/admin/roles",
    useRouter: () => ({ push: nav.push, replace: nav.push }),
    useSearchParams: () => React.useMemo(() => new URLSearchParams(nav.search), []),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ROLES = [
  { id: 1, role_key: "super_admin", name: "Super admin", description: "", is_system: true, is_super: true, user_count: 1, sort_order: 10 },
  { id: 2, role_key: "editor", name: "Editor", description: "", is_system: true, is_super: false, user_count: 4, sort_order: 30 },
  { id: 5, role_key: "partner", name: "Partner", description: "", is_system: false, is_super: false, user_count: 0, sort_order: 100 },
];

beforeEach(() => {
  nav.search = "";
  nav.push.mockReset();
  me.current = { id: 1, roleID: 99, permissions: grants({ "iam.roles": ["read", "create"] }) };
});

describe("RolesList (SCR-09)", () => {
  it("lists roles with type badges and user counts that link to the filtered users list", async () => {
    let query: URLSearchParams | undefined;
    server.use(
      http.get(`${API}/roles`, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json({ success: true, data: ROLES, meta: { total: 3, page: 1, limit: 10, total_page: 1 } });
      })
    );
    renderApp(<RolesList />);
    expect(await screen.findByRole("link", { name: "Editor" })).toHaveAttribute("href", "/admin/roles/2");
    expect(screen.getByText("Super")).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Editor: 4 users" })).toHaveAttribute("href", "/admin/users?role_id=2");
    expect(query?.get("sort")).toBe("sort_order");
  });

  it("sorting goes to the URL and only the endpoint's sort fields are sortable", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API}/roles`, () => HttpResponse.json({ success: true, data: ROLES, meta: { total: 3, page: 1, limit: 10, total_page: 1 } }))
    );
    renderApp(<RolesList />);
    await screen.findByRole("link", { name: "Editor" });
    expect(screen.queryByRole("button", { name: "Type" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Users" }));
    expect(nav.push).toHaveBeenCalledWith("/admin/roles?sort=user_count", { scroll: false });
  });

  it("create role: validates the key, copies permissions from a role, sends an Idempotency-Key, goes to the matrix", async () => {
    const user = userEvent.setup();
    let seen: { body: unknown; key: string | null } | null = null;
    server.use(
      http.get(`${API}/roles`, () => HttpResponse.json({ success: true, data: ROLES, meta: { total: 3, page: 1, limit: 100, total_page: 1 } })),
      http.post(`${API}/roles`, async ({ request }) => {
        seen = { body: await request.json(), key: request.headers.get("idempotency-key") };
        return HttpResponse.json(
          { success: true, data: { ...ROLES[2], id: 9, role_key: "content_editor", name: "Content editor", permissions: [] } },
          { status: 201, headers: { ETag: '"r1"' } }
        );
      })
    );
    renderApp(<RolesList />);
    await user.click(await screen.findByRole("button", { name: "Create role" }));
    const dialog = await screen.findByRole("dialog", { name: "Create role" });

    await user.type(within(dialog).getByLabelText(/^Name/), "Content editor");
    await user.type(within(dialog).getByLabelText(/^Role key/), "Bad Key");
    await user.click(within(dialog).getByRole("button", { name: "Create role" }));
    expect(await within(dialog).findByText(/lowercase letters, digits and _/)).toBeInTheDocument();
    expect(seen).toBeNull();

    await user.clear(within(dialog).getByLabelText(/^Role key/));
    await user.type(within(dialog).getByLabelText(/^Role key/), "content_editor");
    await user.click(within(dialog).getByRole("combobox", { name: /Copy permissions from/ }));
    await user.click(await screen.findByRole("option", { name: "Editor" }));
    await user.click(within(dialog).getByRole("button", { name: "Create role" }));

    await waitFor(() => expect(seen).not.toBeNull());
    expect(seen).toMatchObject({
      body: { role_key: "content_editor", name: "Content editor", description: "", sort_order: 100, copy_from_role_id: 2 },
    });
    expect((seen as unknown as { key: string }).key).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/admin/roles/9"));
  });

  it("a duplicate key (409) lands on the role key input", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API}/roles`, () => HttpResponse.json({ success: true, data: ROLES, meta: { total: 3, page: 1, limit: 100, total_page: 1 } })),
      http.post(`${API}/roles`, () =>
        HttpResponse.json(
          { success: false, code: "CONFLICT_DUPLICATE", errors: [{ in: "body", path: "/role_key", code: "duplicate" }] },
          { status: 409 }
        )
      )
    );
    renderApp(<RolesList />);
    await user.click(await screen.findByRole("button", { name: "Create role" }));
    const dialog = await screen.findByRole("dialog", { name: "Create role" });
    await user.type(within(dialog).getByLabelText(/^Name/), "Partner 2");
    await user.type(within(dialog).getByLabelText(/^Role key/), "partner");
    await user.click(within(dialog).getByRole("button", { name: "Create role" }));
    expect(await within(dialog).findByText("This value is already in use.")).toBeInTheDocument();
  });

  it("no create button without iam.roles:create; 403 shows the no-permission state", async () => {
    me.current = { id: 1, roleID: 99, permissions: grants({ "iam.roles": ["read"] }) };
    server.use(http.get(`${API}/roles`, () => HttpResponse.json({ success: false, code: "FORBIDDEN" }, { status: 403 })));
    renderApp(<RolesList />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create role" })).not.toBeInTheDocument();
  });
});
