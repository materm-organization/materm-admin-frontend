import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FaqList } from "@/components/protected/faq/faq-list";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, name: "Noy Keomany", roleID: 2, permissions: [] as PermissionGrant[] } }));
const nav = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/faq",
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const EDITOR = grants({ "cms.faq": ["read", "create", "update", "delete", "publish", "unpublish", "translate"], "cms.locales": ["read"] });
const READER = grants({ "cms.faq": ["read"], "cms.locales": ["read"] });

beforeEach(() => {
  me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: EDITOR };
  nav.search = "";
  nav.push.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
});

const rowOf = async (name: string) => {
  const table = await screen.findByRole("table");
  const cell = (await within(table).findAllByText(name))[0];
  return cell.closest("tr") as HTMLElement;
};
const openMenu = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  const row = await rowOf(name);
  await user.click(within(row).getByRole("button", { name: `Actions for ${name}` }));
};

describe("FaqList (SCR-30)", () => {
  useMockApi();

  it("lists the groups with the name (a link to the editor), key, status, how many questions are visible and where the group is used; the trash group is not there", async () => {
    renderApp(<FaqList />);
    const table = await screen.findByRole("table");
    await within(table).findByText("Contact questions");
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(3);
    const contact = await rowOf("Contact questions");
    expect(within(contact).getByRole("link", { name: "Contact questions" })).toHaveAttribute("href", "/admin/faq/1");
    expect(within(contact).getByText("contact")).toBeInTheDocument();
    expect(within(contact).getByTestId("status-badge")).toHaveTextContent("Published");
    expect(within(contact).getByText("3 of 4")).toBeInTheDocument(); // one question is hidden
    expect(within(await rowOf("Trips and tours")).getByTestId("status-badge")).toHaveTextContent("Published, changes pending");
  });

  it("a group a FAQ section names can not be deleted: the dialog lists the page and offers no way to go on", async () => {
    const user = userEvent.setup();
    renderApp(<FaqList />);
    await openMenu(user, "Contact questions");
    await user.click(await screen.findByRole("menuitem", { name: "Move to the trash" }));
    await user.click(await screen.findByRole("button", { name: "Move to the trash" }));
    const dialog = await screen.findByTestId("references-blocked-dialog");
    expect(within(dialog).getByText('"Contact questions" cannot be deleted')).toBeInTheDocument();
    expect(within(dialog).getAllByRole("link").length).toBeGreaterThan(0);
    expect(within(dialog).queryByRole("button", { name: /anyway/i })).not.toBeInTheDocument();
    expect(getMockDb().faqGroups.find((g) => g.id === 1)!.deleted_at).toBeNull();
  });

  it("an unused group goes to the trash with If-Match", async () => {
    const user = userEvent.setup();
    const seen: Array<string | null> = [];
    server.use(http.delete(`${API}/faq-groups/2`, ({ request }) => { seen.push(request.headers.get("If-Match")); return undefined; }));
    renderApp(<FaqList />);
    await openMenu(user, "Booking");
    await user.click(await screen.findByRole("menuitem", { name: "Move to the trash" }));
    await user.click(await screen.findByRole("button", { name: "Move to the trash" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('"Booking" is in the trash.'));
    expect(seen).toEqual(['"1"']);
  });

  it("the trash lists the removed groups, Restore brings one back as a draft", async () => {
    const user = userEvent.setup();
    nav.search = "trashed=true";
    renderApp(<FaqList />);
    const row = await rowOf("Old questions");
    await user.click(within(row).getByRole("button", { name: "Restore Old questions" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('"Old questions" was restored as a draft.'));
    expect(getMockDb().faqGroups.find((g) => g.id === 4)).toMatchObject({ status: "draft", deleted_at: null });
  });

  it("New group: the key follows the name, a key already used is said at the field, then the editor opens", async () => {
    const user = userEvent.setup();
    renderApp(<FaqList />);
    await screen.findByRole("table");
    await user.click(screen.getAllByRole("button", { name: "New group" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New FAQ group" });
    await user.type(within(dialog).getByLabelText("Name"), "Gear and packing");
    const key = within(dialog).getByLabelText("Key");
    expect(key).toHaveValue("gear-and-packing");
    await user.clear(key);
    await user.type(key, "contact");
    await user.click(within(dialog).getByRole("button", { name: "Create group" }));
    expect(await within(dialog).findByText("This key is used by another group.")).toBeInTheDocument();
    await user.clear(key);
    await user.type(key, "gear");
    await user.click(within(dialog).getByRole("button", { name: "Create group" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/admin/faq/5"));
    expect(getMockDb().faqGroups.find((g) => g.id === 5)).toMatchObject({ key: "gear", status: "draft" });
  });

  it("a reader sees the list without New group, the trash switch or any row action that changes anything", async () => {
    me.current = { ...me.current, permissions: READER };
    const user = userEvent.setup();
    renderApp(<FaqList />);
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "New group" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Trash" })).not.toBeInTheDocument();
    await openMenu(user, "Booking");
    expect(await screen.findByRole("menuitem", { name: "View" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Move to the trash" })).not.toBeInTheDocument();
  });

  it("a 403 on the list shows the no permission state", async () => {
    server.use(http.get(`${API}/faq-groups`, () => HttpResponse.json({ success: false, code: "FORBIDDEN", message: "no" }, { status: 403 })));
    renderApp(<FaqList />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
  });
});
