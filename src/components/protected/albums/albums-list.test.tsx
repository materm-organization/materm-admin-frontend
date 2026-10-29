import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AlbumsList } from "@/components/protected/albums/albums-list";
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
  usePathname: () => "/admin/galleries",
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const EDITOR = grants({ "cms.galleries": ["read", "create", "update", "delete", "publish", "unpublish", "translate"], "cms.locales": ["read"] });
const READER = grants({ "cms.galleries": ["read"], "cms.locales": ["read"] });

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
const openMenu = async (user: ReturnType<typeof userEvent.setup>, title: string) => {
  const row = await rowOf(title);
  await user.click(within(row).getByRole("button", { name: `Actions for ${title}` }));
};

describe("AlbumsList (SCR-28)", () => {
  useMockApi();

  it("lists the albums with title (a link to the editor), key, status, number of pictures and where they are used; the trash album is not there", async () => {
    renderApp(<AlbumsList />);
    const table = await screen.findByRole("table");
    await within(table).findByText("Forest photo story");
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(4);
    const forest = await rowOf("Forest photo story");
    expect(within(forest).getByRole("link", { name: "Forest photo story" })).toHaveAttribute("href", "/admin/galleries/1");
    expect(within(forest).getByText("forest-photo-story")).toBeInTheDocument();
    expect(within(forest).getByTestId("status-badge")).toHaveTextContent("Published");
    expect(within(forest).getByText("5")).toBeInTheDocument();
    expect(within(forest).getByText("1 section")).toBeInTheDocument();
    const camp = await rowOf("Camp life (autumn)");
    expect(within(camp).getByTestId("status-badge")).toHaveTextContent("Published, changes pending");
    expect(within(await rowOf("Summit week")).getByText("Not used")).toBeInTheDocument();
  });

  it("an album a section names can not be deleted: the dialog lists the page and offers no way to go on", async () => {
    const user = userEvent.setup();
    renderApp(<AlbumsList />);
    await openMenu(user, "Spring rivers (draft)");
    await user.click(await screen.findByRole("menuitem", { name: "Move to the trash" }));
    await user.click(await screen.findByRole("button", { name: "Move to the trash" }));
    const dialog = await screen.findByTestId("references-blocked-dialog");
    expect(within(dialog).getByText('"Spring rivers (draft)" cannot be deleted')).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /Spring campaign/ })).toHaveAttribute("href", "/admin/pages/6");
    expect(within(dialog).queryByRole("button", { name: /anyway/i })).not.toBeInTheDocument();
    expect(getMockDb().albums.find((a) => a.id === 2)!.deleted_at).toBeNull();
  });

  it("an album nobody uses goes to the trash with If-Match", async () => {
    const user = userEvent.setup();
    const seen: Array<{ method: string; ifMatch: string | null }> = [];
    server.use(http.delete(`${API}/albums/3`, ({ request }) => { seen.push({ method: "DELETE", ifMatch: request.headers.get("If-Match") }); return undefined; }));
    renderApp(<AlbumsList />);
    await openMenu(user, "Summit week");
    await user.click(await screen.findByRole("menuitem", { name: "Move to the trash" }));
    await user.click(await screen.findByRole("button", { name: "Move to the trash" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('"Summit week" is in the trash.'));
    expect(seen).toEqual([{ method: "DELETE", ifMatch: '"1"' }]);
    expect(getMockDb().albums.find((a) => a.id === 3)!.deleted_at).not.toBeNull();
  });

  it("the trash lists the removed albums with the day they go for good, and Restore brings one back as a draft", async () => {
    const user = userEvent.setup();
    const seen: Array<string | null> = [];
    server.use(http.post(`${API}/albums/4/restore`, ({ request }) => { seen.push(request.headers.get("If-Match")); return undefined; }));
    nav.search = "trashed=true";
    renderApp(<AlbumsList />);
    const row = await rowOf("Old trips");
    expect(within(row).getByText(/Removed for good on/)).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Restore Old trips" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('"Old trips" was restored as a draft.'));
    expect(seen).toEqual(['"1"']);
    expect(getMockDb().albums.find((a) => a.id === 4)).toMatchObject({ status: "draft", deleted_at: null });
  });

  it("New album: the key follows the title until typed by hand, a key already used is said at the field, then the editor opens", async () => {
    const user = userEvent.setup();
    renderApp(<AlbumsList />);
    await screen.findByRole("table");
    await user.click(screen.getAllByRole("button", { name: "New album" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New album" });
    await user.type(within(dialog).getByLabelText(/^Title/), "Night sky");
    expect(within(dialog).getByLabelText("Key")).toHaveValue("night-sky");
    const key = within(dialog).getByLabelText("Key");
    await user.clear(key);
    await user.type(key, "summit-week");
    await user.click(within(dialog).getByRole("button", { name: "Create album" }));
    expect(await within(dialog).findByText("This key is used by another album.")).toBeInTheDocument();
    await user.clear(key);
    await user.type(key, "Bad Key");
    await user.click(within(dialog).getByRole("button", { name: "Create album" }));
    expect(await within(dialog).findByText(/Use lower case letters/)).toBeInTheDocument();
    await user.clear(key);
    await user.type(key, "night-sky");
    await user.click(within(dialog).getByRole("button", { name: "Create album" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/admin/galleries/6"));
    expect(getMockDb().albums.find((a) => a.id === 6)).toMatchObject({ key: "night-sky", status: "draft" });
  });

  it("a reader sees the list without New album, the trash switch or any row action that changes anything", async () => {
    me.current = { ...me.current, permissions: READER };
    const user = userEvent.setup();
    renderApp(<AlbumsList />);
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "New album" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Trash" })).not.toBeInTheDocument();
    await openMenu(user, "Summit week");
    expect(await screen.findByRole("menuitem", { name: "View" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Move to the trash" })).not.toBeInTheDocument();
  });

  it("a 403 on the list shows the no permission state", async () => {
    server.use(http.get(`${API}/albums`, () => HttpResponse.json({ success: false, code: "FORBIDDEN", message: "no" }, { status: 403 })));
    renderApp(<AlbumsList />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
  });
});
