import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserDetailView } from "@/components/protected/users/user-detail";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "http://localhost:3000/api/v1";

const me = vi.hoisted(() => ({ current: { id: 1, roleID: 1, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/admin/users/7" }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const ROLES = [
  { id: 1, role_key: "super_admin", name: "Super admin", is_system: true, is_super: true, user_count: 1, sort_order: 10 },
  { id: 2, role_key: "editor", name: "Editor", is_system: true, is_super: false, user_count: 3, sort_order: 30 },
  { id: 3, role_key: "author", name: "Author", is_system: true, is_super: false, user_count: 1, sort_order: 40 },
];
const LOCALES = [
  { code: "la", name: "Lao", native_name: "ລາວ", short_label: "LA", flag: null, text_direction: "ltr", is_default: true, is_active: true, fallback_code: null, search_config: "simple", date_formats: null, sort_order: 1, created_at: "", updated_at: "" },
  { code: "en", name: "English", native_name: "English", short_label: "EN", flag: null, text_direction: "ltr", is_default: false, is_active: true, fallback_code: "la", search_config: "english", date_formats: null, sort_order: 2, created_at: "", updated_at: "" },
];
const userOf = (over: Record<string, unknown> = {}) => ({
  id: 7, public_id: "p", username: "ann", email: "ann@example.com", name: "Ann", image: "", role_id: 2, role_key: "editor", role_name: "Editor",
  status: true, state: "active", must_change_password: false, allowed_locales: [], preferred_locale: null, last_login_at: null,
  password_changed_at: null, invited_at: null, accepted_at: null, locked_until: null, created_at: "2026-10-01T00:00:00Z", updated_at: "u1", ...over,
});
const ok = (data: unknown, etag?: string) =>
  HttpResponse.json({ success: true, data }, etag ? { headers: { ETag: etag } } : undefined);

function mockBase(initial = userOf(), etag = '"e1"') {
  server.use(
    http.get(`${API}/users/7`, () => ok(initial, etag)),
    http.get(`${API}/roles`, () => HttpResponse.json({ success: true, data: ROLES, meta: { total: 3, page: 1, limit: 100, total_page: 1 } })),
    http.get(`${API}/locales`, () => ok(LOCALES))
  );
}

beforeEach(() => {
  me.current = {
    id: 1,
    roleID: 1,
    permissions: grants({ "iam.users": ["read", "create", "update", "delete"], "iam.roles": ["read"], "cms.locales": ["read"] }),
  };
  router.push.mockReset();
  toasts.success.mockReset();
  toasts.error.mockReset();
});

const openMenu = async (u: ReturnType<typeof userEvent.setup>) => {
  await u.click(await screen.findByRole("button", { name: "Actions" }));
};

describe("UserDetailView (SCR-08): profile edit with ETag", () => {
  it("PATCHes only what changed, with If-Match, and then uses the new ETag", async () => {
    const u = userEvent.setup();
    mockBase();
    const sent: { ifMatch: string | null; body: unknown }[] = [];
    server.use(
      http.patch(`${API}/users/7`, async ({ request }) => {
        sent.push({ ifMatch: request.headers.get("if-match"), body: await request.json() });
        return ok(userOf({ name: `Ann ${sent.length}`, updated_at: `u${sent.length + 1}` }), `"e${sent.length + 1}"`);
      })
    );
    renderApp(<UserDetailView id="7" />);
    const name = await screen.findByLabelText(/^Full name/);
    expect(screen.getByLabelText("Username")).toBeDisabled();
    await u.clear(name);
    await u.type(name, "Ann 1");
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ ifMatch: '"e1"', body: { name: "Ann 1" } });
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("User updated"));

    const again = await screen.findByLabelText(/^Full name/);
    await waitFor(() => expect(again).toHaveValue("Ann 1"));
    await u.clear(again);
    await u.type(again, "Ann 2");
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].ifMatch).toBe('"e2"');
  });

  it("a lock conflict (409) opens the ConflictDialog; reloading shows the other person's version", async () => {
    const u = userEvent.setup();
    let gets = 0;
    server.use(
      http.get(`${API}/users/7`, () => {
        gets += 1;
        return gets === 1 ? ok(userOf(), '"e1"') : ok(userOf({ name: "Ann by someone else", updated_at: "u9" }), '"e9"');
      }),
      http.get(`${API}/roles`, () => HttpResponse.json({ success: true, data: ROLES, meta: { total: 3, page: 1, limit: 100, total_page: 1 } })),
      http.get(`${API}/locales`, () => ok(LOCALES)),
      http.patch(`${API}/users/7`, () => HttpResponse.json({ success: false, code: "CONFLICT_LOCK_VERSION" }, { status: 409 }))
    );
    renderApp(<UserDetailView id="7" />);
    const name = await screen.findByLabelText(/^Full name/);
    await u.clear(name);
    await u.type(name, "My edit");
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    const dialog = await screen.findByRole("dialog", { name: "Someone else changed this item" });
    await u.click(within(dialog).getByRole("button", { name: "Keep my changes to review" }));
    expect(await within(dialog).findByText("My edit")).toBeInTheDocument();
    await u.click(within(dialog).getByRole("button", { name: "Back" }));
    await u.click(within(dialog).getByRole("button", { name: /Load the latest version/ }));
    await waitFor(() => expect(screen.getByLabelText(/^Full name/)).toHaveValue("Ann by someone else"));
  });

  it("allowed languages and role are editable and sent as a set", async () => {
    const u = userEvent.setup();
    mockBase();
    let body: unknown;
    server.use(http.patch(`${API}/users/7`, async ({ request }) => { body = await request.json(); return ok(userOf(), '"e2"'); }));
    renderApp(<UserDetailView id="7" />);
    await u.click(await screen.findByRole("checkbox", { name: /English/ }));
    await u.click(screen.getByRole("combobox", { name: "Role" }));
    await u.click(await screen.findByRole("option", { name: "Author" }));
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(body).toEqual({ role_id: 3, allowed_locales: ["en"] }));
  });

  it("on your own account the role is fixed and deactivate / delete / reset are hidden", async () => {
    const u = userEvent.setup();
    mockBase(userOf({ id: 7 }));
    me.current = { ...me.current, id: 7 };
    renderApp(<UserDetailView id="7" />);
    expect(await screen.findByRole("combobox", { name: "Role" })).toBeDisabled();
    expect(screen.getByText("You cannot change your own role.")).toBeInTheDocument();
    await openMenu(u);
    expect(screen.queryByRole("menuitem", { name: "Deactivate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Reset password" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Force password change" })).toBeInTheDocument();
  });

  it("a super admin account is locked for someone who is not super", async () => {
    mockBase(userOf({ role_id: 1, role_key: "super_admin", role_name: "Super admin" }));
    me.current = { ...me.current, roleID: 2 };
    renderApp(<UserDetailView id="7" />);
    expect(await screen.findByText(/Only a super administrator can change it/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Full name/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("without cms.locales:read the languages are not requested (a 403 would be audited); the codes are plain text", async () => {
    me.current = { ...me.current, permissions: grants({ "iam.users": ["read", "update"], "iam.roles": ["read"] }) };
    // No /locales handler: an unmocked request fails the test.
    server.use(
      http.get(`${API}/users/7`, () => ok(userOf({ allowed_locales: ["en"] }), '"e1"')),
      http.get(`${API}/roles`, () => HttpResponse.json({ success: true, data: ROLES, meta: { total: 3, page: 1, limit: 100, total_page: 1 } }))
    );
    renderApp(<UserDetailView id="7" />);
    await screen.findByLabelText(/^Full name/);
    expect(screen.getByText("en")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /English/ })).not.toBeInTheDocument();
  });

  it("states: 404 and 403", async () => {
    server.use(http.get(`${API}/users/7`, () => HttpResponse.json({ success: false, code: "NOT_FOUND" }, { status: 404 })));
    const { unmount } = renderApp(<UserDetailView id="7" />);
    expect(await screen.findByText("User not found")).toBeInTheDocument();
    unmount();
    server.use(http.get(`${API}/users/7`, () => HttpResponse.json({ success: false, code: "FORBIDDEN" }, { status: 403 })));
    renderApp(<UserDetailView id="7" />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
  });
});

describe("UserDetailView: commands", () => {
  it("unlock asks first, then POSTs and updates the state", async () => {
    const u = userEvent.setup();
    mockBase(userOf({ state: "locked", locked_until: "2099-01-01T00:00:00Z" }));
    let called = 0;
    server.use(http.post(`${API}/users/7/unlock`, () => { called += 1; return ok(userOf({ updated_at: "u2" }), '"e2"'); }));
    renderApp(<UserDetailView id="7" />);
    await openMenu(u);
    await u.click(await screen.findByRole("menuitem", { name: "Unlock" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(called).toBe(0);
    await u.click(within(confirm).getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(called).toBe(1));
    await waitFor(() => expect(screen.getByText("Active")).toBeInTheDocument());
  });

  it("delete asks first, DELETEs, and goes back to the list", async () => {
    const u = userEvent.setup();
    mockBase();
    let called = 0;
    server.use(http.delete(`${API}/users/7`, () => { called += 1; return ok(null); }));
    renderApp(<UserDetailView id="7" />);
    await openMenu(u);
    await u.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog");
    await u.click(within(confirm).getByRole("button", { name: "Delete user" }));
    await waitFor(() => expect(called).toBe(1));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/admin/users"));
  });

  it("a rejected command (LAST_SUPER_ADMIN) shows the translated reason and keeps the dialog", async () => {
    const u = userEvent.setup();
    mockBase();
    server.use(http.post(`${API}/users/7/deactivate`, () => HttpResponse.json({ success: false, code: "LAST_SUPER_ADMIN" }, { status: 409 })));
    renderApp(<UserDetailView id="7" />);
    await openMenu(u);
    await u.click(await screen.findByRole("menuitem", { name: "Deactivate" }));
    await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining("last active super administrator")));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("reset password with a temporary password shows it once in the secret dialog and never keeps it", async () => {
    const u = userEvent.setup();
    mockBase();
    let sent: { body: unknown; key: string | null } | undefined;
    server.use(
      http.post(`${API}/users/7/reset-password`, async ({ request }) => {
        sent = { body: await request.json(), key: request.headers.get("idempotency-key") };
        return ok({ delivery: "temporary_password", temporary_password: "S3cret-Temp-Pass-123", link_expires_at: null, revoked_sessions: 2 });
      })
    );
    const { queryClient } = renderApp(<UserDetailView id="7" />);
    await openMenu(u);
    await u.click(await screen.findByRole("menuitem", { name: "Reset password" }));
    const dialog = await screen.findByRole("dialog", { name: "Reset the password of Ann" });
    await u.click(within(dialog).getByRole("combobox", { name: "How should the user get the new password?" }));
    await u.click(await screen.findByRole("option", { name: "Show a temporary password once" }));
    await u.click(within(dialog).getByRole("button", { name: "Reset password" }));
    const secret = await screen.findByDisplayValue("S3cret-Temp-Pass-123");
    expect(secret).toHaveAttribute("readonly");
    expect(sent?.body).toEqual({ delivery: "temporary_password" });
    expect(sent?.key).toMatch(/^[0-9a-f-]{36}$/);
    // Not in any query/mutation cache.
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((q) => q.state.data))).not.toContain("S3cret");
    expect(queryClient.getMutationCache().getAll().length).toBe(0);
    await u.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByDisplayValue("S3cret-Temp-Pass-123")).not.toBeInTheDocument();
  });

  it("e-mail reset is unavailable for an account without an e-mail", async () => {
    const u = userEvent.setup();
    mockBase(userOf({ email: null }));
    renderApp(<UserDetailView id="7" />);
    await openMenu(u);
    await u.click(await screen.findByRole("menuitem", { name: "Reset password" }));
    const dialog = await screen.findByRole("dialog", { name: "Reset the password of Ann" });
    expect(within(dialog).getByText(/no email address/)).toBeInTheDocument();
    await u.click(within(dialog).getByRole("combobox", { name: "How should the user get the new password?" }));
    expect(await screen.findByRole("option", { name: "Send a link by email" })).toHaveAttribute("aria-disabled", "true");
  });

  it("an invited user can be sent the invitation again; there is no activate / reset for them", async () => {
    const u = userEvent.setup();
    mockBase(userOf({ state: "invited", status: false, invited_at: "2026-10-26T00:00:00Z" }));
    let called = 0;
    server.use(
      http.post(`${API}/users/7/invitation/resend`, () => { called += 1; return ok({ invitation_expires_at: "2026-10-30T00:00:00Z", email_delivery: "queued" }); })
    );
    renderApp(<UserDetailView id="7" />);
    await openMenu(u);
    expect(screen.queryByRole("menuitem", { name: "Reset password" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Activate" })).not.toBeInTheDocument();
    await u.click(await screen.findByRole("menuitem", { name: "Resend invitation" }));
    await waitFor(() => expect(called).toBe(1));
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith(expect.stringContaining("Invitation sent again")));
  });

  it("an endpoint the backend does not have yet fails through normal error handling", async () => {
    const u = userEvent.setup();
    mockBase();
    server.use(http.post(`${API}/users/7/revoke-sessions`, () => HttpResponse.json({ success: false, code: "NOT_FOUND" }, { status: 404 })));
    renderApp(<UserDetailView id="7" />);
    await openMenu(u);
    await u.click(await screen.findByRole("menuitem", { name: "Sign out of all devices" }));
    await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Sign out everywhere" }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith("The requested resource was not found."));
  });

  it("without iam.users:update the commands that need it are not offered", async () => {
    const u = userEvent.setup();
    me.current = { ...me.current, permissions: grants({ "iam.users": ["read"], "iam.roles": ["read"] }) };
    mockBase();
    renderApp(<UserDetailView id="7" />);
    await screen.findByLabelText(/^Full name/);
    expect(screen.queryByRole("button", { name: "Actions" })).not.toBeInTheDocument();
    void u;
  });
});
