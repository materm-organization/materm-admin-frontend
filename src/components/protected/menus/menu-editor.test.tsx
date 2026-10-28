import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MenuEditor } from "@/components/protected/menus/menu-editor";
import { MenusList } from "@/components/protected/menus/menus-list";
import { getMockDb } from "@/mocks/mock-db";
import { getMenu } from "@/mocks/mock-menus";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, roleID: 2, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/menus/main",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const FULL = grants({ "cms.menus": ["read", "create", "update", "delete", "translate"], "cms.locales": ["read"], "cms.pages": ["read"] });
beforeEach(() => {
  me.current = { id: 6, roleID: 2, permissions: FULL };
  toast.success.mockReset();
  toast.error.mockReset();
});
const items = (key = "main") => getMenu(getMockDb(), key).menu.items;
const etag = (key = "main") => getMenu(getMockDb(), key).etag!;

describe("MenusList (SCR-17)", () => {
  useMockApi();
  it("shows the three system menus with their counts and links, and no create / delete button", async () => {
    renderApp(<MenusList />);
    const main = await screen.findByRole("link", { name: /Main navigation/ });
    expect(main).toHaveAttribute("href", "/admin/menus/main");
    expect(within(main).getByText("5 items")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Footer navigation/ })).toHaveAttribute("href", "/admin/menus/footer");
    expect(within(screen.getByRole("link", { name: /Social links/ })).getByText("4 items")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("MenuEditor (SCR-18)", () => {
  useMockApi();

  it("lists the flat items in order with their destination; the first one is selected and shows its form", async () => {
    renderApp(<MenuEditor menuKey="main" />);
    expect(await screen.findByRole("heading", { name: "Main navigation" })).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Reorderable list" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => within(r).getAllByRole("button")[3].textContent)).toEqual([
      expect.stringContaining("Home"), expect.stringContaining("Our Path"), expect.stringContaining("The Blog"), expect.stringContaining("Gallery"), expect.stringContaining("Contact"),
    ]);
    expect(screen.getByLabelText(/^Label \(LO\)/)).toHaveValue("Home");
    expect(screen.getByRole("radio", { name: "A page" })).toBeChecked();
  });

  it("edits the label of another language: only that change is sent, with the menu's ETag; the new ETag is used by the next edit", async () => {
    const user = userEvent.setup();
    const sent: Array<{ ifMatch: string | null; body: unknown }> = [];
    server.use(
      http.patch(`${API}/menus/main/items/:id`, async ({ request }) => {
        sent.push({ ifMatch: request.headers.get("If-Match"), body: await request.clone().json() });
        return undefined;
      })
    );
    const first = etag();
    renderApp(<MenuEditor menuKey="main" />);
    await screen.findByLabelText(/^Label \(LO\)/);
    await user.click(screen.getByRole("radio", { name: /^English/ }));
    const label = screen.getByLabelText(/^Label \(EN\)/);
    await user.clear(label);
    await user.type(label, "Start");
    await user.click(screen.getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Item saved. It is live on the website."));
    expect(sent[0]).toEqual({ ifMatch: first, body: { translations: { en: { label: "Start", aria_label: null } } } });
    expect(items()[0].translations.en.label).toBe("Start");
    // second edit goes out with the NEW ETag, no refetch needed
    const afterFirst = etag();
    await user.click(screen.getByRole("switch", { name: "Visible on the website" }));
    await user.click(screen.getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].ifMatch).toBe(afterFirst);
    expect(afterFirst).not.toBe(first);
    expect(await screen.findByText("Hidden")).toBeInTheDocument();
  });

  it("validation: an empty default-language label and a bad url are shown at their fields and nothing is sent", async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(http.patch(`${API}/menus/main/items/:id`, () => { calls += 1; return undefined; }));
    renderApp(<MenuEditor menuKey="main" />);
    const label = await screen.findByLabelText(/^Label \(LO\)/);
    await user.clear(label);
    await user.click(screen.getByRole("radio", { name: "An address" }));
    await user.type(screen.getByLabelText("Address"), "http://insecure.example");
    await user.click(screen.getByRole("button", { name: "Save item" }));
    expect(await screen.findAllByRole("alert")).toHaveLength(2);
    expect(screen.getByText("This field is required.")).toBeInTheDocument();
    expect(screen.getByText("The value does not match the required pattern.")).toBeInTheDocument();
    expect(calls).toBe(0);
  });

  it("adds an item at the end (Idempotency-Key, If-Match), selects it, and warns that a draft page is hidden on the website", async () => {
    const user = userEvent.setup();
    let seen: { ifMatch: string | null; key: string | null; body: Record<string, unknown> } | null = null;
    server.use(
      http.post(`${API}/menus/main/items`, async ({ request }) => {
        seen = { ifMatch: request.headers.get("If-Match"), key: request.headers.get("Idempotency-Key"), body: (await request.clone().json()) as never };
        return undefined;
      })
    );
    renderApp(<MenuEditor menuKey="main" />);
    await screen.findByLabelText(/^Label \(LO\)/);
    await user.click(screen.getByRole("button", { name: "Add item" }));
    expect(await screen.findByRole("heading", { name: "New item" })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Label \(LO\)/), "Spring");
    await user.click(screen.getByRole("combobox", { name: "Page" }));
    await user.click(await screen.findByRole("option", { name: /Spring campaign/ }));
    expect(screen.getByText(/This page is not published/)).toBeInTheDocument();
    await user.click(document.querySelector("form button[type=submit]") as HTMLElement);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Item added."));
    expect(seen!.ifMatch).toBeTruthy();
    expect(seen!.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen!.body).toMatchObject({ link: { type: "page", page_id: 6 }, translations: { la: { label: "Spring" } }, active_match: "prefix", is_visible: true });
    expect(items()).toHaveLength(6);
    expect(await screen.findByRole("heading", { name: "Edit item" })).toBeInTheDocument();
    expect(screen.getByText("Page not published")).toBeInTheDocument();
  });

  it("more than 7 items in the main menu: a warning, not a block", async () => {
    getMockDb().menus[0].items.push(
      ...[1, 2, 3].map((n) => ({ ...structuredClone(getMockDb().menus[0].items[0]), id: 100 + n, public_id: `p${n}`, sort_order: 4 + n }))
    );
    renderApp(<MenuEditor menuKey="main" />);
    expect(await screen.findByTestId("menu-too-many")).toHaveTextContent("8 items");
    expect(screen.getByRole("button", { name: "Add item" })).toBeEnabled();
  });

  it("reorders locally with the up / down buttons and sends the whole order once with 'Save order'", async () => {
    const user = userEvent.setup();
    let body: unknown = null;
    server.use(http.put(`${API}/menus/main/items/order`, async ({ request }) => { body = await request.clone().json(); return undefined; }));
    renderApp(<MenuEditor menuKey="main" />);
    await screen.findByLabelText(/^Label \(LO\)/);
    await user.click(screen.getByRole("button", { name: "Move Home down" }));
    await user.click(screen.getByRole("button", { name: "Move Contact up" }));
    expect(body).toBeNull(); // nothing sent while moving
    expect(items().map((i) => i.id)).toEqual([1, 2, 3, 4, 5]);
    await user.click(screen.getByRole("button", { name: "Save order" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Order saved."));
    expect(body).toEqual({ items: [2, 1, 3, 5, 4].map((id) => ({ id, parent_id: null })) });
    expect(items().map((i) => i.id)).toEqual([2, 1, 3, 5, 4]);
    expect(screen.queryByRole("button", { name: "Save order" })).not.toBeInTheDocument();
  });

  it("'Discard order' puts the list back", async () => {
    const user = userEvent.setup();
    renderApp(<MenuEditor menuKey="main" />);
    await screen.findByLabelText(/^Label \(LO\)/);
    await user.click(screen.getByRole("button", { name: "Move Home down" }));
    await user.click(screen.getByRole("button", { name: "Discard order" }));
    expect(screen.queryByRole("button", { name: "Save order" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move Home down" })).toBeEnabled();
  });

  it("deletes after a confirmation and shows the toast; the item is gone", async () => {
    const user = userEvent.setup();
    renderApp(<MenuEditor menuKey="main" />);
    await screen.findByLabelText(/^Label \(LO\)/);
    await user.click(screen.getByRole("button", { name: "Delete Gallery" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Item deleted."));
    expect(items().map((i) => i.id)).toEqual([1, 2, 3, 5]);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Delete Gallery" })).not.toBeInTheDocument());
  });

  it("a stale ETag opens the conflict dialog; 'Load the latest version' shows what the other editor did", async () => {
    const user = userEvent.setup();
    renderApp(<MenuEditor menuKey="main" />);
    const label = await screen.findByLabelText(/^Label \(LO\)/);
    getMockDb().menus[0].updated_at = "2026-10-27T05:00:00.000417Z"; // someone else wrote
    getMockDb().menus[0].items[1].translations.la.label = "Their label";
    await user.clear(label);
    await user.type(label, "Mine");
    await user.click(screen.getByRole("button", { name: "Save item" }));
    const dialog = await screen.findByRole("dialog", { name: /Someone else changed/ });
    await user.click(within(dialog).getByRole("button", { name: /Load the latest version/ }));
    expect(await screen.findByText("Their label")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Label \(LO\)/)).toHaveValue("Home");
  });

  it("social menu: icons come from the registry, the url must be https, the icon is required", async () => {
    const user = userEvent.setup();
    renderApp(<MenuEditor menuKey="social" />);
    await screen.findByRole("heading", { name: "Social links" });
    expect(screen.queryByRole("radio", { name: "A page" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add item" }));
    await user.type(await screen.findByLabelText(/^Label \(LO\)/), "Mastodon");
    await user.type(screen.getByLabelText("Address"), "/not-https");
    const submit = document.querySelector("form button[type=submit]") as HTMLElement;
    await user.click(submit);
    expect((await screen.findAllByRole("alert")).length).toBe(2);
    await user.clear(screen.getByLabelText("Address"));
    await user.type(screen.getByLabelText("Address"), "https://mastodon.example/@m");
    await user.click(screen.getByRole("combobox", { name: "Icon" }));
    expect(await screen.findAllByRole("option")).toHaveLength(4);
    await user.click(screen.getByRole("option", { name: "facebook" }));
    await user.click(submit);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Item added."));
    expect(items("social")).toHaveLength(5);
    expect(items("social")[4]).toMatchObject({ icon: "facebook", link: { url: "https://mastodon.example/@m" } });
  });

  it("with only `translate`: labels are editable, the rest is locked, there is no add / delete / drag, and the PATCH carries only translations", async () => {
    const user = userEvent.setup();
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.menus": ["read", "translate"], "cms.locales": ["read"] }) };
    let body: unknown = null;
    server.use(http.patch(`${API}/menus/main/items/:id`, async ({ request }) => { body = await request.clone().json(); return undefined; }));
    renderApp(<MenuEditor menuKey="main" />);
    expect(await screen.findByText("Translation mode")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add item" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Visible on the website" })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /^English/ }));
    const label = screen.getByLabelText(/^Label \(EN\)/);
    await user.clear(label);
    await user.type(label, "Begin");
    await user.click(screen.getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({ translations: { en: { label: "Begin", aria_label: null } } });
  });

  it("read-only: no mutation controls at all, fields disabled", async () => {
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.menus": ["read"], "cms.locales": ["read"] }) };
    renderApp(<MenuEditor menuKey="main" />);
    expect(await screen.findByText("Read only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add item" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save item" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete / })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Label \(LO\)/)).toBeDisabled();
  });

  it("unknown menu -> not found state", async () => {
    renderApp(<MenuEditor menuKey="nope" />);
    expect(await screen.findByText("Menu not found")).toBeInTheDocument();
  });

  it("history tab: restoring the version before a delete brings the item back (If-Match = the menu ETag) and returns to the items", async () => {
    const user = userEvent.setup();
    renderApp(<MenuEditor menuKey="main" />);
    await screen.findByLabelText(/^Label \(LO\)/);
    await user.click(screen.getByRole("button", { name: "Delete Gallery" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(items()).toHaveLength(4));
    await user.click(screen.getByRole("tab", { name: "History" }));
    const latest = getMockDb().revisions["menus/main"].at(-1)!;
    await user.click(await screen.findByRole("button", { name: `Restore version ${latest.version}` }));
    const confirm = await screen.findByRole("dialog", { name: `Restore version ${latest.version}?` });
    await user.click(within(confirm).getByRole("button", { name: `Restore version ${latest.version}` }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Version restored. It is live on the website."));
    expect(items()).toHaveLength(5);
    expect(await screen.findByRole("tab", { name: "Items", selected: true })).toBeInTheDocument();
    expect(await screen.findByRole("list", { name: "Reorderable list" })).toBeInTheDocument();
  });
});
