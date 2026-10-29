import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AlbumHost } from "@/components/protected/albums/album-host";
import { referenceAlbumItemFromPage, touchAlbumAsSomeoneElse } from "@/mocks/mock-albums";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, name: "Noy Keomany", roleID: 2, permissions: [] as PermissionGrant[] } }));
const nav = vi.hoisted(() => ({ search: "", replace: vi.fn(), push: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/galleries/3",
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const EDITOR = grants({
  "cms.galleries": ["read", "create", "update", "delete", "publish", "unpublish", "translate"],
  "cms.locales": ["read"],
  "media.library": ["read"],
});
const TRANSLATOR = grants({ "cms.galleries": ["read", "translate"], "cms.locales": ["read"], "media.library": ["read"] });

const root = (id: number) => getMockDb().albums.find((a) => a.id === id)!;
const open = async (id = 3, search = "") => {
  nav.search = search;
  const view = renderApp(<AlbumHost id={id} />);
  await screen.findByTestId(search.includes("tab=details") ? "album-details" : search.includes("tab=revisions") ? "revisions-tab" : "album-items", {}, { timeout: 4000 });
  await waitFor(() => expect(screen.queryByLabelText("Loading")).not.toBeInTheDocument());
  return view;
};
const user = () => userEvent.setup();

beforeEach(() => {
  me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: EDITOR };
  nav.search = "";
  nav.replace.mockReset();
  nav.push.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
});

describe("AlbumEditor: the pictures tab", () => {
  useMockApi();

  it("shows the title, the key, the chip, the pictures in order with their captions and how many of 200", async () => {
    await open(3);
    expect(screen.getByRole("heading", { level: 1, name: "Summit week" })).toBeInTheDocument();
    expect(screen.getByText("summit-week")).toBeInTheDocument();
    expect(screen.getByTestId("status-badge")).toHaveTextContent("Draft only");
    const grid = await screen.findByTestId("album-items");
    await waitFor(() => expect(within(grid).getAllByTestId(/^album-item-\d+$/)).toHaveLength(3));
    expect(screen.getByTestId("album-items-count")).toHaveTextContent("3 of 200 pictures");
    expect(within(screen.getByTestId("album-item-8")).getByText("Two on the ice")).toBeInTheDocument();
  });

  it("a move sends ONE PUT with every id and the album's ETag, shows the new order at once, and the next write carries the ETag of the answer", async () => {
    const u = user();
    const seen: Array<{ method: string; ifMatch: string | null; body: unknown }> = [];
    server.use(
      http.put(`${API}/albums/3/items/order`, async ({ request }) => { seen.push({ method: "PUT", ifMatch: request.headers.get("If-Match"), body: await request.clone().json() }); return undefined; }),
      http.patch(`${API}/albums/3/items/:itemId`, async ({ request }) => { seen.push({ method: "PATCH", ifMatch: request.headers.get("If-Match"), body: await request.clone().json() }); return undefined; })
    );
    await open(3);
    await screen.findByTestId("album-item-8");
    await u.click(screen.getByRole("button", { name: "Move Picture 1 down" }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({ method: "PUT", ifMatch: '"1"', body: { items: [{ id: 9 }, { id: 8 }, { id: 10 }] } });
    await waitFor(() => expect(root(3).lock_version).toBe(2));
    const order = screen.getAllByTestId(/^album-item-\d+$/).map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual(["album-item-9", "album-item-8", "album-item-10"]);
    // an edit of the first picture right after: the ETag is the one the reorder answered
    await u.click(screen.getByRole("button", { name: "Edit picture 2" }));
    expect(nav.replace).toHaveBeenCalledWith(expect.stringContaining("item=8"), expect.anything());
  });

  it("adds pictures from the picker with an Idempotency-Key; the new cards appear and the count moves", async () => {
    const u = user();
    const posts: Array<{ ifMatch: string | null; key: string | null; body: { items: Array<{ media_id: number }> } }> = [];
    server.use(http.post(`${API}/albums/3/items`, async ({ request }) => { posts.push({ ifMatch: request.headers.get("If-Match"), key: request.headers.get("Idempotency-Key"), body: (await request.clone().json()) as { items: Array<{ media_id: number }> } }); return undefined; }));
    await open(3);
    await screen.findByTestId("album-item-8");
    await u.click(screen.getByRole("button", { name: "Add pictures" }));
    const dialog = await screen.findByRole("dialog", { name: "Add pictures to the album" });
    expect(within(dialog).getByText(/You can add 50 more pictures at once/)).toBeInTheDocument();
    const tiles = await within(dialog).findAllByRole("button", { name: /^#\d+|\.jpg|\.png/i });
    await u.click(tiles[0]);
    await u.click(tiles[1]);
    await u.click(within(dialog).getByRole("button", { name: /^Add selected/ }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].ifMatch).toBe('"1"');
    expect(posts[0].key).toBeTruthy();
    expect(posts[0].body.items).toHaveLength(2);
    await waitFor(() => expect(screen.getByTestId("album-items-count")).toHaveTextContent("5 of 200 pictures"));
    expect(root(3).live.items).toHaveLength(5);
  });

  it("a picture a photo story uses has the badge and its delete is switched off with the reason", async () => {
    await open(1);
    await screen.findByTestId("album-item-1");
    expect(screen.getByTestId("album-item-in-use-1")).toHaveTextContent("Used in a photo story");
    expect(within(screen.getByTestId("album-item-1")).getByRole("button", { name: "Delete picture 1" })).toBeDisabled();
    expect(screen.getByTestId("album-item-delete-hint-1")).toBeInTheDocument();
  });

  it("deleting an unused picture asks first, sends DELETE with the ETag and renumbers the cards", async () => {
    const u = user();
    const seen: Array<string | null> = [];
    server.use(http.delete(`${API}/albums/3/items/9`, ({ request }) => { seen.push(request.headers.get("If-Match")); return undefined; }));
    await open(3);
    await screen.findByTestId("album-item-9");
    await u.click(screen.getByRole("button", { name: "Delete picture 2" }));
    await u.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByTestId("album-item-9")).not.toBeInTheDocument());
    expect(seen).toEqual(['"1"']);
    expect(screen.getByTestId("album-items-count")).toHaveTextContent("2 of 200 pictures");
  });

  it("a stale page: the server says 409 ENTITY_REFERENCED and the dialog lists the page (link to its editor), with no way to go on", async () => {
    const u = user();
    await open(3);
    await screen.findByTestId("album-item-9");
    referenceAlbumItemFromPage(getMockDb(), 6, 9);
    await u.click(screen.getByRole("button", { name: "Delete picture 2" }));
    await u.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByTestId("references-blocked-dialog");
    expect(within(dialog).getByText("Picture 2 cannot be deleted")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /Spring campaign/ })).toHaveAttribute("href", "/admin/pages/6");
    expect(root(3).live.items).toHaveLength(3);
  });

  it("a conflict (somebody else saved the album) opens the conflict dialog and the order is put back", async () => {
    const u = user();
    await open(3);
    await screen.findByTestId("album-item-8");
    touchAlbumAsSomeoneElse(getMockDb(), 3);
    await u.click(screen.getByRole("button", { name: "Move Picture 1 down" }));
    expect(await screen.findByRole("dialog", { name: "Someone else changed this item" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId(/^album-item-\d+$/).map((el) => el.getAttribute("data-testid"))).toEqual(["album-item-8", "album-item-9", "album-item-10"]));
  });
});

describe("AlbumEditor: the picture sheet", () => {
  useMockApi();

  it("opens from ?item=, edits caption and alt per language, saves only what changed with the album's ETag; an untouched sheet closes without asking", async () => {
    const u = user();
    const patches: Array<{ ifMatch: string | null; body: unknown }> = [];
    server.use(http.patch(`${API}/albums/3/items/8`, async ({ request }) => { patches.push({ ifMatch: request.headers.get("If-Match"), body: await request.clone().json() }); return undefined; }));
    await open(3, "item=8");
    const sheet = await screen.findByTestId("album-item-sheet");
    expect(within(sheet).getByLabelText(/^Caption title/)).toHaveValue("Two on the ice");
    expect(within(sheet).getByRole("button", { name: "Save picture" })).toBeDisabled();
    await u.click(within(sheet).getByRole("radio", { name: /English/ }));
    expect(within(sheet).getByLabelText(/^Caption title/)).toHaveValue("Two on the ice");
    await u.type(within(sheet).getByLabelText(/^Alt text/), "Two climbers on a glacier");
    await u.type(within(sheet).getByLabelText("Layout hint"), "wide");
    await u.click(within(sheet).getByRole("button", { name: "Save picture" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ ifMatch: '"1"', body: { layout_hint: "wide", translations: { en: { alt: "Two climbers on a glacier" } } } });
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(expect.not.stringContaining("item="), expect.anything()));
    const saved = root(3).live.items[0];
    expect(saved.layout_hint).toBe("wide");
    expect(saved.translations.find((t) => t.locale_code === "en")!.alt).toBe("Two climbers on a glacier");
  });

  it("a layout hint that does not fit the pattern blocks the save; closing with unsaved edits asks first", async () => {
    const u = user();
    await open(3, "item=8");
    const sheet = await screen.findByTestId("album-item-sheet");
    await u.type(within(sheet).getByLabelText("Layout hint"), "Bad Hint");
    expect(within(sheet).getByText(/Use lower case letters, numbers/)).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Save picture" })).toBeDisabled();
    await u.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Discard your changes?")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Discard" }));
    expect(nav.replace).toHaveBeenCalled();
  });

  it("a picture a photo story uses says so in the sheet", async () => {
    await open(1, "item=2");
    const sheet = await screen.findByTestId("album-item-sheet");
    expect(within(sheet).getByTestId("album-item-in-use").textContent).toMatch(/photo stor(y uses|ies use) this picture/);
  });
});

describe("AlbumEditor: the details tab and the PublishBar", () => {
  useMockApi();

  it("Save draft sends ONLY what changed with If-Match and moves the ETag from the answer (no refetch)", async () => {
    const u = user();
    const seen: Array<{ ifMatch: string | null; body: unknown }> = [];
    let gets = 0;
    server.use(
      http.get(`${API}/albums/3`, () => { gets += 1; return undefined; }),
      http.patch(`${API}/albums/3`, async ({ request }) => { seen.push({ ifMatch: request.headers.get("If-Match"), body: await request.clone().json() }); return undefined; })
    );
    const { queryClient } = await open(3, "tab=details");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    await u.type(screen.getByLabelText(/^Description/), "Seven days up high.");
    expect(await screen.findByTestId("publish-dirty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(screen.queryByTestId("publish-dirty")).not.toBeInTheDocument());
    expect(seen).toEqual([{ ifMatch: '"1"', body: { translations: { la: { description: "Seven days up high." } } } }]);
    expect(queryClient.getQueryData<{ etag: string }>(["/albums/3"])?.etag).toBe('"2"');
    expect(gets).toBe(1);
    expect(screen.getByTestId("album-key")).toHaveTextContent("summit-week");
  });

  it("a title longer than 120, an empty default title and a description without a title in another language are said at the field and hold the save back", async () => {
    const u = user();
    await open(3, "tab=details");
    const title = screen.getByLabelText(/^Title/);
    await u.clear(title);
    expect(await screen.findByText("Required.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    expect(toast.error).toHaveBeenCalledWith("Fix the problems shown in the form first.");
    expect(root(3).lock_version).toBe(1);
  });

  it("publishing album 2 is blocked by the picture without alt text: the dialog groups it under Picture 1 and Go to field opens its sheet", async () => {
    const u = user();
    await open(2);
    await screen.findByTestId("album-item-6");
    await u.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = await screen.findByTestId("publish-blockers");
    expect(within(dialog).getByText("Picture 1")).toBeInTheDocument();
    expect(within(dialog).getByText("The image has no alt text in the default language.")).toBeInTheDocument();
    await u.click(within(dialog).getByRole("button", { name: /Go to/ }));
    expect(nav.replace).toHaveBeenCalledWith(expect.stringContaining("item=6"), expect.anything());
  });

  it("publishing a ready album: dry run, confirmation, then it is live and the chip says so; no preview button exists for albums", async () => {
    const u = user();
    await open(3);
    await screen.findByTestId("album-item-8");
    expect(screen.queryByRole("button", { name: /Preview/ })).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Publish" }));
    const confirm = await screen.findByRole("dialog");
    await u.click(within(confirm).getByRole("button", { name: /^Publish/ }));
    await waitFor(() => expect(screen.getByTestId("status-badge")).toHaveTextContent("Published"));
    expect(root(3).status).toBe("published");
  });

  it("unpublishing an album a section uses lists the page and repeats with confirm_references=true", async () => {
    const u = user();
    const urls: string[] = [];
    server.use(http.post(`${API}/albums/1/unpublish`, ({ request }) => { urls.push(new URL(request.url).search); return undefined; }));
    await open(1);
    await screen.findByTestId("album-item-1");
    await u.click(screen.getByRole("button", { name: "Unpublish" }));
    await u.click(await screen.findByRole("button", { name: "Unpublish" }));
    const dialog = await screen.findByTestId("referenced-dialog");
    expect(within(dialog).getByText(/1 place uses this album/)).toBeInTheDocument();
    await u.click(within(dialog).getByRole("button", { name: "Unpublish anyway" }));
    await waitFor(() => expect(urls).toEqual(["", "?confirm_references=true"]));
    await waitFor(() => expect(root(1).status).toBe("archived"));
  });

  it("the History tab lists the versions of the album", async () => {
    await open(1, "tab=revisions");
    expect(await screen.findByTestId("revisions-tab")).toBeInTheDocument();
  });
});

describe("AlbumEditor: translate mode and read only", () => {
  useMockApi();

  it("a translator edits the texts of the languages that have a row and the captions; there is no add, delete, drag, cover or layout hint", async () => {
    me.current = { ...me.current, permissions: TRANSLATOR };
    getMockDb().translateOnly = ["albums"];
    const u = user();
    const patches: unknown[] = [];
    server.use(http.patch(`${API}/albums/3`, async ({ request }) => { patches.push(await request.clone().json()); return undefined; }));
    await open(3, "tab=details&locale=en");
    expect(screen.getByTestId("translate-mode-note")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose a cover picture" })).not.toBeInTheDocument();
    const title = screen.getByLabelText(/^Title/);
    expect(title).toBeEnabled();
    await u.type(title, "!");
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(patches).toEqual([{ translations: { en: { title: "Summit week!" } } }]));
  });

  it("the pictures tab of a translator has no add, no delete and no drag handle, and the sheet keeps the layout hint read only", async () => {
    me.current = { ...me.current, permissions: TRANSLATOR };
    getMockDb().translateOnly = ["albums"];
    await open(3);
    await screen.findByTestId("album-item-8");
    expect(screen.queryByRole("button", { name: "Add pictures" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete picture/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move Picture/ })).not.toBeInTheDocument();
  });

  it("a reader sees everything and changes nothing", async () => {
    me.current = { ...me.current, permissions: grants({ "cms.galleries": ["read"], "cms.locales": ["read"], "media.library": ["read"] }) };
    await open(3);
    await screen.findByTestId("album-item-8");
    expect(screen.getByTestId("read-only-note")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(within(screen.getByTestId("album-item-8")).getByRole("button", { name: "Edit picture 1" })).toHaveTextContent("View");
  });
});

describe("AlbumHost", () => {
  useMockApi();
  it("an album that does not exist is a not-found state, a trashed one says it is in the trash", async () => {
    renderApp(<AlbumHost id={999} />);
    expect(await screen.findByText("Album not found")).toBeInTheDocument();
  });
});
