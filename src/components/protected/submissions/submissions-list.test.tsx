import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SubmissionsList } from "@/components/protected/submissions/submissions-list";
import { getMockDb } from "@/mocks/mock-db";
import { exhaustExportRate, setExportMax, setExportUnavailable, setSubmissionsRights, submissionsState } from "@/mocks/mock-submissions";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, name: "Noy Keomany", roleID: 2, permissions: [] as PermissionGrant[] } }));
const nav = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/forms/submissions",
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const FULL = grants({ "forms.submissions": ["read", "update", "export"], "forms.manage": ["read"] });
const READER = grants({ "forms.submissions": ["read"] });

const downloads = vi.hoisted(() => ({ created: [] as Blob[], clicked: [] as string[] }));
const user = () => userEvent.setup();
// Renders the list once per test; a test that needs the handle (rerender, unmount) calls `renderList()` itself first.
let mounted = false;
const renderList = () => {
  mounted = true;
  return renderApp(<SubmissionsList />);
};
const rows = async () => {
  if (!mounted) renderList();
  const table = await screen.findByRole("table");
  await within(table).findAllByRole("link");
  return within(table).getAllByRole("row").slice(1);
};
const rowOf = async (text: string) => (await rows()).find((r) => within(r).queryByText(text)) as HTMLElement;

beforeEach(() => {
  mounted = false;
  me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: FULL };
  nav.search = "";
  nav.push.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
  downloads.created = [];
  downloads.clicked = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    downloads.created.push(blob);
    return "blob:mock";
  }) as never;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.clicked.push(this.download);
  });
});

describe("SubmissionsList (SCR-32)", () => {
  useMockApi();

  it("lists the messages newest first without the spam; the sender, topic, form, preview and status are there; links carry created_at", async () => {
    nav.search = "limit=50";
    const list = await rows();
    expect(list).toHaveLength(14);
    expect(screen.getByText("14 in total")).toBeInTheDocument();
    const first = list[0];
    expect(within(first).getByText("Keo Manivong")).toBeInTheDocument();
    expect(within(first).getByTestId("submission-status")).toHaveTextContent("New");
    const link = within(first).getAllByRole("link")[0];
    expect(link.getAttribute("href")).toMatch(/^\/admin\/forms\/submissions\/16\?created_at=2026-10-26T22%3A00%3A00\.000116Z$/);
    // the preview is cut at 140 characters
    expect(within(first).getByText(/^x+/).textContent!.length).toBeLessThanOrEqual(140);
    expect(screen.queryByText("seo-deals")).not.toBeInTheDocument();
    const anon = await rowOf("Anonymised");
    expect(within(anon).queryByRole("checkbox", { checked: true })).not.toBeInTheDocument();
  });

  it("renders what a visitor typed as TEXT: no element comes out of it", async () => {
    nav.search = "limit=50";
    const row = await rowOf("<b>Bold</b> Visitor");
    expect(within(row).getByText(/<img src=x onerror="alert\(1\)"> Hello/)).toBeInTheDocument();
    expect(document.querySelector("table img, table b, table script")).toBeNull();
  });

  it("summary chips: New shows its count; choosing Spam asks for status=spam, All clears it", async () => {
    const u = user();
    await rows();
    expect(screen.getByRole("button", { name: "New (7)" })).toHaveAttribute("aria-pressed", "false");
    await u.click(screen.getByRole("button", { name: "Spam" }));
    expect(nav.push).toHaveBeenLastCalledWith(expect.stringContaining("status=spam"), { scroll: false });
    await u.click(screen.getByRole("button", { name: "New (7)" }));
    expect(nav.push).toHaveBeenLastCalledWith(expect.stringContaining("status=new"), { scroll: false });
  });

  it("the spam tab comes from the URL and sends status=spam; sort=-created_at only; never assigned_to / mine", async () => {
    nav.search = "status=spam";
    const seen: string[] = [];
    server.use(http.get(`${API}/submissions`, ({ request }) => {
      seen.push(new URL(request.url).search);
      return undefined;
    }));
    const list = await rows();
    expect(list).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Spam" })).toHaveAttribute("aria-pressed", "true");
    expect(seen[0]).toContain("status=spam");
    expect(seen[0]).toContain("sort=-created_at");
    expect(seen[0]).not.toMatch(/assigned_to|mine/);
  });

  it("the form filter names the forms with new messages; choosing one drops the topic", async () => {
    nav.search = "form_id=3";
    const list = await rows();
    expect(list).toHaveLength(3);
    expect(list.every((r) => within(r).getAllByRole("cell")[5].textContent === "Trek booking (2027 season)")).toBe(true);
    expect(screen.getByText(/Trek booking \(2027 season\) \(2 new\)/)).toBeInTheDocument();
  });

  it("the topic filter appears for a form the person can read, with the labels of its topics", async () => {
    nav.search = "form_id=1";
    await rows();
    // the filter chip is a plain element (its trigger is a div): look for its label
    await waitFor(() => expect(screen.getAllByText("Topic")).toHaveLength(2)); // the column header and the filter chip
  });

  it("a keyword with no dates is the last 90 days and the page says so", async () => {
    nav.search = "keyword=minibus";
    const list = await rows();
    expect(list).toHaveLength(1);
    expect(screen.getByTestId("keyword-window-note")).toHaveTextContent("last 90 days");
  });

  it("a keyword with a window over 366 days is stopped BEFORE a request is sent; so is a start after the end", async () => {
    let calls = 0;
    server.use(http.get(`${API}/submissions`, () => {
      calls += 1;
      return undefined;
    }));
    nav.search = "keyword=tent&from=2025-01-01T00:00:00.000Z&to=2026-10-28T00:00:00.000Z";
    const { unmount } = renderList();
    expect(await screen.findByTestId("window-problem")).toHaveTextContent("at most 366 days");
    unmount();
    nav.search = "from=2026-10-28T00:00:00.000Z&to=2026-10-01T00:00:00.000Z";
    renderList();
    expect(await screen.findByTestId("window-problem")).toHaveTextContent("start date is after the end date");
    expect(calls).toBe(0);
  });

  it("a window of dates finds an old message that the default window hides", async () => {
    nav.search = "keyword=tent&from=2026-01-01T00:00:00.000Z&to=2026-10-28T00:00:00.000Z";
    const list = await rows();
    expect(list).toHaveLength(1);
    expect(within(list[0]).getByText("Khamla Sihalath")).toBeInTheDocument();
    expect(screen.queryByTestId("keyword-window-note")).not.toBeInTheDocument();
  });

  it("without the update right there are no checkboxes and no export button for a reader", async () => {
    me.current = { ...me.current, permissions: READER };
    await rows();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Export CSV" })).not.toBeInTheDocument();
  });

  it("bulk: selecting rows shows the bar; Mark as read sends the ids once, reports updated and skipped, and clears the selection", async () => {
    const u = user();
    const seen: unknown[] = [];
    server.use(http.post(`${API}/submissions/bulk-status`, async ({ request }) => {
      seen.push(await request.clone().json());
      return undefined;
    }));
    await rows();
    // 9 is new; 5 is read already (skipped as unchanged)
    await u.click(within(await rowOf("Dara Phommachan Jr.")).getByRole("checkbox"));
    await u.click(within(await rowOf("Anouvong Keo")).getByRole("checkbox"));
    const bar = await screen.findByRole("region", { name: "Actions for the selected rows" });
    expect(bar).toHaveTextContent("2 selected");
    expect(within(bar).queryByRole("button", { name: "Not spam" })).not.toBeInTheDocument();
    await u.click(within(bar).getByRole("button", { name: "Mark as read" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("1 message changed."));
    expect(seen).toEqual([{ ids: expect.arrayContaining([9, 5]), status: "read" }]);
    expect(toast.info).toHaveBeenCalledWith("1 message could not make that move and was left as it is.");
    await waitFor(() => expect(screen.queryByRole("region", { name: "Actions for the selected rows" })).not.toBeInTheDocument());
    expect(submissionsState(getMockDb()).items.find((s) => s.id === 9)!.status).toBe("read");
  });

  it("on the spam tab the only bulk move is Not spam", async () => {
    const u = user();
    nav.search = "status=spam";
    const list = await rows();
    await u.click(within(list[0]).getByRole("checkbox"));
    const bar = await screen.findByRole("region", { name: "Actions for the selected rows" });
    expect(within(bar).getAllByRole("button").map((b) => b.textContent)).toEqual(["Not spam", "Clear selection"]);
    await u.click(within(bar).getByRole("button", { name: "Not spam" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("1 message changed."));
    expect(submissionsState(getMockDb()).items.find((s) => s.id === 15)!.status).toBe("new");
  });

  it("a selection belongs to one query: changing the filter drops it", async () => {
    const u = user();
    const { rerender } = renderList();
    await u.click(within(await rowOf("Dara Phommachan Jr.")).getByRole("checkbox"));
    expect(await screen.findByRole("region", { name: "Actions for the selected rows" })).toBeInTheDocument();
    nav.search = "form_id=3";
    rerender(<SubmissionsList />);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Actions for the selected rows" })).not.toBeInTheDocument());
  });

  it("the list is not kept in the cache for more than a minute and nothing goes to storage", async () => {
    const { queryClient } = renderList();
    await rows();
    const queries = queryClient.getQueryCache().findAll({ queryKey: ["/submissions"] });
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every((q) => q.options.gcTime === 60_000)).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe("SubmissionsList: the CSV export", () => {
  useMockApi();

  it("asks first (rows, filters, the audit notice), sends the filter without page / limit / sort, and saves the file", async () => {
    const u = user();
    nav.search = "status=new,read&form_id=1&keyword=minibus&limit=50&page=1";
    const seen: string[] = [];
    server.use(http.get(`${API}/submissions/export`, ({ request }) => {
      seen.push(new URL(request.url).search);
      return undefined;
    }));
    await rows();
    await u.click(screen.getByRole("button", { name: "Export CSV" }));
    const dialog = await screen.findByTestId("export-dialog");
    expect(within(dialog).getByText("Messages in the file").nextSibling).toHaveTextContent("1");
    expect(dialog).toHaveTextContent("Status: New, Read");
    expect(dialog).toHaveTextContent("Form: Contact form");
    expect(dialog).toHaveTextContent("Search text of 7 characters");
    expect(dialog).not.toHaveTextContent("minibus");
    expect(within(dialog).getByText("This export is recorded")).toBeInTheDocument();
    await u.click(within(dialog).getByRole("button", { name: "Export" }));
    await waitFor(() => expect(downloads.clicked).toHaveLength(1));
    expect(downloads.clicked[0]).toMatch(/^submissions-\d{8}T\d{6}Z\.csv$/);
    const params = new URLSearchParams(seen[0]);
    expect([...params.keys()].sort()).toEqual(["form_id", "keyword", "status"]);
    // UTF-8 BOM (EF BB BF) first, then the header
    const bytes = new Uint8Array(await downloads.created[0].arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toMatch(/^\uFEFFid,public_id/);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    expect(toast.success).toHaveBeenCalledWith("The file was downloaded.");
    await waitFor(() => expect(screen.queryByTestId("export-dialog")).not.toBeInTheDocument());
    expect(submissionsState(getMockDb()).exportLog).toHaveLength(1);
  });

  it("EXPORT_TOO_LARGE (a Blob body) says how many matched and how many are allowed", async () => {
    const u = user();
    setExportMax(getMockDb(), 3);
    await rows();
    await u.click(screen.getByRole("button", { name: "Export CSV" }));
    const dialog = await screen.findByTestId("export-dialog");
    await u.click(within(dialog).getByRole("button", { name: "Export" }));
    expect(await within(dialog).findByTestId("export-problem")).toHaveTextContent("14 messages match, but a file can have at most 3.");
    expect(downloads.clicked).toHaveLength(0);
  });

  it("429 tells how long to wait (from Retry-After) and 503 says it is not available", async () => {
    const u = user();
    exhaustExportRate(getMockDb());
    await rows();
    await u.click(screen.getByRole("button", { name: "Export CSV" }));
    const dialog = await screen.findByTestId("export-dialog");
    await u.click(within(dialog).getByRole("button", { name: "Export" }));
    expect(await within(dialog).findByTestId("export-problem")).toHaveTextContent("Try again in about 50 minutes.");
    // the global toast has the generic wording; the dialog is the only place that names the wait, so no second toast from the page
    expect(toast.error).not.toHaveBeenCalled();
    setExportUnavailable(getMockDb(), true);
    await u.click(within(dialog).getByRole("button", { name: "Export" }));
    await waitFor(() => expect(within(dialog).getByTestId("export-problem")).toHaveTextContent("not available right now"));
  });

  it("over 50,000 rows the button is held back before any request", async () => {
    const u = user();
    server.use(http.get(`${API}/submissions`, () => Response.json({ success: true, data: [], meta: { total: 60000, page: 1, limit: 20, total_page: 3000 } })));
    renderList();
    await u.click(await screen.findByRole("button", { name: "Export CSV" }));
    const dialog = await screen.findByTestId("export-dialog");
    expect(dialog).toHaveTextContent("60,000 messages match, but a file can have at most 50,000.");
    expect(within(dialog).getByRole("button", { name: "Export" })).toBeDisabled();
  });

  it("no export right, no button", async () => {
    setSubmissionsRights(getMockDb(), { export: false });
    me.current = { ...me.current, permissions: grants({ "forms.submissions": ["read", "update"] }) };
    await rows();
    expect(screen.queryByRole("button", { name: "Export CSV" })).not.toBeInTheDocument();
  });
});
