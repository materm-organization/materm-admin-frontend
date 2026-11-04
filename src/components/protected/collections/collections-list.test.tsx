import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CollectionsList } from "@/components/protected/collections/collections-list";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, name: "Noy Keomany", roleID: 2, permissions: [] as PermissionGrant[] } }));
const nav = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/collections",
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const ADMIN = grants({ "cms.collections": ["read", "manage_schema", "create", "update", "delete", "publish", "unpublish", "translate"], "cms.locales": ["read"] });
const EDITOR = grants({ "cms.collections": ["read", "create", "update", "delete", "publish", "unpublish", "translate"], "cms.locales": ["read"] });

beforeEach(() => {
  me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: ADMIN };
  nav.search = "";
  nav.push.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
});

const rowOf = async (name: string) => {
  const table = await screen.findByRole("table");
  return (await within(table).findAllByText(name))[0].closest("tr") as HTMLElement;
};

describe("CollectionsList (SCR-40)", () => {
  useMockApi();

  it("lists the definitions with key, entry counts, state and schema version; the trashed one is not there", async () => {
    renderApp(<CollectionsList />);
    const team = await rowOf("Team members");
    expect(within(team).getByRole("link", { name: "Team members" })).toHaveAttribute("href", "/admin/collections/team");
    expect(within(team).getByText("team")).toBeInTheDocument();
    expect(within(team).getByText("3 (2 published)")).toBeInTheDocument();
    expect(within(team).getByText("Active")).toBeInTheDocument();
    expect(within(team).getByText("v1")).toBeInTheDocument();
    expect(screen.queryByText("Archive")).not.toBeInTheDocument();
  });

  it("an administrator sees New collection and the trash switch; an editor sees neither", async () => {
    const view = renderApp(<CollectionsList />);
    await rowOf("Team members");
    expect(screen.getByRole("button", { name: "New collection" })).toBeInTheDocument();
    expect(screen.getByLabelText("Show trash")).toBeInTheDocument();
    view.unmount();
    me.current = { ...me.current, permissions: EDITOR };
    renderApp(<CollectionsList />);
    await rowOf("Team members");
    expect(screen.queryByRole("button", { name: "New collection" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Show trash")).not.toBeInTheDocument();
  });

  it("deleting a collection that has entries explains why (409 ENTITY_REFERENCED collection_has_entries) and offers the entries", async () => {
    const u = userEvent.setup();
    renderApp(<CollectionsList />);
    const team = await rowOf("Team members");
    await u.click(within(team).getByRole("button", { name: "Actions for Team members" }));
    await u.click(await screen.findByRole("menuitem", { name: "Move to trash" }));
    await u.click(await screen.findByRole("button", { name: "Move to trash" }));
    const dialog = await screen.findByRole("alertdialog", { name: "It still has entries" });
    expect(dialog).toHaveTextContent("Team members has 3 entries outside the trash");
  });

  it("an empty collection is moved to the trash and the trash view lists it with a Restore button", async () => {
    const u = userEvent.setup();
    renderApp(<CollectionsList />);
    const events = await rowOf("Events");
    await u.click(within(events).getByRole("button", { name: "Actions for Events" }));
    await u.click(await screen.findByRole("menuitem", { name: "Move to trash" }));
    await u.click(await screen.findByRole("button", { name: "Move to trash" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Events moved to the trash."));
  });

  it("New collection posts the key and name with an EMPTY schema pair and opens the schema editor", async () => {
    const u = userEvent.setup();
    const bodies: Array<Record<string, unknown>> = [];
    server.use(http.post(`${API}/collections`, async ({ request }) => { bodies.push((await request.clone().json()) as Record<string, unknown>); return undefined; }));
    renderApp(<CollectionsList />);
    await rowOf("Team members");
    await u.click(screen.getByRole("button", { name: "New collection" }));
    const dialog = await screen.findByRole("dialog", { name: "New collection" });
    await u.type(within(dialog).getByLabelText("Name"), "Press kit");
    expect(within(dialog).getByLabelText("Key")).toHaveValue("press_kit");
    await u.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/admin/collections/press_kit/schema"));
    expect(bodies[0]).toMatchObject({ key: "press_kit", name: "Press kit", has_slug: true, json_schema: { type: "object", properties: {}, additionalProperties: false } });
  });

  it("a bad or taken key is refused inline", async () => {
    const u = userEvent.setup();
    renderApp(<CollectionsList />);
    await rowOf("Team members");
    await u.click(screen.getByRole("button", { name: "New collection" }));
    const dialog = await screen.findByRole("dialog", { name: "New collection" });
    await u.type(within(dialog).getByLabelText("Name"), "Team");
    await u.clear(within(dialog).getByLabelText("Key"));
    await u.type(within(dialog).getByLabelText("Key"), "Bad_");
    await u.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await within(dialog).findByText(/Lower case letters and digits, single underscores/)).toBeInTheDocument();
    await u.clear(within(dialog).getByLabelText("Key"));
    await u.type(within(dialog).getByLabelText("Key"), "team");
    await u.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await within(dialog).findByText("This key is already used by another collection.")).toBeInTheDocument();
  });
});
