import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RedirectsPage } from "@/components/protected/redirects/redirects-page";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";
import { etagOf } from "@/mocks/mock-core";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, roleID: 2, permissions: [] as PermissionGrant[] } }));
const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/redirects",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const FULL = grants({ "cms.redirects": ["read", "create", "update", "delete", "export"], "cms.locales": ["read"] });
const READ_ONLY = grants({ "cms.redirects": ["read"], "cms.locales": ["read"] });
beforeEach(() => {
  me.current = { id: 6, roleID: 2, permissions: FULL };
  nav.search = "";
  Object.values(toast).forEach((fn) => fn.mockReset());
  URL.createObjectURL = vi.fn(() => "blob:mock") as never;
  URL.revokeObjectURL = vi.fn();
});
const rows = () => getMockDb().redirects;

describe("RedirectsPage (SCR-42)", () => {
  useMockApi();

  it("lists the seeded redirects by source path", async () => {
    renderApp(<RedirectsPage />);
    const table = await screen.findByRole("table");
    await within(table).findByText("/old-blog");
    const first = within(table).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(first).toEqual(["/about", "/gallery-2025", "/legacy", "/old-blog", "/promo", "/team"]);
    expect(within(table).queryByText("/old-team")).toBeNull();
  });

  it("a reader sees the table without any button", async () => {
    me.current = { id: 6, roleID: 2, permissions: READ_ONLY };
    renderApp(<RedirectsPage />);
    await screen.findByText("/old-blog");
    expect(screen.queryByRole("button", { name: "New redirect" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Export CSV" })).toBeNull();
  });

  it("shows live check feedback for a loop, blocks saving, then creates a valid one", async () => {
    const user = userEvent.setup();
    renderApp(<RedirectsPage />);
    await user.click(await screen.findByRole("button", { name: "New redirect" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Old address"), "/our-path");
    await user.type(within(dialog).getByLabelText("New address"), "/about");
    expect(await within(dialog).findByText(/This makes a loop: \/our-path > \/about > \/our-path/, undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();

    const target = within(dialog).getByLabelText("New address");
    await user.clear(target);
    await user.type(target, "/blog");
    await waitFor(() => expect(within(dialog).queryByText(/This makes a loop/)).toBeNull(), { timeout: 3000 });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Create" })).toBeEnabled(), { timeout: 3000 });
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Redirect created."));
    expect(rows().find((r) => r.source_path === "/our-path")?.target).toBe("/blog");
  });

  it("warns when a published page owns the address", async () => {
    const user = userEvent.setup();
    renderApp(<RedirectsPage />);
    await user.click(await screen.findByRole("button", { name: "New redirect" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Old address"), "/");
    await user.type(within(dialog).getByLabelText("New address"), "/blog");
    expect(await within(dialog).findByText(/A published page \("home"\) is at|A published page \(".*"\) is at/, undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeEnabled();
  });

  it("edits with If-Match from the row's own GET and sends only the change", async () => {
    const user = userEvent.setup();
    const seen: Array<{ ifMatch: string | null; body: unknown }> = [];
    server.use(http.patch(`${API}/redirects/:id`, async ({ request }) => { seen.push({ ifMatch: request.headers.get("If-Match"), body: await request.clone().json() }); return undefined; }));
    const before = rows().find((r) => r.source_path === "/about")!.updated_at;
    renderApp(<RedirectsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit /about" }));
    const dialog = await screen.findByRole("dialog");
    const target = await within(dialog).findByLabelText("New address");
    await user.clear(target);
    await user.type(target, "/gallery");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled(), { timeout: 3000 });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved. It is live on the website."));
    expect(seen[0].ifMatch).toBe(etagOf(before));
    expect(seen[0].body).toEqual({ target: "/gallery" });
  });

  it("opens the conflict dialog on a 409", async () => {
    const user = userEvent.setup();
    renderApp(<RedirectsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit /about" }));
    const dialog = await screen.findByRole("dialog");
    const target = await within(dialog).findByLabelText("New address");
    // someone else saves first
    const row = rows().find((r) => r.source_path === "/about")!;
    row.updated_at = "2030-01-01T00:00:00.000000Z";
    await user.clear(target);
    await user.type(target, "/gallery");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled(), { timeout: 3000 });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/changed by someone else|Someone else|newer version/i)).toBeInTheDocument();
  });

  it("moves to the trash after an honest confirmation, then restores from the trash view", async () => {
    const user = userEvent.setup();
    renderApp(<RedirectsPage />);
    await user.click(await screen.findByRole("button", { name: "Delete /promo" }));
    expect(await screen.findByText(/moves to the trash/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Move to trash" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Redirect moved to the trash."));
    expect(rows().find((r) => r.source_path === "/promo")?.deleted_at).toBeTruthy();
  });

  it("restores from the trash view", async () => {
    const user = userEvent.setup();
    nav.search = "trashed=true";
    renderApp(<RedirectsPage />);
    expect(await screen.findByText("/old-team")).toBeInTheDocument();
    expect(screen.queryByText("/old-blog")).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Restore /old-team" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Redirect restored."));
    expect(rows().find((r) => r.source_path === "/old-team")?.deleted_at).toBeNull();
  });

  it("explains EXPORT_TOO_LARGE", async () => {
    const user = userEvent.setup();
    server.use(http.get(`${API}/redirects/export`, () => new Response(JSON.stringify({ success: false, code: "EXPORT_TOO_LARGE", message: "x", details: { matched: 60000, max: 50000 } }), { status: 422, headers: { "Content-Type": "application/json" } })));
    renderApp(<RedirectsPage />);
    await user.click(await screen.findByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("60000")));
  });

  it("exports the CSV", async () => {
    const user = userEvent.setup();
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });
    renderApp(<RedirectsPage />);
    await user.click(await screen.findByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(clicked).toEqual(["redirects-20261101T090000Z.csv"]));
  });

  it("filters by the URL state", async () => {
    nav.search = "status_code=307";
    renderApp(<RedirectsPage />);
    await screen.findByText("/promo");
    expect(screen.queryByText("/old-blog")).toBeNull();
  });
});
