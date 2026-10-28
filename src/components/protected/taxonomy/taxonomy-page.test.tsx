import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaxonomyPage } from "@/components/protected/taxonomy/taxonomy-page";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, roleID: 2, permissions: [] as PermissionGrant[] } }));
const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/blog/categories",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const FULL = grants({ "cms.categories": ["read", "create", "update", "delete", "translate"], "cms.locales": ["read"] });
beforeEach(() => {
  me.current = { id: 6, roleID: 2, permissions: FULL };
  nav.search = "";
  toast.success.mockReset();
  toast.error.mockReset();
});
const cats = () => getMockDb().categories;

describe("TaxonomyPage - categories (SCR-26)", () => {
  useMockApi();

  it("lists the five seeded categories by order with post counts, and links the two kinds", async () => {
    renderApp(<TaxonomyPage kind="categories" />);
    const table = await screen.findByRole("table");
    await within(table).findByText("Music");
    const names = within(table).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(names).toEqual(["Music", "Camping", "Outdoor", "Avenger", "Hiking"]);
    expect(within(within(table).getAllByRole("row")[1]).getAllByRole("cell")[2]).toHaveTextContent("1 (1)");
    expect(screen.getByRole("link", { name: "Tags" })).toHaveAttribute("href", "/admin/blog/tags");
    expect(screen.getByRole("link", { name: "Categories" })).toHaveAttribute("aria-current", "page");
  });

  it("edits a category in a dialog: the ETag comes from the row's own GET, only the changed language is sent, the key can not be edited", async () => {
    const user = userEvent.setup();
    const seen: Array<{ ifMatch: string | null; body: unknown }> = [];
    server.use(http.patch(`${API}/categories/:id`, async ({ request }) => { seen.push({ ifMatch: request.headers.get("If-Match"), body: await request.clone().json() }); return undefined; }));
    const before = cats()[1].updated_at;
    renderApp(<TaxonomyPage kind="categories" />);
    await user.click(await screen.findByRole("button", { name: "Edit Camping" }));
    const dialog = await screen.findByRole("dialog");
    const key = await within(dialog).findByLabelText("Key");
    expect(key).toHaveAttribute("readonly");
    const names = within(dialog).getAllByLabelText(/^Name/);
    await user.clear(names[1]);
    await user.type(names[1], "Camp out");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved. It is live on the website."));
    expect(seen[0].ifMatch).toBe(`"${before}"`);
    expect(seen[0].body).toEqual({ translations: { en: { name: "Camp out", slug: "camping", description: null } } });
    expect(cats()[1].translations.en.name).toBe("Camp out");
  });

  it("creates a category: client checks first, then the server's duplicate-key answer lands on the key field", async () => {
    const user = userEvent.setup();
    renderApp(<TaxonomyPage kind="categories" />);
    await user.click(await screen.findByRole("button", { name: "New category" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await within(dialog).findAllByRole("alert")).not.toHaveLength(0);
    expect(cats()).toHaveLength(5);
    await user.type(within(dialog).getByLabelText("Key"), "music");
    const names = within(dialog).getAllByLabelText(/^Name/);
    await user.type(names[0], "Musique");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect((await within(dialog).findAllByText("This value is already in use.")).length).toBeGreaterThan(0); // the key, and the slug that defaults to it
    expect(within(dialog).getByLabelText("Key")).toHaveAttribute("aria-invalid", "true");
    expect(cats()).toHaveLength(5);
    await user.clear(within(dialog).getByLabelText("Key"));
    await user.type(within(dialog).getByLabelText("Key"), "climbing");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Created."));
    expect(cats().at(-1)).toMatchObject({ key: "climbing", sort_order: 6, is_active: true });
    expect(await screen.findByText("Musique")).toBeInTheDocument();
  });

  it("deleting a category that published posts use explains it and offers to deactivate it instead", async () => {
    const user = userEvent.setup();
    renderApp(<TaxonomyPage kind="categories" />);
    await user.click(await screen.findByRole("button", { name: "Delete Music" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: /"Music" is in use/ });
    expect(within(dialog).getByText(/1 published post uses it/)).toBeInTheDocument();
    expect(within(dialog).getByText("Music night under the stars")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Deactivate instead" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Deactivated."));
    expect(cats()[0].is_active).toBe(false);
    expect(await screen.findByText("Inactive")).toBeInTheDocument();
  });

  it("deleting an unused category moves it to the trash; the trash view lists it and restores it (a clash with a newer item is explained)", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp(<TaxonomyPage kind="categories" />);
    await user.click(await screen.findByRole("button", { name: "Delete Avenger" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Moved to the trash for 30 days."));
    expect(cats()[3].deleted_at).toBeTruthy();
    unmount();
    nav.search = "trashed=true";
    renderApp(<TaxonomyPage kind="categories" />);
    expect(await screen.findByText("Avenger")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    // somebody re-creates the key meanwhile
    getMockDb().categories.push({ ...structuredClone(cats()[0]), id: 77, key: "avenger", translations: { la: { name: "N", slug: "avenger-2" }, en: { name: "N", slug: "avenger-2" } }, deleted_at: null });
    await user.click(screen.getByRole("button", { name: "Restore Avenger" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("It can not be restored: the key is already used by another item."));
    getMockDb().categories.pop();
    await user.click(screen.getByRole("button", { name: "Restore Avenger" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Restored."));
    expect(cats()[3].deleted_at).toBeNull();
  });

  it("order: up / down swap the sort_order of two rows with one PATCH each (no order endpoint)", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(http.patch(`${API}/categories/:id`, async ({ request }) => { bodies.push(await request.clone().json()); return undefined; }));
    renderApp(<TaxonomyPage kind="categories" />);
    await user.click(await screen.findByRole("button", { name: "Move Camping up" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies).toEqual([{ sort_order: 1 }, { sort_order: 2 }]);
    expect(cats().map((c) => [c.key, c.sort_order])).toEqual([["music", 2], ["camping", 1], ["outdoor", 3], ["avenger", 4], ["hiking", 5]]);
    await waitFor(() => expect(within(screen.getByRole("table")).getAllByRole("row")[1]).toHaveTextContent("Camping"));
    expect(screen.getByRole("button", { name: "Move Camping up" })).toBeDisabled();
  });

  it("history inside the dialog restores a version with the row's ETag", async () => {
    const user = userEvent.setup();
    renderApp(<TaxonomyPage kind="categories" />);
    await user.click(await screen.findByRole("button", { name: "Edit Music" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("tab", { name: "History" }));
    await user.click(await within(dialog).findByRole("button", { name: "Restore version 1" }));
    const confirm = await screen.findByRole("dialog", { name: "Restore version 1?" });
    await user.click(within(confirm).getByRole("button", { name: "Restore version 1" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Version restored."));
    expect(cats()[0].translations.la.name).toBe("Musics");
  });

  it("with only `translate`: no create / delete / order, the dialog locks key-adjacent fields, and the PATCH holds translations only", async () => {
    const user = userEvent.setup();
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.categories": ["read", "translate"], "cms.locales": ["read"] }) };
    let body: unknown = null;
    server.use(http.patch(`${API}/categories/:id`, async ({ request }) => { body = await request.clone().json(); return undefined; }));
    renderApp(<TaxonomyPage kind="categories" />);
    await screen.findByText("Music");
    expect(screen.queryByRole("button", { name: "New category" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit Music" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByLabelText("Active")).toBeDisabled();
    const names = within(dialog).getAllByLabelText(/^Name/);
    await user.clear(names[1]);
    await user.type(names[1], "Live music");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({ translations: { en: { name: "Live music", slug: "music", description: null } } });
  });

  it("a stale ETag in the dialog opens the conflict dialog", async () => {
    const user = userEvent.setup();
    renderApp(<TaxonomyPage kind="categories" />);
    await user.click(await screen.findByRole("button", { name: "Edit Outdoor" }));
    const dialog = await screen.findByRole("dialog");
    const names = await within(dialog).findAllByLabelText(/^Name/);
    cats()[2].updated_at = "2026-10-27T06:00:00.000417Z";
    await user.clear(names[1]);
    await user.type(names[1], "Out");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Someone else changed this item")).toBeInTheDocument();
  });
});

describe("TaxonomyPage - tags", () => {
  useMockApi();

  it("lists the tags (the seed has none: these are the invented ones), unused filter hides used ones, key rules are the tag rules", async () => {
    const user = userEvent.setup();
    renderApp(<TaxonomyPage kind="tags" />);
    expect(await screen.findByText("Night sky")).toBeInTheDocument();
    expect(screen.queryByText("Old gear")).not.toBeInTheDocument(); // trashed
    await user.click(screen.getByRole("button", { name: "New tag" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Key"), "9lives");
    await user.type(within(dialog).getAllByLabelText(/^Name/)[0], "Nine lives");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Created."));
    expect(getMockDb().tags.at(-1)).toMatchObject({ key: "9lives" });
  });

  it("deleting a tag a published post uses is refused with the post named", async () => {
    const user = userEvent.setup();
    renderApp(<TaxonomyPage kind="tags" />);
    await user.click(await screen.findByRole("button", { name: "Delete Night sky" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: /"Night sky" is in use/ });
    expect(within(dialog).getByText("Music night under the stars")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Deactivate instead" })).not.toBeInTheDocument();
  });

  it("no permission to read -> the no-permission state", async () => {
    server.use(http.get(`${API}/tags`, () => new Response(JSON.stringify({ success: false, code: "FORBIDDEN", message: "no" }), { status: 403, headers: { "content-type": "application/json" } })));
    renderApp(<TaxonomyPage kind="tags" />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
  });
});
