import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MediaLibrary } from "@/components/protected/media/media-library";
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

beforeEach(() => {
  nav.search = "";
  nav.push.mockReset();
  window.localStorage.clear();
  me.current = { id: 6, roleID: 2, permissions: FULL };
});

describe("MediaLibrary (SCR-35)", () => {
  useMockApi();

  it("lists the first page as a grid with the file facts and no upload control", async () => {
    renderApp(<MediaLibrary />);
    expect(await screen.findByRole("button", { name: "Open hero-bg.png" })).toBeInTheDocument();
    const grid = screen.getByRole("list", { name: "Files" });
    // default page size 20 of the 24 seeded files
    expect(within(grid).getAllByRole("listitem")).toHaveLength(20);
    expect(screen.getByText("24 in total")).toBeInTheDocument();
    expect(screen.queryByText(/upload/i)).not.toBeInTheDocument();
    // hero-bg.png has no alt text anywhere and is used on the Home page
    const tile = screen.getByRole("button", { name: "Open hero-bg.png" }).closest("li")!;
    expect(within(tile).getByText("No alt text")).toBeInTheDocument();
  });

  it("sends the URL state to the API: sort, filters, folder (with sub-folders) and keyword", async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get(`${API}/media/assets`, ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json({ success: true, data: [], meta: { total: 0, page: 1, limit: 20, total_page: 0 } });
      })
    );
    nav.search = "kind=image&folder_id=2&unused=true&missing_alt=true&keyword=glacier&sort=-bytes&page=2";
    renderApp(<MediaLibrary />);
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    const q = seen[0];
    expect(Object.fromEntries(q.entries())).toEqual({
      page: "2", limit: "20", keyword: "glacier", sort: "-bytes", kind: "image", folder_id: "2", include_subfolders: "true", unused: "true", missing_alt: "true",
    });
  });

  it("filters go to the URL (page 1), the folder tree filters by folder, and clearing resets them", async () => {
    const user = userEvent.setup();
    renderApp(<MediaLibrary />);
    await screen.findByRole("button", { name: "Open hero-bg.png" });
    await user.click(await screen.findByRole("button", { name: /Our Path/ }));
    expect(nav.push).toHaveBeenLastCalledWith("/admin/media?folder_id=2", { scroll: false });
    await user.click(screen.getByRole("checkbox", { name: "Missing alt text" }));
    expect(nav.push).toHaveBeenLastCalledWith("/admin/media?folder_id=2&missing_alt=true", { scroll: false });
  });

  it("the folder filter works against the model: only the files of that folder (and below) come back", async () => {
    nav.search = "folder_id=5";
    renderApp(<MediaLibrary />);
    // Brand (5) > Logos (6): the two SVG logos
    expect(await screen.findByRole("button", { name: "Open materm-logo-white.svg" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open materm-emblem.svg" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Open / })).toHaveLength(2);
  });

  it("switches to the table view (remembered) with sortable columns", async () => {
    const user = userEvent.setup();
    renderApp(<MediaLibrary />);
    await screen.findByRole("button", { name: "Open hero-bg.png" });
    await user.click(screen.getByRole("radio", { name: "List view" }));
    expect(window.localStorage.getItem("materm-admin:media-view")).toBe("list");
    expect(await screen.findByRole("columnheader", { name: /File/ })).toBeInTheDocument();
    expect(screen.getByText("3.0 MB")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Size/ }));
    expect(nav.push).toHaveBeenLastCalledWith("/admin/media?sort=bytes", { scroll: false });
  });

  it("selection: tiles are selectable, the bar counts and 'copy file names' copies them", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderApp(<MediaLibrary />);
    await screen.findByRole("button", { name: "Open hero-bg.png" });
    await user.click(screen.getByRole("checkbox", { name: "Select hero-bg.png" }));
    await user.click(screen.getByRole("checkbox", { name: "Select blog-card-1.jpg" }));
    const bar = screen.getByRole("region", { name: "Actions for the selected rows" });
    expect(within(bar).getByText("2 selected")).toBeInTheDocument();
    await user.click(within(bar).getByRole("button", { name: "Copy file names" }));
    expect(writeText).toHaveBeenCalledWith("hero-bg.png\nblog-card-1.jpg");
    await user.click(within(bar).getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("region", { name: "Actions for the selected rows" })).not.toBeInTheDocument();
  });

  it("opening a file puts ?asset=<id> in the URL next to the list state", async () => {
    const user = userEvent.setup();
    nav.search = "kind=image";
    renderApp(<MediaLibrary />);
    await user.click(await screen.findByRole("button", { name: "Open hero-bg.png" }));
    expect(nav.push).toHaveBeenLastCalledWith("/admin/media?kind=image&asset=1", { scroll: false });
  });

  it("a row without a URL (media.staticBaseUrl not configured) shows a placeholder tile, not a broken image", async () => {
    getMockDb().assets.find((a) => a.id === 1)!.url = null;
    renderApp(<MediaLibrary />);
    const tile = (await screen.findByRole("button", { name: "Open hero-bg.png" })).closest("li")!;
    expect(within(tile).getByText("No preview (file address not configured)")).toBeInTheDocument();
    expect(tile.querySelector("img")).toBeNull();
  });

  it("a picture that fails to load falls back to the placeholder (CSP, missing file)", async () => {
    renderApp(<MediaLibrary />);
    const tile = (await screen.findByRole("button", { name: "Open hero-bg.png" })).closest("li")!;
    const img = tile.querySelector("img")!;
    img.dispatchEvent(new Event("error"));
    expect(await within(tile).findByText("The picture could not be loaded")).toBeInTheDocument();
  });

  it("empty library, empty filter result and the trash each say so", async () => {
    server.use(http.get(`${API}/media/assets`, () => HttpResponse.json({ success: true, data: [], meta: { total: 0, page: 1, limit: 20, total_page: 0 } })));
    const first = renderApp(<MediaLibrary />);
    expect(await screen.findByText("The media library is empty")).toBeInTheDocument();
    first.unmount();
    nav.search = "keyword=zzz";
    const second = renderApp(<MediaLibrary />);
    expect(await screen.findByText("No items match your filters")).toBeInTheDocument();
    second.unmount();
    nav.search = "trashed=true";
    renderApp(<MediaLibrary />);
    expect(await screen.findByText("The trash is empty")).toBeInTheDocument();
  });

  it("the trash toggle is offered only to those who may delete, and trashed files show a badge", async () => {
    me.current = { ...me.current, permissions: grants({ "media.library": ["read", "update"] }) };
    const first = renderApp(<MediaLibrary />);
    await screen.findByRole("button", { name: "Open hero-bg.png" });
    expect(screen.queryByRole("checkbox", { name: "Trash" })).not.toBeInTheDocument();
    first.unmount();
    me.current = { ...me.current, permissions: FULL };
    const db = getMockDb();
    const asset = db.assets.find((a) => a.id === 24)!;
    asset.deleted_at = "2026-10-27T03:00:00.000000Z";
    nav.search = "trashed=true";
    renderApp(<MediaLibrary />);
    const tile = (await screen.findByRole("button", { name: "Open materm-emblem.svg" })).closest("li")!;
    expect(within(tile).getByText("In trash")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Trash" })).toBeChecked();
  });

  it("a 403 is the no-permission state (no retry); a 500 is an error with a retry", async () => {
    const user = userEvent.setup();
    server.use(http.get(`${API}/media/assets`, () => HttpResponse.json({ success: false, code: "FORBIDDEN" }, { status: 403 })));
    const first = renderApp(<MediaLibrary />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
    first.unmount();
    let calls = 0;
    server.use(
      http.get(`${API}/media/assets`, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ success: false, code: "INTERNAL_ERROR" }, { status: 500 })
          : HttpResponse.json({ success: true, data: [], meta: { total: 0, page: 1, limit: 20, total_page: 0 } });
      })
    );
    renderApp(<MediaLibrary />);
    await user.click(await screen.findByRole("button", { name: /Try again|Retry/ }));
    expect(await screen.findByText("The media library is empty")).toBeInTheDocument();
  });

  it("folders: a user with create can add one (Idempotency-Key sent, name and parent in the body)", async () => {
    const user = userEvent.setup();
    let seen: { body: unknown; key: string | null } | null = null;
    server.use(
      http.post(`${API}/media/folders`, async ({ request }) => {
        seen = { body: await request.json(), key: request.headers.get("Idempotency-Key") };
        return HttpResponse.json({ success: true, data: { ...getMockDb().folders[0], id: 77, name: "Summer" } }, { status: 201, headers: { ETag: '"x"' } });
      })
    );
    renderApp(<MediaLibrary />);
    await screen.findByRole("button", { name: "Open hero-bg.png" });
    await user.click(screen.getByRole("button", { name: "New folder" }));
    const dialog = await screen.findByRole("dialog", { name: "New folder" });
    await user.type(within(dialog).getByLabelText("Folder name"), "Summer");
    await user.click(within(dialog).getByRole("button", { name: "Create folder" }));
    await waitFor(() => expect(seen).not.toBeNull());
    expect(seen!.body).toEqual({ name: "Summer", parent_id: null });
    expect(seen!.key).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(nav.push).toHaveBeenLastCalledWith("/admin/media?folder_id=77", { scroll: false }));
  });

  it("a duplicate folder name is shown on the field (409 CONFLICT_DUPLICATE /name)", async () => {
    const user = userEvent.setup();
    renderApp(<MediaLibrary />);
    await screen.findByRole("button", { name: "Open hero-bg.png" });
    await user.click(screen.getByRole("button", { name: "New folder" }));
    const dialog = await screen.findByRole("dialog", { name: "New folder" });
    await user.type(within(dialog).getByLabelText("Folder name"), "home");
    await user.click(within(dialog).getByRole("button", { name: "Create folder" }));
    expect(await within(dialog).findByText("This value is already in use.")).toBeInTheDocument();
  });

  it("a folder that is not empty can not be deleted: the API says why", async () => {
    const user = userEvent.setup();
    nav.search = "folder_id=1";
    renderApp(<MediaLibrary />);
    await screen.findByRole("button", { name: "Open hero-bg.png" });
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("The folder is not empty")));
  });

  it("without create / update / delete the folder commands are absent", async () => {
    me.current = { ...me.current, permissions: grants({ "media.library": ["read"] }) };
    nav.search = "folder_id=1";
    renderApp(<MediaLibrary />);
    await screen.findByRole("button", { name: "Open hero-bg.png" });
    expect(screen.queryByRole("button", { name: "New folder" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});
