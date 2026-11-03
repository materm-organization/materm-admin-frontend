import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthorsPage } from "@/components/protected/authors/authors-page";
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
  usePathname: () => "/admin/blog/authors",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const BLOG_FULL = { "cms.blog": ["read", "create", "update", "delete", "translate"], "cms.locales": ["read"], "media.library": ["read"] };
const FULL = grants({ ...BLOG_FULL, "iam.users": ["read"] });
beforeEach(() => {
  me.current = { id: 6, roleID: 2, permissions: FULL };
  nav.search = "";
  Object.values(toast).forEach((fn) => fn.mockReset());
});
const authors = () => getMockDb().authors;
const names = () => within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent ?? "");

describe("AuthorsPage (SCR-27)", () => {
  useMockApi();

  it("lists the authors that are not in the trash, sorted by name", async () => {
    renderApp(<AuthorsPage />);
    await screen.findByRole("button", { name: "Edit Somchai Vongsa" });
    const first = names();
    expect(first).toHaveLength(3);
    expect(first[0]).toContain("Dara Phommachan");
    expect(first[1]).toContain("Mali Keo");
    expect(first[2]).toContain("Somchai Vongsa");
  });

  it("shows the job title, the linked account and the counts in each row; a switched-off author is marked", async () => {
    renderApp(<AuthorsPage />);
    await screen.findByRole("button", { name: "Edit Somchai Vongsa" });
    const row = (name: string) => within(screen.getByRole("table")).getAllByRole("row").find((r) => r.textContent?.includes(name) && r.querySelector("button"))!;
    expect(row("Somchai Vongsa")).toHaveTextContent("Editor in chief");
    expect(row("Somchai Vongsa")).toHaveTextContent("Somchai Vongsa (somchai)");
    expect(within(row("Somchai Vongsa")).getAllByRole("cell")[2]).toHaveTextContent("1 (1)");
    expect(row("Mali Keo")).toHaveTextContent("Switched off");
    expect(within(row("Mali Keo")).getAllByRole("cell")[1]).toHaveTextContent("-");
    expect(screen.queryByText("Old Contributor")).toBeNull();
  });

  it("filters by the URL state: switched off, and without an account", async () => {
    nav.search = "is_active=false";
    const { unmount } = renderApp(<AuthorsPage />);
    await screen.findByText("Mali Keo");
    expect(screen.queryByText("Somchai Vongsa")).toBeNull();
    unmount();
    nav.search = "has_user=false";
    renderApp(<AuthorsPage />);
    await screen.findByText("Mali Keo");
    expect(screen.queryByText("Dara Phommachan")).toBeNull();
  });

  it("a reader sees the table without any button", async () => {
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.blog": ["read"], "cms.locales": ["read"] }) };
    renderApp(<AuthorsPage />);
    await screen.findAllByText("Somchai Vongsa");
    expect(screen.queryByRole("button", { name: "New author" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
  });

  it("creates an author: the name is required, per-language texts are sent, empty languages are not", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(http.post(`${API}/authors`, async ({ request }) => { bodies.push(await request.clone().json()); return undefined; }));
    renderApp(<AuthorsPage />);
    await user.click(await screen.findByRole("button", { name: "New author" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Create author" }));
    expect(await within(dialog).findByText("This field is required.")).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
    await user.type(within(dialog).getByLabelText(/Display name/), "  Khamla Sisouk ");
    await user.type(within(dialog).getAllByLabelText("Job title")[1], "Guide");
    await user.click(within(dialog).getByRole("button", { name: "Create author" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Author created."));
    expect(bodies).toEqual([{ display_name: "Khamla Sisouk", is_active: true, translations: { en: { bio: null, job_title: "Guide" } } }]);
    expect(authors().find((a) => a.display_name === "Khamla Sisouk")?.translations).toEqual({ en: { bio: null, job_title: "Guide" } });
    expect(await screen.findByText("Khamla Sisouk")).toBeInTheDocument();
  });

  it("linking an account that already has an author is a 409 shown at the account field", async () => {
    const user = userEvent.setup();
    renderApp(<AuthorsPage />);
    await user.click(await screen.findByRole("button", { name: "New author" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Display name/), "Second Somchai");
    await user.click(within(dialog).getByRole("combobox", { name: "Sign-in account" }));
    await user.click(await screen.findByRole("option", { name: "Somchai Vongsa (somchai)" }));
    await user.click(within(dialog).getByRole("button", { name: "Create author" }));
    expect(await within(dialog).findByText("This account is already linked to another author.")).toBeInTheDocument();
    expect(authors().some((a) => a.display_name === "Second Somchai")).toBe(false);
    // another account is fine
    await user.click(within(dialog).getByRole("combobox", { name: "Sign-in account" }));
    await user.click(await screen.findByRole("option", { name: "Lao Editor (laoeditor)" }));
    await user.click(within(dialog).getByRole("button", { name: "Create author" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Author created."));
    expect(authors().find((a) => a.display_name === "Second Somchai")?.user_id).toBe(9);
  });

  it("without iam.users:read the account is shown, not chosen", async () => {
    const user = userEvent.setup();
    me.current = { id: 6, roleID: 2, permissions: grants(BLOG_FULL) };
    renderApp(<AuthorsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit Somchai Vongsa" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByTestId("author-user-readonly")).toHaveTextContent("Somchai Vongsa (somchai)");
    expect(within(dialog).queryByRole("combobox", { name: "Sign-in account" })).toBeNull();
  });

  it("edits with If-Match from the row's own GET and sends only the change (a cleared member is null)", async () => {
    const user = userEvent.setup();
    const seen: Array<{ body: unknown; ifMatch: string | null }> = [];
    server.use(http.patch(`${API}/authors/:id`, async ({ request }) => { seen.push({ body: await request.clone().json(), ifMatch: request.headers.get("If-Match") }); return undefined; }));
    renderApp(<AuthorsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit Somchai Vongsa" }));
    const dialog = await screen.findByRole("dialog");
    const name = await within(dialog).findByLabelText(/Display name/);
    await user.clear(name);
    await user.type(name, "Somchai V.");
    await user.clear(within(dialog).getAllByLabelText("Job title")[1]);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved."));
    expect(seen).toHaveLength(1);
    expect(seen[0].body).toEqual({ display_name: "Somchai V.", translations: { en: { job_title: null } } });
    expect(seen[0].ifMatch).toMatch(/^"\d{4}-\d{2}-\d{2}T[\d:.]+Z"$/);
    expect(authors()[0].display_name).toBe("Somchai V.");
  });

  it("a translator edits only the bio and job title of languages that are not the default one, and never deletes a language", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(http.patch(`${API}/authors/:id`, async ({ request }) => { bodies.push(await request.clone().json()); return undefined; }));
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.blog": ["read", "translate"], "cms.locales": ["read"] }) };
    renderApp(<AuthorsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit Somchai Vongsa" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Translation mode/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Display name/)).toBeDisabled();
    expect(within(dialog).getByRole("switch", { name: "Active" })).toBeDisabled();
    const [laJob, enJob] = within(dialog).getAllByLabelText("Job title");
    expect(laJob).toBeDisabled();
    expect(enJob).toBeEnabled();
    await user.clear(enJob);
    await user.type(enJob, "Editor");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved."));
    expect(bodies).toEqual([{ translations: { en: { job_title: "Editor" } } }]);
  });

  it("delete is blocked while posts use the author (409 author_has_posts): the dialog says how many and what to do", async () => {
    const user = userEvent.setup();
    renderApp(<AuthorsPage />);
    await user.click(await screen.findByRole("button", { name: "Delete Somchai Vongsa" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Move to trash" }));
    const dialog = await screen.findByTestId("author-has-posts");
    expect(within(dialog).getByText('"Somchai Vongsa" cannot be deleted')).toBeInTheDocument();
    expect(within(dialog).getByText("1 post still names this author.")).toBeInTheDocument();
    expect(within(dialog).getByText(/choose another author/)).toBeInTheDocument();
    expect(authors()[0].deleted_at).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Switch off instead" })).toBeInTheDocument();
  });

  it("an author without posts goes to the trash; the trash lists it and restores it (a taken account is explained)", async () => {
    const user = userEvent.setup();
    getMockDb().posts.find((p) => p.id === 2)!.live.post.author_id = null;
    const { unmount } = renderApp(<AuthorsPage />);
    await user.click(await screen.findByRole("button", { name: "Delete Dara Phommachan" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Move to trash" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Author moved to the trash."));
    expect(authors()[1].deleted_at).toBeTruthy();
    unmount();

    nav.search = "trashed=true";
    renderApp(<AuthorsPage />);
    expect((await screen.findAllByText("Dara Phommachan")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    // somebody links the same account to a new author meanwhile
    authors().push({ ...structuredClone(authors()[0]), id: 77, display_name: "Thief", user_id: 7, deleted_at: null });
    await user.click(screen.getByRole("button", { name: "Restore Dara Phommachan" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("It could not be restored: its account is linked to another author now."));
    authors().pop();
    await user.click(screen.getByRole("button", { name: "Restore Dara Phommachan" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Author restored."));
    expect(authors()[1].deleted_at).toBeNull();
  });

  it("the dialog has a Versions tab (restore with the row's ETag) and an Activity tab (the audit trail of cms.author)", async () => {
    const user = userEvent.setup();
    renderApp(<AuthorsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit Somchai Vongsa" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("tab", { name: "Activity" }));
    expect(await within(dialog).findByText("cms.author.created")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("tab", { name: "Versions" }));
    await user.click(await within(dialog).findByRole("button", { name: "Restore version 1" }));
    const confirm = await screen.findByRole("dialog", { name: "Restore version 1?" });
    await user.click(within(confirm).getByRole("button", { name: "Restore version 1" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Version restored."));
    expect(authors()[0].translations.la).toEqual({ bio: "Somchai writes.", job_title: "Writer" });
    expect(authors()[0].translations.en).toBeUndefined();
  });
});
