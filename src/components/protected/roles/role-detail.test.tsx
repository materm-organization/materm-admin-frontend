import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RoleDetailView } from "@/components/protected/roles/role-detail";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";
import type { RoleDetail, RolePermission } from "@/types/iam";

const API = "http://localhost:3000/api/v1";

const me = vi.hoisted(() => ({ current: { id: 1, roleID: 99, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/admin/roles/3" }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const ACTIONS = ["read", "create", "update", "update_own", "delete", "delete_own", "publish", "unpublish", "schedule", "review", "translate", "export", "import", "manage_schema", "execute"];
const perm = (id: number, key: string, name: string, category: string, available: string[], actions: string[] = []): RolePermission => ({
  permission_id: id, permission_key: key, name, description: "", category, available_actions: available, actions,
});
const role = (over: Partial<RoleDetail> = {}, actions: Record<string, string[]> = {}): RoleDetail => ({
  id: 3, public_id: "x", role_key: "editor", name: "Editor", description: "Edits content", is_system: false, is_super: false,
  user_count: 2, sort_order: 30, created_at: "", updated_at: "2026-10-27T01:00:00Z",
  permissions: [
    perm(1, "cms.pages", "Pages", "content", ["read", "create", "update", "delete", "publish"], actions["cms.pages"] ?? ["read"]),
    perm(2, "cms.blog", "Blog posts", "content", ["read", "create", "update", "update_own"], actions["cms.blog"] ?? []),
    perm(3, "iam.users", "Users", "iam", ["read", "create", "update", "delete"], actions["iam.users"] ?? []),
  ],
  ...over,
});

const ok = (data: unknown, etag?: string) =>
  HttpResponse.json({ success: true, data }, etag ? { headers: { ETag: etag } } : undefined);

function mockRole(initial: RoleDetail, etag = '"v1"') {
  server.use(
    http.get(`${API}/roles/3`, () => ok(initial, etag)),
    http.get(`${API}/permissions`, () => ok({ permissions: [], actions: ACTIONS.map((action) => ({ action, description: `${action} meaning` })) })),
    http.get(`${API}/roles`, () =>
      HttpResponse.json({ success: true, data: [{ id: 3, name: "Editor" }, { id: 4, name: "Author" }], meta: { total: 2, page: 1, limit: 100, total_page: 1 } })
    )
  );
}

beforeEach(() => {
  me.current = {
    id: 1,
    roleID: 99,
    permissions: grants({ "iam.roles": ["read", "create", "update", "delete"], "iam.users": ["read"] }),
  };
  router.push.mockReset();
  toasts.success.mockReset();
  toasts.error.mockReset();
});

async function tickBlogCreate(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("heading", { name: "Editor" });
  await user.click(screen.getByRole("checkbox", { name: "Blog posts: Read" }));
  await user.click(screen.getByRole("checkbox", { name: "Blog posts: Create" }));
}

describe("RoleDetailView: the permission matrix of SCR-10", () => {
  it("shows a diff summary, then PUTs the whole matrix with the mandatory If-Match", async () => {
    const user = userEvent.setup();
    mockRole(role());
    let seen: { ifMatch: string | null; body: unknown } | null = null;
    server.use(
      http.put(`${API}/roles/3/permissions`, async ({ request }) => {
        seen = { ifMatch: request.headers.get("if-match"), body: await request.json() };
        return ok(
          {
            role: role({ updated_at: "2026-10-27T02:00:00Z" }, { "cms.pages": ["read"], "cms.blog": ["read", "create"] }),
            changes: [{ permission_key: "cms.blog", before: [], after: ["read", "create"] }],
            affected_users: 2,
          },
          '"v2"'
        );
      })
    );
    renderApp(<RoleDetailView id="3" />);

    expect(await screen.findByText("No unsaved changes")).toBeInTheDocument();
    await tickBlogCreate(user);
    expect(screen.getByTestId("diff-summary")).toHaveTextContent("2 added, 0 removed, in 1 feature");

    await user.click(screen.getByRole("button", { name: "Review and save" }));
    const dialog = await screen.findByRole("dialog", { name: "Save these permission changes?" });
    expect(within(dialog).getByText("Blog posts")).toBeInTheDocument();
    expect(within(dialog).getByText(/\+ Create/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Confirm and save" }));

    await waitFor(() => expect(seen).not.toBeNull());
    expect(seen).toEqual({
      ifMatch: '"v1"',
      body: { grants: [{ permission_key: "cms.pages", actions: ["read"] }, { permission_key: "cms.blog", actions: ["read", "create"] }] },
    });
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith(expect.stringContaining("2 users are affected")));
    // The new ETag from the answer is the one the next save sends.
    expect(await screen.findByText("No unsaved changes")).toBeInTheDocument();
  });

  it("sends the NEW ETag on the second save", async () => {
    const user = userEvent.setup();
    mockRole(role());
    const sent: (string | null)[] = [];
    server.use(
      http.put(`${API}/roles/3/permissions`, ({ request }) => {
        sent.push(request.headers.get("if-match"));
        const n = sent.length;
        return ok({ role: role({ updated_at: `t${n}` }), changes: [], affected_users: 0 }, `"v${n + 1}"`);
      })
    );
    renderApp(<RoleDetailView id="3" />);
    await tickBlogCreate(user);
    await user.click(screen.getByRole("button", { name: "Review and save" }));
    await user.click(await screen.findByRole("button", { name: "Confirm and save" }));
    await waitFor(() => expect(sent).toEqual(['"v1"']));
    await screen.findByText("No unsaved changes");
    await user.click(screen.getByRole("checkbox", { name: "Users: Read" }));
    await user.click(screen.getByRole("button", { name: "Review and save" }));
    await user.click(await screen.findByRole("button", { name: "Confirm and save" }));
    await waitFor(() => expect(sent).toEqual(['"v1"', '"v2"']));
  });

  it.each([
    ["409 CONFLICT_LOCK_VERSION", 409, { code: "CONFLICT_LOCK_VERSION" }],
    ["412", 412, {}],
  ])("%s opens the ConflictDialog; reloading drops my edits and loads the latest matrix", async (_name, status, body) => {
    const user = userEvent.setup();
    let gets = 0;
    server.use(
      http.get(`${API}/roles/3`, () => {
        gets += 1;
        // The second read is what the other editor saved: users now can read.
        return gets === 1 ? ok(role(), '"v1"') : ok(role({ updated_at: "later" }, { "iam.users": ["read"] }), '"v7"');
      }),
      http.get(`${API}/permissions`, () => ok({ permissions: [], actions: ACTIONS.map((action) => ({ action, description: "" })) })),
      http.get(`${API}/roles`, () => HttpResponse.json({ success: true, data: [], meta: { total: 0, page: 1, limit: 100, total_page: 1 } })),
      http.put(`${API}/roles/3/permissions`, () => HttpResponse.json({ success: false, message: "stale", ...body }, { status }))
    );
    renderApp(<RoleDetailView id="3" />);
    await tickBlogCreate(user);
    await user.click(screen.getByRole("button", { name: "Review and save" }));
    await user.click(await screen.findByRole("button", { name: "Confirm and save" }));

    const conflict = await screen.findByRole("dialog", { name: "Someone else changed this item" });
    // "Keep my changes" lists what I ticked so it can be copied.
    await user.click(within(conflict).getByRole("button", { name: "Keep my changes to review" }));
    expect(await within(conflict).findByText("Blog posts")).toBeInTheDocument();
    await user.click(within(conflict).getByRole("button", { name: "Back" }));

    await user.click(within(conflict).getByRole("button", { name: /Load the latest version/ }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Users: Read" })).toBeChecked());
    expect(screen.getByRole("checkbox", { name: "Blog posts: Create" })).not.toBeChecked();
    expect(screen.getByText("No unsaved changes")).toBeInTheDocument();
    expect(gets).toBe(2);
  });

  it("leaving with unsaved matrix changes asks first (unsaved-changes guard)", async () => {
    const user = userEvent.setup();
    mockRole(role());
    renderApp(<RoleDetailView id="3" />);
    await screen.findByRole("heading", { name: "Editor" });
    // Dirty: a click on a link out of the page is intercepted.
    await user.click(screen.getByRole("checkbox", { name: "Blog posts: Read" }));
    await user.click(screen.getByRole("link", { name: /2 users/ }));
    expect(await screen.findByText("Discard unsaved changes?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save and leave" })).toBeInTheDocument();
  });

  it("maps a 422 `/grants/{n}/actions` back to the row of the grant that was sent", async () => {
    const user = userEvent.setup();
    mockRole(role());
    server.use(
      http.put(`${API}/roles/3/permissions`, () =>
        HttpResponse.json(
          {
            success: false,
            code: "VALIDATION_FAILED",
            errors: [{ in: "body", path: "/grants/1/actions/1", code: "action_not_available", params: { action: "create", available: ["read"] } }],
          },
          { status: 422 }
        )
      )
    );
    renderApp(<RoleDetailView id="3" />);
    await tickBlogCreate(user);
    await user.click(screen.getByRole("button", { name: "Review and save" }));
    await user.click(await screen.findByRole("button", { name: "Confirm and save" }));
    // grants = [cms.pages, cms.blog]: index 1 is the blog row.
    expect(await screen.findByText("Blog posts: This action is not available.")).toBeInTheDocument();
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("the super role is locked: read-only matrix, lock explanation, no save bar, no edit/delete", async () => {
    mockRole(role({ id: 3, role_key: "super_admin", name: "Super admin", is_super: true, is_system: true }));
    renderApp(<RoleDetailView id="3" />);
    expect(await screen.findByText("Super administrator: always full access")).toBeInTheDocument();
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Review and save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete role" })).not.toBeInTheDocument();
  });

  it("every system role is read-only with a lock and an explanation: no matrix edits, no rename, no delete", async () => {
    mockRole(role({ role_key: "admin", name: "Admin", is_system: true }));
    renderApp(<RoleDetailView id="3" />);
    expect(await screen.findByText("System role")).toBeInTheDocument();
    expect(screen.getByText(/A built-in role, locked/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Pages: Create" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Full access to Pages" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Review and save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete role" })).not.toBeInTheDocument();
    // No presets either (they would edit the draft).
    expect(screen.queryByRole("combobox", { name: "Copy from another role..." })).not.toBeInTheDocument();
  });

  it("without iam.roles:update the matrix is read-only", async () => {
    me.current = { id: 1, roleID: 99, permissions: grants({ "iam.roles": ["read"] }) };
    mockRole(role());
    renderApp(<RoleDetailView id="3" />);
    expect(await screen.findByText(/you need the update permission/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Pages: Read" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Delete role" })).not.toBeInTheDocument();
  });

  it("copy from another role fills the draft from that role's grants (not saved yet)", async () => {
    const user = userEvent.setup();
    mockRole(role());
    server.use(
      http.get(`${API}/roles/4`, () =>
        ok(role({ id: 4, role_key: "author", name: "Author" }, { "iam.users": ["read", "update"], "cms.pages": [] }), '"a1"')
      )
    );
    renderApp(<RoleDetailView id="3" />);
    await screen.findByRole("heading", { name: "Editor" });
    await user.click(screen.getByRole("combobox", { name: "Copy from another role..." }));
    await user.click(await screen.findByRole("option", { name: "Author" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Users: Edit" })).toBeChecked());
    expect(screen.getByRole("checkbox", { name: "Pages: Read" })).not.toBeChecked();
    expect(screen.getByTestId("diff-summary")).toHaveTextContent("2 added, 1 removed");
  });

  it("delete asks for the role key; ROLE_IN_USE explains and links to the users", async () => {
    const user = userEvent.setup();
    mockRole(role());
    server.use(
      http.delete(`${API}/roles/3`, () =>
        HttpResponse.json({ success: false, code: "ROLE_IN_USE", details: { user_count: 2 } }, { status: 409 })
      )
    );
    renderApp(<RoleDetailView id="3" />);
    await screen.findByRole("heading", { name: "Editor" });
    await user.click(screen.getByRole("button", { name: "Delete role" }));
    const confirm = await screen.findByRole("alertdialog");
    const button = within(confirm).getByRole("button", { name: "Delete role" });
    expect(button).toBeDisabled();
    await user.type(within(confirm).getByRole("textbox"), "editor");
    await user.click(button);
    const inUse = await screen.findByRole("dialog", { name: "This role is still in use" });
    expect(within(inUse).getByText(/2 users still have/)).toBeInTheDocument();
    expect(within(inUse).getByRole("link", { name: "View these users" })).toHaveAttribute("href", "/admin/users?role_id=3");
  });

  it("states: 404 not found, 403 no permission", async () => {
    server.use(http.get(`${API}/roles/3`, () => HttpResponse.json({ success: false, code: "NOT_FOUND" }, { status: 404 })));
    const { unmount } = renderApp(<RoleDetailView id="3" />);
    expect(await screen.findByText("Role not found")).toBeInTheDocument();
    unmount();

    server.use(http.get(`${API}/roles/3`, () => HttpResponse.json({ success: false, code: "FORBIDDEN" }, { status: 403 })));
    renderApp(<RoleDetailView id="3" />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
  });
});
