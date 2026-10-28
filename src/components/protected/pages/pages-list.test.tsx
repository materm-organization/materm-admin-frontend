import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PagesList } from "@/components/protected/pages/pages-list";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, roleID: 2, permissions: [] as PermissionGrant[] } }));
const nav = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/pages",
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const FULL = grants({ "cms.pages": ["read", "create", "update", "delete", "publish", "unpublish", "translate"], "cms.locales": ["read"] });
beforeEach(() => {
  me.current = { id: 6, roleID: 2, permissions: FULL };
  nav.search = "";
  nav.push.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
});

const rowOf = async (name: string) => {
  const table = await screen.findByRole("table");
  // The title is the first column, so the first match is the title (a template can have the same name).
  const cell = (await within(table).findAllByText(name))[0];
  return cell.closest("tr") as HTMLElement;
};
const openMenu = async (user: ReturnType<typeof userEvent.setup>, title: string) => {
  const row = await rowOf(title);
  await user.click(within(row).getByRole("button", { name: `Actions for ${title}` }));
};

describe("PagesList (SCR-19)", () => {
  useMockApi();

  it("lists the pages with title (a link to the page), address, template, status chip and language badges", async () => {
    renderApp(<PagesList />);
    const table = await screen.findByRole("table");
    await within(table).findByText("Events and treks");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(9); // the trashed page 7 is not listed
    const home = await rowOf("Home");
    expect(within(home).getByRole("img", { name: "Home page" })).toBeInTheDocument();
    expect(within(home).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/admin/pages/1");
    expect(within(home).getByText("/")).toBeInTheDocument();
    const events = await rowOf("Events and treks");
    expect(within(events).getByTestId("status-badge")).toHaveTextContent("Published, changes pending");
    expect(within(events).getByText("/events")).toBeInTheDocument();
    const spring = await rowOf("Spring campaign");
    expect(within(spring).getByTestId("status-badge")).toHaveTextContent("Draft only");
    // en has a title, SEO title and description; la has no SEO title
    expect(within(spring).getByLabelText("la: 2 texts missing")).toBeInTheDocument();
    expect(within(spring).getByLabelText("en: complete")).toBeInTheDocument();
    expect(screen.getByText("9 in total")).toBeInTheDocument();
  });

  it("filters come from the URL: status, pending changes, keyword", async () => {
    nav.search = "status=draft&keyword=summer";
    renderApp(<PagesList />);
    const table = await screen.findByRole("table");
    await within(table).findByText("Summer trek");
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(1);
  });

  it("the status filter writes the URL", async () => {
    const user = userEvent.setup();
    renderApp(<PagesList />);
    await screen.findByRole("table");
    // the pill is the "Status" button outside the column header
    await user.click(screen.getAllByRole("button", { name: /Status/ }).find((b) => !b.closest("th"))!);
    const list = await screen.findByRole("listbox");
    await user.click(within(list).getByText("Draft"));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/admin/pages?status=draft", { scroll: false }));
  });

  it("the trash switch shows the trash with its own columns and a Restore button", async () => {
    nav.search = "trashed=true";
    const user = userEvent.setup();
    const seen: Array<{ ifMatch: string | null }> = [];
    server.use(http.post(`${API}/pages/7/restore`, ({ request }) => { seen.push({ ifMatch: request.headers.get("If-Match") }); return undefined; }));
    renderApp(<PagesList />);
    const table = await screen.findByRole("table");
    expect(await within(table).findByText("Old promo")).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Deleted" })).toBeInTheDocument();
    expect(within(table).getByText(/Removed for good on/)).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore Old promo" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('"Old promo" was restored as a draft.'));
    expect(seen).toEqual([{ ifMatch: '"1"' }]);
    expect(getMockDb().pages.find((p) => p.id === 7)!.deleted_at).toBeNull();
  });

  it("a restore whose address was taken meanwhile says which value clashes", async () => {
    nav.search = "trashed=true";
    const user = userEvent.setup();
    getMockDb().pages.find((p) => p.id === 8)!.live.page.path = "/old-promo";
    renderApp(<PagesList />);
    await user.click(await screen.findByRole("button", { name: "Restore Old promo" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("It cannot be restored: the address is used by another page now."));
  });

  it("switching the trash on writes the URL (and the newest deletion first)", async () => {
    const user = userEvent.setup();
    renderApp(<PagesList />);
    await screen.findByRole("table");
    await user.click(screen.getByRole("switch", { name: "Show trash" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalled());
    const url = nav.push.mock.calls.at(-1)![0] as string;
    expect(url).toContain("trashed=true");
    expect(url).toContain("sort=-deleted_at");
  });

  it("a read-only user sees the list without New page, the trash switch or row actions that change anything", async () => {
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.pages": ["read"] }) };
    const user = userEvent.setup();
    renderApp(<PagesList />);
    await screen.findByRole("table");
    await rowOf("Team");
    expect(screen.queryByRole("button", { name: "New page" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Show trash" })).not.toBeInTheDocument();
    await openMenu(user, "Team");
    expect(await screen.findByRole("menuitem", { name: "Open" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Make home page" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Move to the trash" })).not.toBeInTheDocument();
  });

  it("a 403 on the list shows the no permission state, not an error with Retry", async () => {
    server.use(http.get(`${API}/pages`, () => HttpResponse.json({ success: false, code: "FORBIDDEN", message: "no" }, { status: 403 })));
    renderApp(<PagesList />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("an empty list says so and offers to create the first page", async () => {
    server.use(http.get(`${API}/pages`, () => HttpResponse.json({ success: true, data: [], meta: { total: 0, page: 1, limit: 20, total_page: 0 } })));
    renderApp(<PagesList />);
    expect(await screen.findByText("No pages yet.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New page" }).length).toBeGreaterThan(0);
  });
});

describe("PagesList: row actions (set home, delete)", () => {
  useMockApi();

  it("the home page and the system pages have no Delete; a draft page has no Make home page", async () => {
    const user = userEvent.setup();
    renderApp(<PagesList />);
    await openMenu(user, "Home");
    expect(await screen.findByRole("menuitem", { name: "Open" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Move to the trash" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Make home page" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    await openMenu(user, "Our Path"); // a system page
    expect(screen.queryByRole("menuitem", { name: "Move to the trash" })).not.toBeInTheDocument();
    expect(await screen.findByRole("menuitem", { name: "Make home page" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await openMenu(user, "Summer trek"); // a draft
    expect(await screen.findByRole("menuitem", { name: "Move to the trash" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Make home page" })).not.toBeInTheDocument();
  });

  it("Make home page: the old home's new address is offered, the request carries If-Match and an Idempotency-Key", async () => {
    const user = userEvent.setup();
    const seen: Array<{ ifMatch: string | null; key: string | null; body: string }> = [];
    server.use(
      http.post(`${API}/pages/10/set-home`, async ({ request }) => {
        seen.push({ ifMatch: request.headers.get("If-Match"), key: request.headers.get("Idempotency-Key"), body: await request.clone().text() });
        return undefined;
      })
    );
    renderApp(<PagesList />);
    await openMenu(user, "Team");
    await user.click(await screen.findByRole("menuitem", { name: "Make home page" }));
    const dialog = await screen.findByRole("dialog", { name: 'Make "Team" the home page?' });
    const input = await within(dialog).findByLabelText('New address of "Home"');
    await waitFor(() => expect(input).toHaveValue("/home"));
    await user.click(within(dialog).getByRole("button", { name: "Make home page" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('"Team" is the home page now.'));
    expect(seen).toHaveLength(1);
    expect(seen[0].ifMatch).toBe('"1"');
    expect(seen[0].key).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[0].body).toBe(""); // the default address is the server's
    expect(getMockDb().pages.find((p) => p.id === 10)!.live.page.path).toBe("/");
    expect(getMockDb().pages.find((p) => p.id === 1)!.live.page.path).toBe("/home");
  });

  it("Make home page: an edited address is sent, a taken one is explained in the dialog", async () => {
    const user = userEvent.setup();
    const bodies: string[] = [];
    server.use(http.post(`${API}/pages/10/set-home`, async ({ request }) => { bodies.push(await request.clone().text()); return undefined; }));
    renderApp(<PagesList />);
    await openMenu(user, "Team");
    await user.click(await screen.findByRole("menuitem", { name: "Make home page" }));
    const dialog = await screen.findByRole("dialog");
    const input = await within(dialog).findByLabelText('New address of "Home"');
    await waitFor(() => expect(input).toHaveValue("/home"));
    await user.clear(input);
    await user.type(input, "/events");
    await user.click(within(dialog).getByRole("button", { name: "Make home page" }));
    expect(await within(dialog).findByText("Another page already uses this address.")).toBeInTheDocument();
    expect(bodies[0]).toBe(JSON.stringify({ previous_home_path: "/events" }));
    await user.clear(input);
    await user.type(input, "/old-home");
    await user.click(within(dialog).getByRole("button", { name: "Make home page" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(getMockDb().pages.find((p) => p.id === 1)!.live.page.path).toBe("/old-home");
  });

  it("Delete of a page others link to: asks, the first request has no confirm_references, then lists who links and repeats with it", async () => {
    const user = userEvent.setup();
    const seen: Array<{ confirm: string | null; ifMatch: string | null }> = [];
    server.use(
      http.delete(`${API}/pages/9`, ({ request }) => {
        seen.push({ confirm: new URL(request.url).searchParams.get("confirm_references"), ifMatch: request.headers.get("If-Match") });
        return undefined;
      })
    );
    renderApp(<PagesList />);
    await openMenu(user, "Events and treks");
    await user.click(await screen.findByRole("menuitem", { name: "Move to the trash" }));
    const ask = await screen.findByRole("alertdialog");
    expect(within(ask).getByText("It is published, so it disappears from the website now.")).toBeInTheDocument();
    await user.click(within(ask).getByRole("button", { name: "Move to the trash" }));
    const refs = await screen.findByTestId("referenced-dialog");
    expect(within(refs).getByText('A link in a section of "Team"')).toBeInTheDocument();
    expect(seen).toEqual([{ confirm: null, ifMatch: '"4"' }]);
    await user.click(within(refs).getByRole("button", { name: "Move to the trash anyway" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('"Events and treks" is in the trash for 30 days.'));
    expect(toast.info).toHaveBeenCalledWith("Its unpublished changes were kept in the History tab.");
    expect(seen[1]).toEqual({ confirm: "true", ifMatch: '"4"' });
    expect(getMockDb().pages.find((p) => p.id === 9)!.deleted_at).not.toBeNull();
  });

  it("Delete of a page nobody links to goes straight to the trash; a stale row reloads the list", async () => {
    const user = userEvent.setup();
    renderApp(<PagesList />);
    await openMenu(user, "Summer trek");
    await user.click(await screen.findByRole("menuitem", { name: "Move to the trash" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Move to the trash" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('"Summer trek" is in the trash for 30 days.'));
    expect(screen.queryByTestId("referenced-dialog")).not.toBeInTheDocument();

    // somebody changes Team while the list is open: the row's ETag is stale
    getMockDb().pages.find((p) => p.id === 10)!.lock_version += 1;
    await openMenu(user, "Team");
    await user.click(await screen.findByRole("menuitem", { name: "Move to the trash" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Move to the trash" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This page was changed by someone else. The list was reloaded."));
  });
});

describe("PagesList: New page", () => {
  useMockApi();

  it("fills the address from the title until it is edited, sends the template, title and address with an Idempotency-Key, then opens the new page", async () => {
    const user = userEvent.setup();
    const seen: Array<{ key: string | null; body: unknown }> = [];
    server.use(
      http.post(`${API}/pages`, async ({ request }) => {
        seen.push({ key: request.headers.get("Idempotency-Key"), body: await request.clone().json() });
        return undefined;
      })
    );
    renderApp(<PagesList />);
    await user.click(await screen.findByRole("button", { name: "New page" }));
    const dialog = await screen.findByRole("dialog", { name: "New page" });
    // the default template is chosen, with its description and the sections it starts with
    expect(await within(dialog).findByRole("combobox", { name: "Template" })).toHaveTextContent("Standard");
    expect(within(dialog).getByTestId("template-summary")).toHaveTextContent("Starts with: Hero (brand)");
    expect(within(dialog).getByTestId("template-summary")).toHaveTextContent("Must have to publish: A hero section");

    const title = within(dialog).getByLabelText("Title (LA)");
    const path = within(dialog).getByLabelText("Address");
    await user.type(title, "Spring Trek 2027!");
    expect(path).toHaveValue("/spring-trek-2027");
    await user.clear(path);
    await user.type(path, "/trek");
    await user.type(title, " again");
    expect(path).toHaveValue("/trek"); // edited by hand: no longer follows the title

    await user.click(within(dialog).getByRole("button", { name: "Create page" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/admin/pages/11"));
    expect(seen).toHaveLength(1);
    expect(seen[0].key).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[0].body).toEqual({ template: "standard", path: "/trek", translations: { la: { title: "Spring Trek 2027! again" } } });
    expect(toast.success).toHaveBeenCalledWith("The page was created.");
    expect(getMockDb().pages.find((p) => p.id === 11)).toMatchObject({ status: "draft" });
  });

  it("the template choice shows its description and required sections", async () => {
    const user = userEvent.setup();
    renderApp(<PagesList />);
    await user.click(await screen.findByRole("button", { name: "New page" }));
    const dialog = await screen.findByRole("dialog", { name: "New page" });
    await user.click(await within(dialog).findByRole("combobox", { name: "Template" }));
    await user.click(await screen.findByRole("option", { name: "Contact" }));
    const summary = within(dialog).getByTestId("template-summary");
    expect(summary).toHaveTextContent("A hero, the contact details with the form, and an optional FAQ.");
    expect(summary).toHaveTextContent("Starts with: Hero (brand), Contact section");
    expect(summary).toHaveTextContent("Must have to publish: A hero section, Contact section");
  });

  it("checks title and address before sending (nothing is sent), naming the rule that is broken", async () => {
    const user = userEvent.setup();
    const posts: unknown[] = [];
    server.use(http.post(`${API}/pages`, () => { posts.push(1); return undefined; }));
    renderApp(<PagesList />);
    await user.click(await screen.findByRole("button", { name: "New page" }));
    const dialog = await screen.findByRole("dialog", { name: "New page" });
    await within(dialog).findByRole("combobox", { name: "Template" });
    await user.click(within(dialog).getByRole("button", { name: "Create page" }));
    expect(await within(dialog).findByText("Enter a title.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter an address.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Title (LA)"), "x");
    const path = within(dialog).getByLabelText("Address");
    await user.clear(path);
    await user.type(path, "/admin/x");
    expect(await within(dialog).findByText("This address is reserved by the system.")).toBeInTheDocument();
    await user.clear(path);
    await user.type(path, "/blog/x");
    expect(await within(dialog).findByText("Addresses under /blog/ belong to blog posts.")).toBeInTheDocument();
    await user.clear(path);
    await user.type(path, "/");
    expect(await within(dialog).findByText(/The address \/ belongs to the home page/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Create page" }));
    expect(posts).toEqual([]);
  });

  it("an address another page uses is a 409 shown at the field", async () => {
    const user = userEvent.setup();
    renderApp(<PagesList />);
    await user.click(await screen.findByRole("button", { name: "New page" }));
    const dialog = await screen.findByRole("dialog", { name: "New page" });
    await within(dialog).findByRole("combobox", { name: "Template" });
    await user.type(within(dialog).getByLabelText("Title (LA)"), "Team");
    await user.click(within(dialog).getByRole("button", { name: "Create page" }));
    expect(await within(dialog).findByText("Another page already uses this address.")).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("without cms.pages:create there is no New page button", async () => {
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.pages": ["read"] }) };
    renderApp(<PagesList />);
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "New page" })).not.toBeInTheDocument();
  });
});
