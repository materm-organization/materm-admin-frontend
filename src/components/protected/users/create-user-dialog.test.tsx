import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateUserDialog, type CreatedUserResult } from "@/components/protected/users/create-user-dialog";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";

const API = "http://localhost:3000/api/v1";
vi.mock("@/hooks/use-auth", () => ({
  useFetchCurrentUser: () => ({ data: { data: { id: 1, roleID: 1, permissions: grants({ "iam.roles": ["read"] }) } } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/admin/users" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ROLES = [
  { id: 1, role_key: "super_admin", name: "Super admin", is_system: true, is_super: true, user_count: 1, sort_order: 10 },
  { id: 2, role_key: "editor", name: "Editor", is_system: true, is_super: false, user_count: 3, sort_order: 30 },
];
const createdUser = { id: 9, username: "noy@example.com", email: "noy@example.com", name: "Noy" };

type Seen = { headers: Headers; body: Record<string, unknown> };
let seen: Seen[] = [];
let created: CreatedUserResult[] = [];

function Harness({ initial }: { initial: "invite" | "temporary_password" }) {
  const [open, setOpen] = useState(true);
  return (
    <CreateUserDialog open={open} onOpenChange={setOpen} initialDelivery={initial} onCreated={(r) => created.push(r)} />
  );
}

beforeEach(() => {
  seen = [];
  created = [];
  server.use(
    http.get(`${API}/roles`, () =>
      HttpResponse.json({ success: true, data: ROLES, meta: { total: 2, page: 1, limit: 100, total_page: 1 } })
    )
  );
});

const pickRole = async (u: ReturnType<typeof userEvent.setup>) => {
  await u.click(screen.getByRole("combobox"));
  await u.click(await screen.findByRole("option", { name: "Editor" }));
};

describe("CreateUserDialog", () => {
  it("invite mode: e-mail required, no username and no password in the request, reports email_delivery", async () => {
    const u = userEvent.setup();
    server.use(
      http.post(`${API}/users`, async ({ request }) => {
        seen.push({ headers: request.headers, body: (await request.json()) as Record<string, unknown> });
        return HttpResponse.json(
          { success: true, data: { user: createdUser, temporary_password: null, invitation_expires_at: "2026-10-30T09:00:00Z", email_delivery: "logged_only" } },
          { status: 201 }
        );
      })
    );
    renderApp(<Harness initial="invite" />);
    expect(screen.queryByLabelText(/^Username/)).not.toBeInTheDocument();
    await u.type(screen.getByLabelText(/^Full name/), "Noy");
    await pickRole(u);
    await u.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByText("Enter the e-mail address to invite")).toBeInTheDocument();
    expect(seen).toHaveLength(0);

    await u.type(screen.getByLabelText(/^E-mail/), "noy@example.com");
    await u.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].body).toEqual({ name: "Noy", role_id: 2, delivery: "invite", email: "noy@example.com" });
    expect(seen[0].headers.get("idempotency-key")).toBeTruthy();
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ delivery: "invite", temporaryPassword: null, emailDelivery: "logged_only" });
  });

  it("temporary-password mode still sends username and an Idempotency-Key and hands over the one-time password", async () => {
    const u = userEvent.setup();
    server.use(
      http.post(`${API}/users`, async ({ request }) => {
        seen.push({ headers: request.headers, body: (await request.json()) as Record<string, unknown> });
        return HttpResponse.json(
          { success: true, data: { user: { ...createdUser, username: "noy" }, temporary_password: "Tmp-Secret-123456789", invitation_expires_at: null, email_delivery: null } },
          { status: 201 }
        );
      })
    );
    renderApp(<Harness initial="temporary_password" />);
    await u.type(screen.getByLabelText(/^Full name/), "Noy");
    await u.type(screen.getByLabelText(/^Username/), "noy");
    await pickRole(u);
    await u.click(screen.getByRole("button", { name: "Create user" }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].body).toEqual({ name: "Noy", username: "noy", role_id: 2, delivery: "temporary_password" });
    expect(seen[0].headers.get("idempotency-key")).toBeTruthy();
    await waitFor(() => expect(created[0]?.temporaryPassword).toBe("Tmp-Secret-123456789"));
  });

  it("switching the mode starts a NEW Idempotency-Key (a different body must not reuse the old one)", async () => {
    const u = userEvent.setup();
    let attempt = 0;
    server.use(
      http.post(`${API}/users`, async ({ request }) => {
        seen.push({ headers: request.headers, body: (await request.json()) as Record<string, unknown> });
        attempt += 1;
        // First attempt fails with a validation error (so the dialog stays open), second succeeds.
        return attempt === 1
          ? HttpResponse.json(
              { success: false, code: "CONFLICT_DUPLICATE", errors: [{ in: "body", path: "/username", code: "duplicate" }] },
              { status: 409 }
            )
          : HttpResponse.json(
              { success: true, data: { user: createdUser, temporary_password: null, invitation_expires_at: "2026-10-30T09:00:00Z", email_delivery: "queued" } },
              { status: 201 }
            );
      })
    );
    renderApp(<Harness initial="temporary_password" />);
    await u.type(screen.getByLabelText(/^Full name/), "Noy");
    await u.type(screen.getByLabelText(/^Username/), "noy");
    await pickRole(u);
    await u.click(screen.getByRole("button", { name: "Create user" }));
    expect(await screen.findByText("This value is already in use.")).toBeInTheDocument();

    await u.click(within(screen.getByRole("tablist")).getByRole("tab", { name: "Invite by e-mail" }));
    await u.type(screen.getByLabelText(/^E-mail/), "noy@example.com");
    await u.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(seen).toHaveLength(2));
    const [first, second] = seen.map((s) => s.headers.get("idempotency-key"));
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(seen[1].body.delivery).toBe("invite");
    expect(seen[1].body).not.toHaveProperty("username");
  });
});
