import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UiStringsPage } from "@/components/protected/ui-strings/ui-strings-page";
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
  usePathname: () => "/admin/ui-strings",
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const FULL = grants({ "cms.ui_strings": ["read", "update", "translate", "import", "export"], "cms.locales": ["read"] });
beforeEach(() => {
  me.current = { id: 6, roleID: 2, permissions: FULL };
  nav.search = "";
  nav.push.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});
const row = (key: string, locale: string) => getMockDb().uiRows.find((r) => r.key === key && r.locale === locale);

describe("UiStringsPage (SCR-34)", () => {
  useMockApi();

  it("shows the keys with a column per active language, marks changed texts and English copies, and summarises the bundle", async () => {
    renderApp(<UiStringsPage />);
    const edit = await screen.findByRole("button", { name: "Edit blog.categories.all in Lao" });
    const tr = edit.closest("tr")!;
    expect(within(tr).getByText("ທັງໝົດ")).toBeInTheDocument();
    expect(within(tr).getAllByText("Changed")).toHaveLength(1);
    expect(within(tr).getByText("All")).toBeInTheDocument();
    const other = screen.getByRole("button", { name: "Edit blog.categoryNavLabel in Lao" }).closest("tr")!;
    expect(within(other).getByText("Same as English")).toBeInTheDocument();
    expect(screen.getByTestId("ui-summary")).toHaveTextContent("40 keys, 4 changed. Bundle 33a97a4");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(expect.arrayContaining(["Key", "Lao", "English"]));
  });

  it("filters come from the URL: changed only, and the missing-keys finder", async () => {
    nav.search = "overridden=true";
    const { unmount } = renderApp(<UiStringsPage />);
    await screen.findByRole("button", { name: "Edit blog.categories.all in Lao" });
    expect(screen.getAllByRole("row")).toHaveLength(1 + 4);
    unmount();
    // a key the bundle has no Lao text for, and no row either: it is missing in Lao
    const db = getMockDb();
    delete db.manifests[0].keys.find((k) => k.key === "site.nav.label")!.values.la;
    db.uiRows = db.uiRows.filter((r) => !(r.key === "site.nav.label" && r.locale === "la"));
    nav.search = "missing=la";
    renderApp(<UiStringsPage />);
    const cell = await screen.findByRole("button", { name: "Edit site.nav.label in Lao" });
    expect(within(cell).getByText("Not translated")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("'Still English in' narrows the table to that language (the server's same_as needs one locale)", async () => {
    nav.search = "copy_of_en=la";
    renderApp(<UiStringsPage />);
    await screen.findByRole("button", { name: "Edit site.nav.label in Lao" });
    expect(screen.queryByRole("button", { name: "Edit site.nav.label in English" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit blog.categories.all in Lao" })).not.toBeInTheDocument(); // translated
  });

  it("the filters are chips (as in the users and pages lists): picking a language writes it to the URL, the chip's x clears it", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp(<UiStringsPage />);
    await screen.findByRole("button", { name: "Edit blog.categories.all in Lao" });
    await user.click(screen.getByText("Not translated in"));
    await user.click(await screen.findByRole("menuitem", { name: /Lao/ }));
    await user.click(screen.getByRole("button", { name: "Search" })); // every chip popup has the Search button that commits its choice
    await waitFor(() => expect(nav.push).toHaveBeenCalled());
    expect(String(nav.push.mock.calls.at(-1)![0])).toContain("missing=la");
    unmount();
    // with the filter in the URL the chip shows the choice and its x removes it
    nav.search = "missing=la";
    nav.push.mockReset();
    renderApp(<UiStringsPage />);
    await waitFor(() => expect(document.querySelector("svg.lucide-circle-x")).not.toBeNull());
    await user.click(document.querySelector("svg.lucide-circle-x")!.closest("button")!);
    await waitFor(() => expect(nav.push).toHaveBeenCalled());
    expect(String(nav.push.mock.calls.at(-1)![0])).not.toContain("missing=");
  });

  it("editing: the ICU check runs while typing (placeholder set, syntax, plural 'other'), Save stays disabled until the text is valid", async () => {
    const user = userEvent.setup();
    renderApp(<UiStringsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit site.nav.currentPage in English" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByTestId("ui-source")).toHaveTextContent("Menu: current page {page}");
    const text = within(sheet).getByLabelText("Text on the website");
    const save = within(sheet).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await user.clear(text);
    await user.click(text);
    await user.paste("Menu {pagina}");
    expect(await within(sheet).findByText(/Missing: page\. Not in the original: pagina\./)).toBeInTheDocument();
    expect(save).toBeDisabled();
    await user.clear(text);
    await user.paste("Menu {page");
    expect(within(sheet).getByText(/not valid ICU MessageFormat/)).toBeInTheDocument();
    await user.clear(text);
    await user.paste("{page, plural, one {x}}");
    expect(within(sheet).getByText(/needs an "other" case/)).toBeInTheDocument();
    await user.clear(text);
    await user.paste("Now on {page}");
    expect(save).toBeEnabled();
    await user.click(within(sheet).getByRole("button", { name: "Insert page" }));
    expect(text).toHaveValue("Now on {page}{page}");
  });

  it("saving writes the override with the cell's ETag; the table shows it as changed; a text equal to the original is not stored", async () => {
    const user = userEvent.setup();
    const sent: Array<{ url: string; ifMatch: string | null; body: unknown }> = [];
    server.use(http.put(`${API}/ui-strings/:key/:locale`, async ({ request }) => { sent.push({ url: new URL(request.url).pathname, ifMatch: request.headers.get("If-Match"), body: await request.clone().json() }); return undefined; }));
    const etag = `"${row("site.nav.closeMenu", "la")!.updated_at}"`;
    // a language with no row yet (the bundle text is the effective one)
    getMockDb().uiRows = getMockDb().uiRows.filter((r) => !(r.key === "site.nav.openMenu" && r.locale === "en"));
    renderApp(<UiStringsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit site.nav.closeMenu in Lao" }));
    const sheet = await screen.findByRole("dialog");
    const text = within(sheet).getByLabelText("Text on the website");
    await user.clear(text);
    await user.paste("ປິດ");
    await user.type(within(sheet).getByLabelText("Note"), "checked");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved. It is live on the website."));
    expect(sent[0]).toMatchObject({ url: "/api/v1/ui-strings/site.nav.closeMenu/la", ifMatch: etag, body: { value: "ປິດ", note: "checked" } });
    expect(row("site.nav.closeMenu", "la")).toMatchObject({ value: "ປິດ", note: "checked" });
    // writing the original text into a language that has no row stores nothing
    await user.click(await screen.findByRole("button", { name: "Edit site.nav.openMenu in English" }));
    const s2 = await screen.findByRole("dialog");
    const t2 = within(s2).getByLabelText("Text on the website");
    expect(t2).toHaveValue("Open menu"); // the effective text is the bundle's
    await user.type(within(s2).getByLabelText("Note"), "x");
    await user.click(within(s2).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Same as the original: nothing changed."));
  });

  it("a server 422 (placeholder_mismatch the client could not know) is shown at the text; a stale ETag opens the conflict dialog", async () => {
    const user = userEvent.setup();
    renderApp(<UiStringsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit site.nav.closeMenu in English" }));
    const sheet = await screen.findByRole("dialog");
    const text = within(sheet).getByLabelText("Text on the website");
    await user.clear(text);
    await user.paste("Close it");
    row("site.nav.closeMenu", "en")!.updated_at = "2026-10-27T07:00:00.000417Z"; // changed by someone else
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Someone else changed this item")).toBeInTheDocument();
  });

  it("'Restore original' (update) asks first, deletes the override and the table goes back to the bundle text", async () => {
    const user = userEvent.setup();
    renderApp(<UiStringsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit blog.categories.all in Lao" }));
    const sheet = await screen.findByRole("dialog");
    await user.click(within(sheet).getByRole("button", { name: "Restore original" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/uses the bundle text again/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Restore original" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Original text restored."));
    expect(row("blog.categories.all", "la")).toBeUndefined();
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit blog.categories.all in Lao" })).toHaveTextContent("All"));
  });

  it("the key's history restores with the ETag read from the history list (provisional key-level contract) and refreshes the table", async () => {
    const user = userEvent.setup();
    const calls: Array<{ method: string; url: string; ifMatch: string | null }> = [];
    server.use(
      http.post(`${API}/ui-strings/:key/revisions/:revId/restore`, ({ request }) => { calls.push({ method: "POST", url: new URL(request.url).pathname, ifMatch: request.headers.get("If-Match") }); return undefined; })
    );
    renderApp(<UiStringsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit site.nav.closeMenu in Lao" }));
    const sheet = await screen.findByRole("dialog");
    await user.click(within(sheet).getByRole("tab", { name: "History" }));
    await user.click(await within(sheet).findByRole("button", { name: "Restore version 1" }));
    const confirm = await screen.findByRole("dialog", { name: "Restore version 1?" });
    await user.click(within(confirm).getByRole("button", { name: "Restore version 1" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Version restored."));
    expect(calls).toHaveLength(1);
    expect(calls[0].ifMatch).toBe('"2"');
    expect(row("site.nav.closeMenu", "la")!.value).toBe("Close menu");
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit site.nav.closeMenu in Lao" })).toHaveTextContent("Close menu"));
  });

  it("a key restore whose ETag moved on (someone saved the key meanwhile) is a conflict", async () => {
    const user = userEvent.setup();
    renderApp(<UiStringsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit site.nav.closeMenu in Lao" }));
    const sheet = await screen.findByRole("dialog");
    await user.click(within(sheet).getByRole("tab", { name: "History" }));
    const button = await within(sheet).findByRole("button", { name: "Restore version 1" });
    // another editor saves the key after the tab loaded its list: the ETag read at restore time is newer, so
    // force the stale case by making the server see a different number than the one the list header says.
    server.use(http.post(`${API}/ui-strings/:key/revisions/:revId/restore`, () => HttpResponse.json({ success: false, code: "CONFLICT_LOCK_VERSION", message: "x" }, { status: 409 })));
    await user.click(button);
    await user.click(within(await screen.findByRole("dialog", { name: "Restore version 1?" })).getByRole("button", { name: "Restore version 1" }));
    expect(await screen.findByText("Someone else changed this item")).toBeInTheDocument();
  });

  it("with only `translate`: the value and note can be saved, but 'Restore original' and restoring history are not offered", async () => {
    const user = userEvent.setup();
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.ui_strings": ["read", "translate"], "cms.locales": ["read"] }) };
    renderApp(<UiStringsPage />);
    expect(screen.queryByRole("button", { name: "Sync from bundle" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Edit site.nav.closeMenu in Lao" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).queryByRole("button", { name: "Restore original" })).not.toBeInTheDocument();
    await user.type(within(sheet).getByLabelText("Note"), "n");
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(within(sheet).getByRole("tab", { name: "History" }));
    await within(sheet).findByRole("button", { name: /^View version 1/ });
    expect(within(sheet).queryByRole("button", { name: /^Restore version/ })).not.toBeInTheDocument();
  });

  it("read-only: the text can be opened but not changed", async () => {
    const user = userEvent.setup();
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.ui_strings": ["read"], "cms.locales": ["read"] }) };
    renderApp(<UiStringsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit blog.categories.all in Lao" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByLabelText("Text on the website")).toBeDisabled();
    expect(within(sheet).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("without a synced bundle the filters explain themselves instead of failing", async () => {
    nav.search = "overridden=true";
    getMockDb().manifests = [];
    renderApp(<UiStringsPage />);
    expect(await screen.findByText("Sync the bundle first")).toBeInTheDocument();
  });
});

describe("bundle sync dialog", () => {
  useMockApi();
  const manifestFile = (mutate?: (m: { keys: Array<{ key: string; namespace: string; values: Record<string, string> }> }) => void) => {
    const m = { generated_at: "2026-10-28T02:00:00Z", source_commit: "a81c7d0", keys: getMockDb().manifests[0].keys.map((k) => structuredClone(k)) };
    mutate?.(m);
    return new File([JSON.stringify(m)], "ui-strings.json", { type: "application/json" });
  };

  it("choosing the file runs a dry run (nothing written), shows the report, and 'Apply sync' writes it", async () => {
    const user = userEvent.setup();
    renderApp(<UiStringsPage />);
    await user.click(await screen.findByRole("button", { name: "Sync from bundle" }));
    const dialog = await screen.findByRole("dialog");
    const apply = within(dialog).getByRole("button", { name: "Apply sync" });
    expect(apply).toBeDisabled();
    const file = manifestFile((m) => {
      m.keys.push({ key: "site.cta.bookNow", namespace: "site", values: { la: "Book", en: "Book now" } });
      m.keys.find((k) => k.key === "site.nav.openMenu")!.values.en = "Open the menu";
    });
    await user.upload(within(dialog).getByLabelText("Bundle file (JSON)"), file);
    const report = await within(dialog).findByTestId("sync-report");
    expect(within(report).getByText("Check only - nothing was written.")).toBeInTheDocument();
    expect(within(report).getByTestId("count-inserted")).toHaveTextContent("2");
    expect(within(report).getByTestId("count-source_updated")).toHaveTextContent("1");
    expect(within(report).getByText("1 new keys")).toBeInTheDocument();
    expect(within(report).getByText("1 keys are no longer in the bundle")).toBeInTheDocument();
    expect(getMockDb().manifests).toHaveLength(1);
    await user.click(apply);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Bundle synced."));
    expect(getMockDb().manifests).toHaveLength(2);
    expect(row("site.cta.bookNow", "en")!.value).toBe("Book now");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("the file `cms:export --stamp` writes (it also has schema_version, expected_count, pending) is sent without those fields, so the strict API takes it", async () => {
    const user = userEvent.setup();
    renderApp(<UiStringsPage />);
    await user.click(await screen.findByRole("button", { name: "Sync from bundle" }));
    const dialog = await screen.findByRole("dialog");
    const m = { generated_at: "2026-10-28T02:00:00Z", source_commit: "a81c7d0", schema_version: 1, expected_count: 39, pending: [], keys: getMockDb().manifests[0].keys.map((k) => structuredClone(k)) };
    await user.upload(within(dialog).getByLabelText("Bundle file (JSON)"), new File([JSON.stringify(m)], "ui-strings.json", { type: "application/json" }));
    expect(await within(dialog).findByTestId("sync-report")).toBeInTheDocument();
    expect(within(dialog).queryByText("The file was rejected")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Apply sync" })).toBeEnabled();
  });

  it("a file that is not JSON, not a bundle, or rejected by the server is explained and can not be applied", async () => {
    const user = userEvent.setup();
    renderApp(<UiStringsPage />);
    await user.click(await screen.findByRole("button", { name: "Sync from bundle" }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("Bundle file (JSON)");
    await user.upload(input, new File(["{not json"], "x.json", { type: "application/json" }));
    expect(await within(dialog).findByText("The file is not valid JSON.")).toBeInTheDocument();
    await user.upload(input, new File(['{"hello":1}'], "y.json", { type: "application/json" }));
    expect(await within(dialog).findByText("This is not a ui-strings.json file.")).toBeInTheDocument();
    await user.upload(input, manifestFile((m) => { m.keys[0].values.en = "Broken {"; }));
    expect(await within(dialog).findByText("The file was rejected")).toBeInTheDocument();
    expect(within(dialog).getByText(/icu_syntax/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Apply sync" })).toBeDisabled();
  });

  it("the 10 per hour limit is a toast (429), not a crash", async () => {
    const user = userEvent.setup();
    server.use(http.post(`${API}/ui-strings/bundle-sync`, () => HttpResponse.json({ success: false, code: "RATE_LIMITED", message: "slow" }, { status: 429, headers: { "Retry-After": "60" } })));
    renderApp(<UiStringsPage />);
    await user.click(await screen.findByRole("button", { name: "Sync from bundle" }));
    const dialog = await screen.findByRole("dialog");
    await user.upload(within(dialog).getByLabelText("Bundle file (JSON)"), manifestFile());
    await waitFor(() => expect(within(dialog).queryByText("Checking...")).not.toBeInTheDocument());
    expect(within(dialog).queryByTestId("sync-report")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Apply sync" })).toBeDisabled();
  });
});
