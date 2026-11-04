import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EntriesList } from "@/components/protected/collections/entries-list";
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
  usePathname: () => "/admin/collections/team",
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const EDITOR = grants({ "cms.collections": ["read", "create", "update", "delete", "publish", "unpublish", "translate"], "cms.locales": ["read"] });
const VIEWER = grants({ "cms.collections": ["read"], "cms.locales": ["read"] });

beforeEach(() => {
  me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: EDITOR };
  nav.search = "";
  nav.push.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
});

const rowOf = async (name: string) => {
  const table = await screen.findByRole("table");
  return (await within(table).findAllByText(name))[0].closest("tr") as HTMLElement;
};

describe("EntriesList (SCR-41)", () => {
  useMockApi();

  it("lists the entries in sort order with title (a link to the editor), address, status chip, languages and the order number", async () => {
    renderApp(<EntriesList collectionKey="team" />);
    const somsak = await rowOf("Somsak");
    expect(within(somsak).getByRole("link", { name: "Somsak" })).toHaveAttribute("href", "/admin/collections/team/1");
    expect(within(somsak).getByText("somsak")).toBeInTheDocument();
    expect(within(somsak).getByTestId("status-badge")).toHaveTextContent("Published");
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual([expect.stringContaining("Somsak"), expect.stringContaining("Noy"), expect.stringContaining("Kham")]);
    expect(within(await rowOf("Kham")).getByTestId("status-badge")).toHaveTextContent("Published, changes pending");
    expect(screen.queryByText("Old member")).not.toBeInTheDocument();
  });

  it("asks the API for the filters that are in the URL (status, language, pending) and the sort", async () => {
    nav.search = "status=draft&locale=en&has_unpublished_changes=true&sort=-title";
    const seen: string[] = [];
    server.use(http.get(`${API}/collections/team/entries`, ({ request }) => { seen.push(new URL(request.url).search); return undefined; }));
    renderApp(<EntriesList collectionKey="team" />);
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    for (const part of ["status=draft", "locale=en", "has_unpublished_changes=true", "sort=-title"]) expect(seen[0]).toContain(part);
  });

  it("a schema change leaves the chip 'Schema changed' on the entries that were not checked again", async () => {
    getMockDb().collections.find((c) => c.key === "team")!.schema_version = 3;
    renderApp(<EntriesList collectionKey="team" />);
    await rowOf("Somsak");
    expect(screen.getAllByTestId("stale-chip")).toHaveLength(3);
  });

  it("the trash view lists the trashed entry and restores it as a draft", async () => {
    const u = userEvent.setup();
    nav.search = "trashed=true";
    renderApp(<EntriesList collectionKey="team" />);
    const old = await rowOf("Old member");
    await u.click(within(old).getByRole("button", { name: "Restore Old member" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Old member restored as a draft."));
    expect(getMockDb().collectionEntries.find((e) => e.id === 4)!.status).toBe("draft");
  });

  it("New entry creates with the title and address of the default language and opens the editor", async () => {
    const u = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(http.post(`${API}/collections/team/entries`, async ({ request }) => { bodies.push(await request.clone().json()); return undefined; }));
    renderApp(<EntriesList collectionKey="team" />);
    await rowOf("Somsak");
    await u.click(screen.getByRole("button", { name: "New entry" }));
    const dialog = await screen.findByRole("dialog", { name: "New entry" });
    await u.type(within(dialog).getByLabelText("Title"), "Dara Phommachan");
    expect(within(dialog).getByLabelText("Address (slug)")).toHaveValue("dara-phommachan");
    await u.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(expect.stringMatching(/^\/admin\/collections\/team\/\d+$/)));
    expect(bodies[0]).toEqual({ translations: { la: { title: "Dara Phommachan", slug: "dara-phommachan" } } });
  });

  it("a taken address is refused with a readable message at the field", async () => {
    const u = userEvent.setup();
    renderApp(<EntriesList collectionKey="team" />);
    await rowOf("Somsak");
    await u.click(screen.getByRole("button", { name: "New entry" }));
    const dialog = await screen.findByRole("dialog", { name: "New entry" });
    await u.type(within(dialog).getByLabelText("Title"), "Somsak");
    await u.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await within(dialog).findByText("Another entry already uses this address.")).toBeInTheDocument();
  });

  it("a viewer sees the rows without New entry, trash or delete; the schema link says View", async () => {
    me.current = { ...me.current, permissions: VIEWER };
    renderApp(<EntriesList collectionKey="team" />);
    await rowOf("Somsak");
    expect(screen.queryByRole("button", { name: "New entry" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Show trash")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View schema" })).toBeInTheDocument();
  });

  it("an editor has no 'Edit schema' wording problem: the link opens the definition read only", async () => {
    renderApp(<EntriesList collectionKey="team" />);
    await rowOf("Somsak");
    expect(screen.getByRole("link", { name: "View schema" })).toHaveAttribute("href", "/admin/collections/team/schema");
  });

  it("a collection that does not exist is a not-found state", async () => {
    renderApp(<EntriesList collectionKey="nope" />);
    expect(await screen.findByText("Collection not found")).toBeInTheDocument();
  });
});
