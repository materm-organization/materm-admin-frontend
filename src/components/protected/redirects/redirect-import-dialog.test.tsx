import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RedirectImportDialog } from "@/components/protected/redirects/redirect-import-dialog";
import { getMockDb } from "@/mocks/mock-db";
import { importState } from "@/mocks/mock-redirects-import";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { renderApp } from "@/test/render-app";
import type { RedirectImportReport, RedirectImportRow } from "@/types/redirects";

const API = "*/api/v1";
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/redirects",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => {
  Object.values(toast).forEach((fn) => fn.mockReset());
  importState.unavailable = false;
});

const csv = (text: string, name = "redirects.csv") => new File([text], name, { type: "text/csv" });
async function open(file: File | null, onClose = vi.fn()) {
  const user = userEvent.setup();
  const view = renderApp(<RedirectImportDialog onClose={onClose} />);
  const dialog = await screen.findByRole("dialog");
  if (file) await user.upload(within(dialog).getByTestId("redirect-import-input"), file);
  return { user, dialog, onClose, ...view };
}
const check = async (u: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) => u.click(within(dialog).getByRole("button", { name: "Check file" }));

describe("RedirectImportDialog (doc/05 14.13)", () => {
  useMockApi();

  it("starts with no file: Check is disabled and the round-trip caveat is in the help text", async () => {
    const { dialog } = await open(null);
    expect(within(dialog).getByRole("button", { name: "Check file" })).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: /^Import \d/ })).toBeNull();
    expect(within(dialog).getByText(/The export has no language column/)).toBeInTheDocument();
  });

  it("runs a DRY RUN first (dry_run=true), shows the totals and rows, and Apply is enabled only for a valid file", async () => {
    const queries: string[] = [];
    server.use(http.post(`${API}/redirects/import`, ({ request }) => { queries.push(new URL(request.url).search); return undefined; }));
    const { user, dialog } = await open(csv("from,to,code\n/new,/n,308\n/old-blog,/posts,302\n/about,/our-path,302\n"));
    await check(user, dialog);
    const totals = await within(dialog).findByTestId("redirect-import-totals");
    expect(totals).toHaveTextContent("Rows3");
    expect(totals).toHaveTextContent("New1");
    expect(totals).toHaveTextContent("Updated1");
    expect(totals).toHaveTextContent("Unchanged1");
    expect(totals).toHaveTextContent("Errors0");
    expect(queries).toEqual(["?dry_run=true"]);
    const rows = within(dialog).getAllByTestId("redirect-import-row");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["created", "updated", "unchanged"]);
    // the updated row shows what it was
    expect(within(rows[1]).getByText("/blog (301)")).toBeInTheDocument();
    expect(await within(dialog).findByRole("button", { name: "Import 2 changes" })).toBeEnabled();
    // nothing has been written by the dry run
    expect(getMockDb().redirects.some((r) => r.source_path === "/new")).toBe(false);
  });

  it("a file with errors: errors first, translated from code + params, Apply stays hidden / disabled, cells are plain text", async () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const { user, dialog } = await open(csv(`from,to,code\n/ok,/fine,301\n/dup,/x,301\n/dup,/y,301\n=HYPERLINK("http://x"),/x,301\n/h,http://insecure.example,301\n/w,/z\n${hostile},/x,301\n`));
    await check(user, dialog);
    await within(dialog).findByTestId("redirect-import-totals");
    const rows = within(dialog).getAllByTestId("redirect-import-row");
    // the default filter shows the rows with errors
    expect(rows.every((r) => r.getAttribute("data-status") === "error")).toBe(true);
    expect(within(dialog).getByText('The same "from" is already on line 3.')).toBeInTheDocument();
    expect(within(dialog).getByText(/starts with = \+ - or @/)).toBeInTheDocument();
    expect(within(dialog).getByText("Only https:// addresses are allowed, not http://.")).toBeInTheDocument();
    expect(within(dialog).getByText(/must have exactly 3 columns/)).toBeInTheDocument();
    expect(within(dialog).getByText("The old address must start with /.")).toBeInTheDocument();
    // echoed as text, never as markup
    expect(dialog.querySelector("img")).toBeNull();
    expect(within(dialog).getByText(hostile)).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("rows have errors");
    expect(within(dialog).getByRole("button", { name: /^Import \d/ })).toBeDisabled();
  });

  it("Apply re-sends the same file with dry_run=false, toasts the totals, refreshes and closes", async () => {
    const queries: string[] = [];
    server.use(http.post(`${API}/redirects/import`, ({ request }) => { queries.push(new URL(request.url).search); return undefined; }));
    const { user, dialog, onClose, queryClient } = await open(csv("from,to,code\n/new,/n,308\n/old-blog,/posts,302\n"));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await check(user, dialog);
    await user.click(await within(dialog).findByRole("button", { name: "Import 2 changes" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(queries).toEqual(["?dry_run=true", "?dry_run=false"]);
    expect(toast.success).toHaveBeenCalledWith("Imported: 1 new, 1 updated, 0 unchanged.");
    expect(getMockDb().redirects.find((r) => r.source_path === "/new")?.status_code).toBe(308);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/redirects"] });
  });

  it("choosing another file drops the old report and its Apply button", async () => {
    const { user, dialog } = await open(csv("from,to,code\n/new,/n,308\n"));
    await check(user, dialog);
    await within(dialog).findByTestId("redirect-import-report");
    await user.upload(within(dialog).getByTestId("redirect-import-input"), csv("from,to,code\n/other,/o,301\n", "second.csv"));
    expect(within(dialog).queryByTestId("redirect-import-report")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /^Import \d/ })).toBeNull();
    expect(within(dialog).getByText("second.csv")).toBeInTheDocument();
  });

  it("a 422 on the real import carries the full report in details.report: it is shown as refused and nothing is written", async () => {
    const report: RedirectImportReport = {
      dry_run: false, valid: false, applied: false,
      totals: { rows: 2, created: 1, updated: 0, unchanged: 0, errors: 1 },
      rows: [
        { row: 2, from: "/ok", to: "/fine", code: "301", status: "created", id: null, previous: null, errors: [], warnings: [] },
        { row: 3, from: "/a", to: "/b", code: "301", status: "error", id: null, previous: null, errors: [{ field: "to", code: "redirect_loop", message: "loop", params: { path: ["/a", "/b", "/a"], locale: "" } }], warnings: [] },
      ],
    };
    server.use(
      http.post(`${API}/redirects/import`, ({ request }) => {
        if (new URL(request.url).searchParams.get("dry_run") !== "false") return undefined;
        return HttpResponse.json({ success: false, code: "VALIDATION_FAILED", message: "x", request_id: "r", errors: [{ in: "body", path: "/file", code: "has_errors", params: { errors: 1 } }], details: { report } }, { status: 422 });
      })
    );
    const before = getMockDb().redirects.length;
    const { user, dialog, onClose } = await open(csv("from,to,code\n/ok,/fine,301\n/c,/d,301\n"));
    await check(user, dialog);
    await user.click(await within(dialog).findByRole("button", { name: "Import 2 changes" }));
    expect(await within(dialog).findByText("The import was refused")).toBeInTheDocument();
    expect(within(dialog).getByText("This makes a loop: /a > /b > /a.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(getMockDb().redirects).toHaveLength(before);
    expect(within(dialog).getByRole("button", { name: /^Import \d/ })).toBeDisabled();
  });

  it.each([
    ["an empty file", "", /The file is empty/],
    ["a wrong header", "a,b,c\n/x,/y,301\n", /must be exactly: from,to,code/],
    ["only a header", "from,to,code\n", /header but no rows/],
    ["broken quotes", 'from,to,code\n"/a,/b,301\n', /near line 2/],
  ])("file-level 422: %s", async (_name, content, message) => {
    const { user, dialog } = await open(csv(content));
    await check(user, dialog);
    expect(await within(dialog).findByTestId("redirect-import-failure")).toHaveTextContent(message);
    expect(within(dialog).queryByTestId("redirect-import-report")).toBeNull();
  });

  it("415 for a file that is not a UTF-8 CSV, 413 from the server, and a client refusal over 8 MB before any request", async () => {
    const { user, dialog } = await open(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 1])], "a.csv", { type: "text/csv" }));
    await check(user, dialog);
    expect(await within(dialog).findByTestId("redirect-import-failure")).toHaveTextContent("not a UTF-8 CSV");

    server.use(http.post(`${API}/redirects/import`, () => HttpResponse.json({ success: false, code: "PAYLOAD_TOO_LARGE", message: "x", request_id: "r", details: { reason: "file_too_large", max_bytes: 8388608 } }, { status: 413 })));
    await user.upload(within(dialog).getByTestId("redirect-import-input"), csv("from,to,code\n/a,/b,301\n"));
    await check(user, dialog);
    expect(await within(dialog).findByTestId("redirect-import-failure")).toHaveTextContent("larger than 8 MB");

    let requests = 0;
    server.use(http.post(`${API}/redirects/import`, () => { requests += 1; return undefined; }));
    await user.upload(within(dialog).getByTestId("redirect-import-input"), new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.csv", { type: "text/csv" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("larger than 8 MB");
    expect(within(dialog).getByRole("button", { name: "Check file" })).toBeDisabled();
    expect(requests).toBe(0);
  });

  it("429 shows the wait from Retry-After and 503 says the import is unavailable (inline, the global toast is not in this render)", async () => {
    server.use(http.post(`${API}/redirects/import`, () => HttpResponse.json({ success: false, code: "RATE_LIMITED", message: "x", request_id: "r" }, { status: 429, headers: { "Retry-After": "1800" } })));
    const { user, dialog } = await open(csv("from,to,code\n/a,/b,301\n"));
    await check(user, dialog);
    expect(await within(dialog).findByTestId("redirect-import-failure")).toHaveTextContent("Try again in about 30 minute(s)");

    server.use(http.post(`${API}/redirects/import`, () => HttpResponse.json({ success: false, code: "SERVICE_UNAVAILABLE", message: "x", request_id: "r" }, { status: 503, headers: { "Retry-After": "30" } })));
    await check(user, dialog);
    await waitFor(() => expect(within(dialog).getByTestId("redirect-import-failure")).toHaveTextContent("not available right now"));
  });

  it("a report of 50,000 rows renders one page of 100 rows, never all of them, and pages through", async () => {
    const rows: RedirectImportRow[] = Array.from({ length: 50_000 }, (_v, i) => ({
      row: i + 2, from: `/p${i}`, to: "/t", code: "301", status: "created", id: null, previous: null, errors: [], warnings: [],
    }));
    const report: RedirectImportReport = { dry_run: true, valid: true, applied: false, totals: { rows: 50_000, created: 50_000, updated: 0, unchanged: 0, errors: 0 }, rows };
    server.use(http.post(`${API}/redirects/import`, () => HttpResponse.json({ success: true, data: report })));
    const { user, dialog } = await open(csv("from,to,code\n/a,/b,301\n"));
    await check(user, dialog);
    await within(dialog).findByTestId("redirect-import-report");
    expect(within(dialog).getAllByTestId("redirect-import-row")).toHaveLength(100);
    expect(within(dialog).getByTestId("redirect-import-range")).toHaveTextContent("1-100 of 50,000");
    expect(within(dialog).getByText("/p99")).toBeInTheDocument();
    expect(within(dialog).queryByText("/p100")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Next rows" }));
    expect(within(dialog).getAllByTestId("redirect-import-row")).toHaveLength(100);
    expect(within(dialog).getByTestId("redirect-import-range")).toHaveTextContent("101-200 of 50,000");
    expect(within(dialog).getByText("/p100")).toBeInTheDocument();
  }, 30000);
});
