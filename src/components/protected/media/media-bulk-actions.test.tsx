import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MediaLibrary } from "@/components/protected/media/media-library";
import { bulkCalls, setBulkDenied } from "@/mocks/mock-media-bulk";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, roleID: 2, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
const nav = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    usePathname: () => "/admin/media",
    useRouter: () => ({ push: nav.push, replace: nav.push }),
    useSearchParams: () => React.useMemo(() => new URLSearchParams(nav.search), []),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const FULL = grants({ "media.library": ["read", "create", "update", "delete", "translate"], "cms.locales": ["read"] });
const asset = (id: number) => getMockDb().assets.find((a) => a.id === id)!;
const BAR = "Actions for the selected rows";

beforeEach(() => {
  nav.search = "";
  nav.push.mockReset();
  window.localStorage.clear();
  me.current = { id: 6, roleID: 2, permissions: FULL };
  bulkCalls.length = 0;
  setBulkDenied(false);
});

async function openWith(names: string[]) {
  const user = userEvent.setup();
  renderApp(<MediaLibrary />);
  await screen.findByRole("button", { name: "Open hero-bg.png" });
  for (const name of names) await user.click(screen.getByRole("checkbox", { name: `Select ${name}` }));
  return { user, bar: () => screen.getByRole("region", { name: BAR }) };
}

describe("MediaLibrary bulk actions (FR-MEDIA-11)", () => {
  useMockApi();

  it("select all on this page counts the page, clear forgets it", async () => {
    const { user } = await openWith([]);
    await user.click(screen.getByRole("checkbox", { name: "Select all files on this page" }));
    const bar = screen.getByRole("region", { name: BAR });
    expect(within(bar).getByText("20 selected")).toBeInTheDocument();
    await user.click(within(bar).getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("region", { name: BAR })).not.toBeInTheDocument();
  });

  it("works in the list view too (header checkbox)", async () => {
    const user = userEvent.setup();
    renderApp(<MediaLibrary />);
    await screen.findByText("hero-bg.png");
    await user.click(screen.getByRole("radio", { name: "List view" }));
    await user.click(await screen.findByRole("checkbox", { name: "Select all rows on this page" }));
    expect(screen.getByRole("region", { name: BAR })).toHaveTextContent("20 selected");
    expect(within(screen.getByRole("region", { name: BAR })).getByRole("button", { name: "Move to folder" })).toBeInTheDocument();
  });

  it("moves the selection to a folder with each row's etag", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/media/assets/bulk-move`, async ({ request }) => {
        bodies.push(await request.clone().json());
        return undefined;
      })
    );
    const { user, bar } = await openWith(["blog-card-1.jpg", "blog-card-2.jpg"]);
    await user.click(within(bar()).getByRole("button", { name: "Move to folder" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: "Folder" }));
    await user.click(await screen.findByRole("option", { name: "Gallery" }));
    await user.click(within(dialog).getByRole("button", { name: "Move" }));
    await waitFor(() => expect(asset(5).folder_id).toBe(4));
    expect(asset(6).folder_id).toBe(4);
    expect(bodies[0]).toEqual({
      items: [
        { id: 5, etag: expect.stringMatching(/^"/) },
        { id: 6, etag: expect.stringMatching(/^"/) },
      ],
      folder_id: 4,
    });
    // everything moved: nothing is selected any more
    await waitFor(() => expect(screen.queryByRole("region", { name: BAR })).not.toBeInTheDocument());
  });

  it("moving to the root sends folder_id null", async () => {
    const seen: unknown[] = [];
    server.use(
      http.post(`${API}/media/assets/bulk-move`, async ({ request }) => {
        seen.push(await request.clone().json());
        return undefined;
      })
    );
    const { user, bar } = await openWith(["blog-card-1.jpg"]);
    await user.click(within(bar()).getByRole("button", { name: "Move to folder" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Move" }));
    await waitFor(() => expect(asset(5).folder_id).toBeNull());
    expect(seen[0]).toMatchObject({ folder_id: null });
  });

  it("delete: confirms, skips what is in use and lists it with a readable reason; the skipped stay selected", async () => {
    const { user, bar } = await openWith(["hero-bg.png", "blog-card-1.jpg"]);
    await user.click(within(bar()).getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/Files that are still used .* are skipped/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    const result = await screen.findByRole("dialog");
    expect(within(result).getByText("1 file changed, 1 skipped.")).toBeInTheDocument();
    const skipped = within(result).getByRole("list", { name: "Skipped files" });
    expect(within(skipped).getByText("hero-bg.png")).toBeInTheDocument();
    expect(within(skipped).getByText("Still used on a page, post or album, so it was not deleted.")).toBeInTheDocument();
    expect(asset(5).deleted_at).toBeTruthy();
    expect(asset(1).deleted_at).toBeFalsy();
    await user.click(within(result).getAllByRole("button", { name: "Close" })[0]);
    // the used file is still selected, the deleted one is gone from the list
    await waitFor(() => expect(screen.getByRole("region", { name: BAR })).toHaveTextContent("1 selected"));
    expect(screen.getByRole("checkbox", { name: "Select hero-bg.png" })).toBeChecked();
  });

  it("a stale row is skipped (somebody else changed it) and reported", async () => {
    const { user, bar } = await openWith(["blog-card-1.jpg", "blog-card-2.jpg"]);
    asset(6).updated_at = "2030-01-01T00:00:00.000000Z"; // changed behind the list's back
    await user.click(within(bar()).getByRole("button", { name: "Delete" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    const result = await screen.findByRole("dialog");
    expect(within(result).getByText("1 file changed, 1 skipped.")).toBeInTheDocument();
    expect(within(result).getByText("blog-card-2.jpg")).toBeInTheDocument();
    expect(within(result).getByText(/Somebody changed this file meanwhile/)).toBeInTheDocument();
    expect(asset(6).deleted_at).toBeFalsy();
    expect(asset(5).deleted_at).toBeTruthy();
  });

  it("a move to the folder the file is already in is reported as unchanged", async () => {
    const { user, bar } = await openWith(["blog-card-1.jpg"]);
    await user.click(within(bar()).getByRole("button", { name: "Move to folder" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: "Folder" }));
    await user.click(await screen.findByRole("option", { name: "Home" })); // blog-card-1 is in Home (1)
    await user.click(within(dialog).getByRole("button", { name: "Move" }));
    const result = await screen.findByText("Already in that folder.");
    expect(result).toBeInTheDocument();
  });

  it("without update / delete the bulk buttons are not offered (copy names stays)", async () => {
    me.current = { id: 6, roleID: 2, permissions: grants({ "media.library": ["read"], "cms.locales": ["read"] }) };
    const { bar } = await openWith(["blog-card-1.jpg"]);
    expect(within(bar()).getByRole("button", { name: "Copy file names" })).toBeInTheDocument();
    expect(within(bar()).queryByRole("button", { name: "Move to folder" })).not.toBeInTheDocument();
    expect(within(bar()).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("only update: move is offered, delete is not", async () => {
    me.current = { id: 6, roleID: 2, permissions: grants({ "media.library": ["read", "update"], "cms.locales": ["read"] }) };
    const { bar } = await openWith(["blog-card-1.jpg"]);
    expect(within(bar()).getByRole("button", { name: "Move to folder" })).toBeInTheDocument();
    expect(within(bar()).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("a request-level 403 is reported and the rows stay selected", async () => {
    setBulkDenied(true);
    const { user, bar } = await openWith(["blog-card-1.jpg"]);
    await user.click(within(bar()).getByRole("button", { name: "Move to folder" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Move" }));
    const result = await screen.findByText("Not sent: the request failed.");
    expect(result).toBeInTheDocument();
    expect(asset(5).folder_id).toBe(1);
  });
});
