import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { RevisionsTab, type RevisionsTabProps } from "@/components/global/revisions/revisions-tab";
import { getMockDb } from "@/mocks/mock-db";
import { touchPageAsSomeoneElse } from "@/mocks/mock-pages";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { renderApp } from "@/test/render-app";

const API = "*/api/v1";
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/pages/9",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const lockOf = (id: number) => `"${getMockDb().pages.find((p) => p.id === id)!.lock_version}"`;

function renderTab(props: Partial<RevisionsTabProps> & { id?: number } = {}) {
  const onRestored = vi.fn();
  const { id = 9, ...rest } = props;
  const utils = renderApp(<RevisionsTab resource="pages" id={id} canRestore etag={lockOf(id)} onRestored={onRestored} {...rest} />);
  return { onRestored, ...utils };
}
const rowsOf = async () => (await screen.findAllByRole("row")).slice(1);

describe("RevisionsTab for a publishable page (SCR-37, doc/07 3.23, doc/05 12.8)", () => {
  useMockApi();

  it("lists the draft, every published version and the history, newest first; the live one is marked; preview rows are hidden", async () => {
    renderTab();
    const rows = await rowsOf();
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText("v5")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Draft")).toBeInTheDocument();
    expect(within(rows[1]).getByText("v3")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Published")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Live")).toBeInTheDocument();
    expect(within(rows[1]).getByText("added the intro")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Before edit")).toBeInTheDocument();
    expect(within(rows[3]).getByText("v1")).toBeInTheDocument();
    expect(within(rows[3]).queryByText("Live")).not.toBeInTheDocument(); // an older published version
    expect(screen.queryByText("v4")).not.toBeInTheDocument(); // the preview row
    expect(screen.getByRole("columnheader", { name: "Date" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "By" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Replaced on" })).not.toBeInTheDocument();
    expect(screen.getByText(/Restoring a version makes it the working draft/)).toBeInTheDocument();
  });

  it("the preview switch sends include_preview=true and shows the hidden row with a badge", async () => {
    const user = userEvent.setup();
    const seen: Array<string | null> = [];
    server.use(http.get(`${API}/pages/9/revisions`, ({ request }) => { seen.push(new URL(request.url).searchParams.get("include_preview")); return undefined; }));
    renderTab();
    await screen.findByText("v5");
    expect(seen[0]).toBeNull();
    await user.click(screen.getByRole("switch", { name: "Show preview rows" }));
    const row = (await screen.findByText("v4")).closest("tr") as HTMLElement;
    expect(within(row).getByText("preview", { selector: "[data-slot=badge]" })).toBeInTheDocument();
    expect(seen.at(-1)).toBe("true");
  });

  it("Restore is 'Restore as draft'; the working draft itself has no Restore button", async () => {
    renderTab();
    const rows = await rowsOf();
    expect(within(rows[0]).queryByRole("button", { name: /Restore/ })).not.toBeInTheDocument();
    expect(within(rows[1]).getByRole("button", { name: "Restore version 3 as draft" })).toHaveTextContent("Restore as draft");
    expect(within(rows[3]).getByRole("button", { name: "Restore version 1 as draft" })).toBeInTheDocument();
  });

  it("without the right to update there is no Restore at all", async () => {
    renderTab({ canRestore: false });
    await rowsOf();
    expect(screen.queryByRole("button", { name: /Restore/ })).not.toBeInTheDocument();
  });

  it("opening a row reads that one revision (GET /pages/9/revisions/{id}); a published row says who published it, the draft says who started it", async () => {
    const user = userEvent.setup();
    const reads: string[] = [];
    server.use(http.get(`${API}/pages/9/revisions/:revId`, ({ params }) => { reads.push(String(params.revId)); return undefined; }));
    renderTab();
    const rows = await rowsOf();
    await user.click(within(rows[1]).getByRole("button", { name: "View version 3" }));
    const dialog = await screen.findByRole("dialog", { name: /Version 3/ });
    expect(within(dialog).getByText(/Published on .* by Somchai Vongsa\./)).toBeInTheDocument();
    // the snapshot as labelled fields, not raw JSON
    await user.click(within(dialog).getByRole("tab", { name: "Fields" }));
    expect(await within(dialog).findByText("/events")).toBeInTheDocument();
    expect(reads).toHaveLength(2); // the version itself and the one it is compared with by default
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(within((await rowsOf())[0]).getByRole("button", { name: "View version 5" }));
    const draft = await screen.findByRole("dialog", { name: /Version 5/ });
    expect(within(draft).getByText(/The working draft, started on .* by Noy Keomany\./)).toBeInTheDocument();
    expect(within(draft).queryByRole("button", { name: /Restore/ })).not.toBeInTheDocument();
  });

  it("restore as draft: says it does not reach the website, sends If-Match + the note, hands the new ETag and the page to the host", async () => {
    const user = userEvent.setup();
    const seen: Array<{ ifMatch: string | null; body: unknown }> = [];
    server.use(http.post(`${API}/pages/9/revisions/:revId/restore`, async ({ request }) => { seen.push({ ifMatch: request.headers.get("If-Match"), body: await request.clone().json() }); return undefined; }));
    const { onRestored } = renderTab();
    const rows = await rowsOf();
    await user.click(within(rows[3]).getByRole("button", { name: "Restore version 1 as draft" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore version 1 as draft?" });
    expect(within(dialog).getByText("This becomes the working draft")).toBeInTheDocument();
    expect(within(dialog).getByText("It does not appear on the website until you publish it.")).toBeInTheDocument();
    expect(within(dialog).getByText("The draft you have now is kept in the history as a version you can restore.")).toBeInTheDocument();
    expect(within(dialog).getByText(/Version 1 was published on/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Note (optional)"), "back to the first");
    await user.click(within(dialog).getByRole("button", { name: "Restore version 1 as draft" }));
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
    expect(seen).toEqual([{ ifMatch: '"4"', body: { change_note: "back to the first" } }]);
    const result = onRestored.mock.calls[0][0];
    expect(result.etag).toBe('"5"');
    expect(result.data).toMatchObject({ title: "Events (old)", has_unpublished_changes: true, status: "published" });
    expect(result.restoredFrom).toMatchObject({ version: 1 });
    expect(toast.success).toHaveBeenCalledWith("Version 1 is the working draft now.");
    // the website still has the live text
    expect(getMockDb().pages.find((p) => p.id === 9)!.live.translations[0].title).toBe("Events");
    // the list shows the restore row
    expect(await screen.findByText("back to the first")).toBeInTheDocument();
  });

  it("restore of a version a newer schema wrote is explained and can not be confirmed", async () => {
    const user = userEvent.setup();
    getMockDb().revisions["pages/1"].find((r) => r.schema_version === 99)!.change_note = "from the future";
    const { onRestored } = renderTab({ id: 1 });
    const row = (await screen.findByText("from the future")).closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /^Restore version \d+ as draft$/ }));
    const dialog = await screen.findByRole("dialog", { name: /as draft\?$/ });
    await user.click(within(dialog).getByRole("button", { name: /^Restore version \d+ as draft$/ }));
    const issue = await within(dialog).findByTestId("restore-issue");
    expect(issue).toHaveTextContent("This version cannot be restored");
    expect(within(dialog).getByRole("button", { name: /^Restore version \d+ as draft$/ })).toBeDisabled();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("restore that points at a page that is gone is a 422 listing the field; nothing is applied", async () => {
    const user = userEvent.setup();
    const db = getMockDb();
    const first = db.revisions["pages/9"].find((r) => r.version === 1)!;
    (first.snapshot as unknown as { sections: Array<{ props: Record<string, unknown> }> }).sections[0].props.cta = { label: { la: "x" }, link: { type: "page", page_id: 7 } };
    const { onRestored } = renderTab();
    await user.click(within((await rowsOf())[3]).getByRole("button", { name: "Restore version 1 as draft" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore version 1 as draft?" });
    await user.click(within(dialog).getByRole("button", { name: "Restore version 1 as draft" }));
    const issue = await within(dialog).findByTestId("restore-issue");
    expect(issue).toHaveTextContent("Some of the data in this version no longer exists");
    expect(issue).toHaveTextContent("The selected item does not exist.");
    expect(onRestored).not.toHaveBeenCalled();
    expect(lockOf(9)).toBe('"4"');
  });

  it("a stale ETag opens the ConflictDialog and 'Load the latest version' refreshes the host", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const { onRestored } = renderTab({ onRefresh });
    await user.click(within((await rowsOf())[3]).getByRole("button", { name: "Restore version 1 as draft" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore version 1 as draft?" });
    touchPageAsSomeoneElse(getMockDb(), 9);
    await user.click(within(dialog).getByRole("button", { name: "Restore version 1 as draft" }));
    const conflict = await screen.findByRole("dialog", { name: "Someone else changed this item" });
    await user.click(within(conflict).getByRole("button", { name: "Load the latest version (discard my changes)" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("a read that ends in 403 is the no permission state, not a retry panel", async () => {
    server.use(http.get(`${API}/pages/9/revisions`, () => HttpResponse.json({ success: false, code: "FORBIDDEN", message: "no" }, { status: 403 })));
    renderTab();
    expect(await screen.findByText("No permission")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});

describe("RevisionsTab for a save-live entity is unchanged", () => {
  useMockApi();

  it("still says 'Replaced on' / 'Restore' and has no Live badge", async () => {
    renderApp(<RevisionsTab resource="categories" id={1} canRestore onRestored={vi.fn()} etag='"x"' />);
    await screen.findAllByRole("row");
    expect(screen.getByRole("columnheader", { name: "Replaced on" })).toBeInTheDocument();
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /as draft/ })).not.toBeInTheDocument();
  });
});
