import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PostsList } from "@/components/protected/posts/posts-list";
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
  usePathname: () => "/admin/blog/posts",
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const EDITOR = grants({
  "cms.blog": ["read", "create", "update", "delete", "publish", "unpublish", "translate"],
  "cms.locales": ["read"],
});
const AUTHOR = grants({ "cms.blog": ["read", "create", "update_own", "delete_own", "translate"], "cms.locales": ["read"] });
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

describe("PostsList (SCR-24)", () => {
  useMockApi();

  it("lists the posts with the title (a link to the editor), slug, status chip, category, author, language badges and dates", async () => {
    renderApp(<PostsList />);
    const table = await screen.findByRole("table");
    await within(table).findByText("Music night under the stars");
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(7); // post 6 is in the trash
    const music = await rowOf("Music night under the stars");
    expect(within(music).getByRole("link", { name: "Music night under the stars" })).toHaveAttribute("href", "/admin/blog/posts/1");
    expect(within(music).getByText("/blog/music-night-under-the-stars")).toBeInTheDocument();
    expect(within(music).getByTestId("status-badge")).toHaveTextContent("Published");
    expect(within(music).getByText("Music")).toBeInTheDocument();
    const gear = await rowOf("Dry season gear list (2026)");
    expect(within(gear).getByTestId("status-badge")).toHaveTextContent("Published, changes pending");
    expect(within(gear).getByText("Somchai Vongsa")).toBeInTheDocument();
    const notes = await rowOf("Unfinished trail notes");
    expect(within(notes).getByTestId("status-badge")).toHaveTextContent("Draft only");
    // la has a title only (the excerpt and the SEO title are missing); en has nothing
    expect(within(notes).getByLabelText("la: 2 texts missing")).toBeInTheDocument();
    // en has no row at all: it is not shown on the website
    expect(within(notes).getByLabelText("en: switched off for this post")).toBeInTheDocument();
    expect(screen.getByText("7 in total")).toBeInTheDocument();
  });

  it("the filters come from the URL: status + keyword, category, tags (all of them), author, pending changes", async () => {
    nav.search = "status=draft&keyword=notes";
    const { unmount } = renderApp(<PostsList />);
    const table = await screen.findByRole("table");
    await within(table).findByText("Unfinished trail notes");
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(1);
    unmount();

    nav.search = "category_id=2";
    const second = renderApp(<PostsList />);
    await screen.findByText("Dry season gear list (2026)");
    expect(within(await screen.findByRole("table")).getAllByRole("row").slice(1)).toHaveLength(2);
    second.unmount();

    nav.search = "created_by=6&has_unpublished_changes=false";
    // an invalid value is dropped (the list never answers 422 for a hand-typed URL)
    renderApp(<PostsList />);
    expect(await screen.findByText("Sunrise paddle on the Mekong")).toBeInTheDocument();
  });

  it("the status chip writes the URL; the author chip offers 'Mine'; the language chip sets the language of the texts", async () => {
    const user = userEvent.setup();
    renderApp(<PostsList />);
    await screen.findByRole("table");
    await user.click(screen.getAllByRole("button", { name: /Status/ }).find((b) => !b.closest("th"))!);
    await user.click(within(await screen.findByRole("listbox")).getByText("Draft"));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/admin/blog/posts?status=draft", { scroll: false }));

    nav.push.mockReset();
    await user.click(screen.getAllByText("Author").find((el) => !el.closest("th"))!);
    await user.click(await screen.findByText("Mine (Noy Keomany)"));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/admin/blog/posts?status=draft&created_by=6", { scroll: false }));

    nav.push.mockReset();
    await user.click(screen.getAllByText("Language of the texts").find((el) => !el.closest("th"))!);
    await user.click(await screen.findByText("English (en)"));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/admin/blog/posts?status=draft&created_by=6&locale=en", { scroll: false }));
  });

  it("the language of the texts is sent as `locale` (the titles come back in it)", async () => {
    nav.search = "locale=en";
    const seen: string[] = [];
    server.use(http.get(`${API}/posts`, ({ request }) => { seen.push(new URL(request.url).search); return undefined; }));
    getMockDb().posts.find((p) => p.id === 3)!.live.translations.push({
      locale_code: "en", slug: "trail-notes", title: "Trail notes (en)", excerpt: null, label: null, location_label: null, body: null, gallery_heading: null,
      gallery_description: null, hero_alt: null, seo_title: null, seo_description: null, og_image_id: null, is_enabled: true,
    });
    renderApp(<PostsList />);
    expect(await screen.findByText("Trail notes (en)")).toBeInTheDocument();
    expect(seen[0]).toContain("locale=en");
  });

  it("the trash switch shows the trash with its own columns and a Restore button that sends If-Match", async () => {
    nav.search = "trashed=true";
    const user = userEvent.setup();
    const seen: Array<{ ifMatch: string | null }> = [];
    server.use(http.post(`${API}/posts/6/restore`, ({ request }) => { seen.push({ ifMatch: request.headers.get("If-Match") }); return undefined; }));
    renderApp(<PostsList />);
    const table = await screen.findByRole("table");
    expect(await within(table).findByText("Old camp rules")).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Deleted" })).toBeInTheDocument();
    expect(within(table).getByText(/Removed for good on/)).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore Old camp rules" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('"Old camp rules" was restored as a draft.'));
    expect(seen).toEqual([{ ifMatch: '"1"' }]);
    expect(getMockDb().posts.find((p) => p.id === 6)!.deleted_at).toBeNull();
  });

  it("switching the trash on writes the URL (and the newest deletion first)", async () => {
    const user = userEvent.setup();
    renderApp(<PostsList />);
    await screen.findByRole("table");
    await user.click(screen.getByRole("switch", { name: "Show trash" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalled());
    const url = nav.push.mock.calls.at(-1)![0] as string;
    expect(url).toContain("trashed=true");
    expect(url).toContain("sort=-deleted_at");
  });

  it("a 403 on the list shows the no permission state, an empty list offers to create the first post", async () => {
    server.use(http.get(`${API}/posts`, () => HttpResponse.json({ success: false, code: "FORBIDDEN", message: "no" }, { status: 403 })));
    const { unmount } = renderApp(<PostsList />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    unmount();
    server.use(http.get(`${API}/posts`, () => HttpResponse.json({ success: true, data: [], meta: { total: 0, page: 1, limit: 20, total_page: 0 } })));
    renderApp(<PostsList />);
    expect(await screen.findByText("There are no posts yet.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New post" }).length).toBeGreaterThan(0);
  });
});

describe("PostsList: the rights of the rows (update_own / delete_own, 05 13.3.2)", () => {
  useMockApi();

  it("an author is offered Edit and Delete on their own never-published post, View only on the rest; no restore", async () => {
    me.current = { id: 6, name: "Noy Keomany", roleID: 3, permissions: AUTHOR };
    const user = userEvent.setup();
    renderApp(<PostsList />);
    // 3: mine, a draft -> Edit and delete
    await openMenu(user, "Unfinished trail notes");
    expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Create preview link" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Move to the trash" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    // 2: mine but published once -> no delete
    await openMenu(user, "Sunrise paddle on the Mekong");
    expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Move to the trash" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    // 8: somebody else's: the author can translate it (Edit opens the translator mode), but not delete it nor issue a link
    await openMenu(user, "Camp kitchen basics");
    expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Move to the trash" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Create preview link" })).not.toBeInTheDocument();
  });

  it("a reader (read only) sees the list without New post, the trash switch or any row action that changes anything; rows of others are marked read only", async () => {
    me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: grants({ "cms.blog": ["read"] }) };
    const user = userEvent.setup();
    renderApp(<PostsList />);
    await rowOf("Camp kitchen basics");
    expect(screen.queryByRole("button", { name: "New post" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Show trash" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Read only" }).length).toBeGreaterThan(0);
    await openMenu(user, "Camp kitchen basics");
    expect(await screen.findByRole("menuitem", { name: "View" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Move to the trash" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Create preview link" })).not.toBeInTheDocument();
  });
});

describe("PostsList: delete and preview", () => {
  useMockApi();

  it("moving a published post to the trash asks first, sends If-Match, and says that pages showing it now skip it (non-blocking)", async () => {
    const user = userEvent.setup();
    const seen: Array<{ ifMatch: string | null; search: string }> = [];
    server.use(http.delete(`${API}/posts/1`, ({ request }) => { seen.push({ ifMatch: request.headers.get("If-Match"), search: new URL(request.url).search }); return undefined; }));
    renderApp(<PostsList />);
    await openMenu(user, "Music night under the stars");
    await user.click(await screen.findByRole("menuitem", { name: "Move to the trash" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("It is published, so it disappears from the website now.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Move to the trash" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('"Music night under the stars" is in the trash for 30 days.'));
    expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/places show this post, for example a blog strip/));
    expect(seen).toEqual([{ ifMatch: '"1"', search: "" }]); // no confirm_references: a post is never blocked by who shows it
    expect(getMockDb().posts.find((p) => p.id === 1)!.deleted_at).not.toBeNull();
  });

  it("a stale row (somebody else changed it) is a toast and a reload, not a crash", async () => {
    const user = userEvent.setup();
    getMockDb().posts.find((p) => p.id === 3)!.lock_version = 5;
    server.use(http.get(`${API}/posts`, () => undefined));
    renderApp(<PostsList />);
    await screen.findByRole("table");
    // the list was read with lock_version 5; make the server move on after that
    const row = await rowOf("Unfinished trail notes");
    getMockDb().posts.find((p) => p.id === 3)!.lock_version = 6;
    await user.click(within(row).getByRole("button", { name: "Actions for Unfinished trail notes" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move to the trash" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Move to the trash" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Somebody else changed this post. The list was reloaded."));
  });

  it("'Create preview link' opens the preview dialog of that post", async () => {
    const user = userEvent.setup();
    renderApp(<PostsList />);
    await openMenu(user, "Unfinished trail notes");
    await user.click(await screen.findByRole("menuitem", { name: "Create preview link" }));
    const dialog = await screen.findByTestId("preview-link-dialog");
    expect(within(dialog).getByText(/see this post as it is now, before it is published/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Create link" }));
    const url = (await within(dialog).findByLabelText("Preview link")) as HTMLInputElement;
    expect(decodeURIComponent(url.value)).toContain("/blog/unfinished-trail-notes");
  });
});

describe("PostsList: New post", () => {
  useMockApi();

  it("creates a draft from a title (the server makes the slug), with the author shown as me, and opens the editor", async () => {
    const user = userEvent.setup();
    const seen: Array<{ body: unknown; key: string | null }> = [];
    server.use(http.post(`${API}/posts`, async ({ request }) => { seen.push({ body: await request.clone().json(), key: request.headers.get("Idempotency-Key") }); return undefined; }));
    renderApp(<PostsList />);
    await screen.findByRole("table");
    await user.click(screen.getAllByRole("button", { name: "New post" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New post" });
    expect(within(dialog).getByTestId("post-create-author")).toHaveTextContent("Noy Keomany (you)");
    await user.click(within(dialog).getByRole("button", { name: "Create post" }));
    expect(await within(dialog).findByText("Enter a title.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Title/), "Rainy Season Camp");
    await user.click(within(dialog).getByRole("combobox", { name: "Category" }));
    await user.click(await screen.findByRole("option", { name: "Camping" }));
    await user.click(within(dialog).getByRole("button", { name: "Create post" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/admin/blog/posts/9"));
    expect(seen).toHaveLength(1);
    expect(seen[0].body).toEqual({ translations: { la: { title: "Rainy Season Camp" } }, category_id: 2 });
    expect(seen[0].key).toMatch(/^[0-9a-f-]{36}$/);
    const made = getMockDb().posts.find((p) => p.id === 9)!;
    expect(made).toMatchObject({ status: "draft", created_by: { id: 6 } });
    expect(made.live.translations[0].slug).toBe("rainy-season-camp");
  });

  it("a person without `create` has no New post button", async () => {
    me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: grants({ "cms.blog": ["read", "update"] }) };
    renderApp(<PostsList />);
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "New post" })).not.toBeInTheDocument();
  });
});
