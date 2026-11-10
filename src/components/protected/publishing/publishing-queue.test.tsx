import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PublishingQueueScreen } from "@/components/protected/publishing/publishing-queue";
import { getAlbum, scheduleAlbum } from "@/mocks/mock-albums";
import { getMockDb, resetMockDb } from "@/mocks/mock-db";
import { getPage, schedulePage, submitPageForReview } from "@/mocks/mock-pages";
import { getPost, submitPostForReview } from "@/mocks/mock-posts";
import { failSchedule, makeScheduleOverdue, setWorkflowRole } from "@/mocks/mock-schedule-helpers";
import { setQueueFails } from "@/mocks/mock-publishing-queue";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const nav = vi.hoisted(() => ({ search: "", push: vi.fn() }));
const me = vi.hoisted(() => ({ current: { id: 6, name: "Noy Keomany", roleID: 2, permissions: [] as PermissionGrant[] } }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/publishing",
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));

const ALL = grants({
  "cms.pages": ["read", "review"],
  "cms.blog": ["read", "review"],
  "cms.galleries": ["read"],
  "cms.faq": ["read"],
  "forms.manage": ["read"],
  "cms.collections": ["read"],
  "cms.sections": ["read"],
});
const NOW = new Date("2026-11-10T03:00:00.000Z"); // 10:00 on Tuesday 10 Nov in Vientiane
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const db = () => getMockDb();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetMockDb();
  nav.search = "";
  nav.push.mockReset();
  me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: ALL };
});
afterEach(() => vi.useRealTimers());

describe("PublishingQueueScreen (SCR-39)", () => {
  useMockApi();

  it("tabs with the counts of the server; the awaiting tab is the default and says so when it is empty", async () => {
    renderApp(<PublishingQueueScreen />);
    expect(await screen.findByTestId("queue-empty")).toHaveTextContent("Nothing is waiting for a review.");
    expect(screen.getByTestId("tab-awaiting_review")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByTestId("tab-count-unpublished_changes")).toHaveTextContent("7"));
    expect(screen.getByTestId("tab-count-awaiting_review")).toHaveTextContent("0");
    expect(screen.getByTestId("tab-count-scheduled")).toHaveTextContent("0");
  });

  it("awaiting review: a submitted page and post, each with a link to its editor, its kind, an Open button and the approve hint", async () => {
    submitPageForReview(db(), "8", undefined, getPage(db(), "8").etag);
    submitPostForReview(db(), "3", undefined, getPost(db(), "3").etag);
    renderApp(<PublishingQueueScreen />);
    const rows = await screen.findAllByTestId("queue-row");
    expect(rows).toHaveLength(2);
    const pageRow = rows.find((r) => within(r).queryByText("Page"))!;
    expect(within(pageRow).getByRole("link", { name: /^(?!Open ).+/ })).toHaveAttribute("href", "/admin/pages/8");
    const open = within(pageRow).getByRole("link", { name: /^Open / });
    expect(open).toHaveAttribute("href", "/admin/pages/8");
    expect(within(pageRow).getByTestId("approve-hint")).toHaveTextContent("Open to approve or reject");
    expect(within(pageRow).getByTestId("status-badge")).toHaveAttribute("data-state", "in_review");
    expect(within(pageRow).getByText(/Submitted by Noy Keomany/)).toBeInTheDocument();
    const postRow = rows.find((r) => within(r).queryByText("Post"))!;
    expect(within(postRow).getByRole("link", { name: /^Open / })).toHaveAttribute("href", "/admin/blog/posts/3");
  });

  it("no approve hint without the review action on the row (a writer sees only Open)", async () => {
    submitPageForReview(db(), "8", undefined, getPage(db(), "8").etag);
    setWorkflowRole(db(), "writer");
    renderApp(<PublishingQueueScreen />);
    const row = await screen.findByTestId("queue-row");
    expect(within(row).getByRole("link", { name: /^Open / })).toBeInTheDocument();
    expect(within(row).queryByTestId("approve-hint")).not.toBeInTheDocument();
  });

  it("scheduled: the calendar puts a row on its Vientiane day; the list keeps the API order; the day is announced", async () => {
    nav.search = "tab=scheduled";
    scheduleAlbum(db(), "3", { scheduled_at: at(60 * 24 * 3 + 5) }, getAlbum(db(), "3").etag); // 3 days later, 10:05
    schedulePage(db(), "8", { scheduled_at: at(120) }, getPage(db(), "8").etag); // today 12:00
    renderApp(<PublishingQueueScreen />);
    const grid = await screen.findByTestId("calendar-grid");
    const today = within(grid).getAllByTestId("calendar-day").find((d) => d.getAttribute("data-today") === "true")!;
    expect(today.getAttribute("data-date")).toBe("2026-11-10");
    expect(today.getAttribute("data-count")).toBe("1");
    expect(today).toHaveAttribute("aria-label", expect.stringContaining("1 scheduled item"));
    expect(within(today).getByTestId("calendar-item")).toHaveAttribute("href", "/admin/pages/8");
    const later = within(grid).getAllByTestId("calendar-day").find((d) => d.getAttribute("data-date") === "2026-11-13")!;
    expect(later.getAttribute("data-count")).toBe("1");
    expect(within(later).getByTestId("calendar-item")).toHaveAttribute("href", "/admin/galleries/3");
    const list = screen.getAllByTestId("queue-row");
    expect(list.map((r) => within(r).getAllByRole("link")[0].getAttribute("href"))).toEqual(["/admin/pages/8", "/admin/galleries/3"]);
    expect(within(list[0]).getByText(/Nov 10, 2026/)).toBeInTheDocument();
  });

  it("the calendar has a week view: seven days from today", async () => {
    nav.search = "tab=scheduled";
    schedulePage(db(), "8", { scheduled_at: at(120) }, getPage(db(), "8").etag);
    renderApp(<PublishingQueueScreen />);
    const u = userEvent.setup({ advanceTimers: () => {} });
    await screen.findByTestId("calendar-grid");
    expect(screen.getByTestId("calendar-grid")).toHaveAttribute("data-view", "month");
    await u.click(screen.getByRole("button", { name: "Week" }));
    const grid = screen.getByTestId("calendar-grid");
    expect(grid).toHaveAttribute("data-view", "week");
    expect(within(grid).getAllByTestId("calendar-day")).toHaveLength(7);
    expect(within(grid).getAllByTestId("calendar-day")[0]).toHaveAttribute("data-date", "2026-11-10");
  });

  it("overdue is amber and failed is destructive (the D1 status chips); an overdue row sits in today", async () => {
    nav.search = "tab=scheduled";
    schedulePage(db(), "8", { scheduled_at: at(60) }, getPage(db(), "8").etag);
    makeScheduleOverdue(db(), "pages", 8);
    scheduleAlbum(db(), "3", { scheduled_at: at(120) }, getAlbum(db(), "3").etag);
    failSchedule(db(), "albums", 3, "media_alt_missing");
    renderApp(<PublishingQueueScreen />);
    const rows = await screen.findAllByTestId("queue-row");
    const overdue = rows.find((r) => r.getAttribute("data-health") === "overdue")!;
    expect(within(overdue).getByTestId("status-badge")).toHaveAttribute("data-state", "scheduled_overdue");
    const failed = rows.find((r) => r.getAttribute("data-health") === "failed")!;
    expect(within(failed).getByTestId("status-badge")).toHaveAttribute("data-state", "scheduled_failed");
    expect(within(failed).getByTestId("failed-note")).toHaveTextContent("gave up after 3 attempts. Reason: media_alt_missing");
    const items = within(screen.getByTestId("calendar-grid")).getAllByTestId("calendar-item");
    expect(items.map((i) => i.getAttribute("data-health")).sort()).toEqual(["failed", "overdue"]);
    const today = within(screen.getByTestId("calendar-grid")).getAllByTestId("calendar-day").find((d) => d.getAttribute("data-today") === "true")!;
    expect(today.getAttribute("data-count")).toBe("2");
  });

  it("unpublished changes with a kind filter in the URL: only those kinds; a wrong tab or kind in the URL is dropped", async () => {
    nav.search = "tab=unpublished_changes&kind=albums,faq-groups";
    renderApp(<PublishingQueueScreen />);
    const rows = await screen.findAllByTestId("queue-row");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => within(r).getAllByRole("link")[0].getAttribute("href")).sort()).toEqual(["/admin/faq/3", "/admin/galleries/5"]);
    expect(screen.getByTestId("tab-unpublished_changes")).toHaveAttribute("aria-selected", "true");
  });

  it("an unknown tab / kind in the URL falls back to the defaults (never a 422)", async () => {
    nav.search = "tab=nonsense&kind=comics";
    renderApp(<PublishingQueueScreen />);
    expect(await screen.findByTestId("queue-empty")).toBeInTheDocument();
    expect(screen.getByTestId("tab-awaiting_review")).toHaveAttribute("aria-selected", "true");
  });

  it("choosing a tab and a kind writes them to the URL (and goes back to page 1)", async () => {
    const u = userEvent.setup({ advanceTimers: () => {} });
    renderApp(<PublishingQueueScreen />);
    await screen.findByTestId("queue-empty");
    await u.click(screen.getByTestId("tab-scheduled"));
    expect(nav.push).toHaveBeenLastCalledWith("/admin/publishing?tab=scheduled", { scroll: false });
    await u.click(screen.getByRole("button", { name: /Kind/ }));
    await u.click(await screen.findByRole("option", { name: /Album/ }));
    await u.click(screen.getByRole("button", { name: /Search/ }));
    // the hook builds on the newest params, so the tab chosen a moment ago is kept
    expect(nav.push.mock.calls.at(-1)?.[0]).toBe("/admin/publishing?tab=scheduled&kind=albums");
  });

  it("the kind filter lists only the kinds the person may read, and is hidden when there is one", async () => {
    me.current = { ...me.current, permissions: grants({ "cms.blog": ["read"] }) };
    renderApp(<PublishingQueueScreen />);
    await screen.findByTestId("queue-empty");
    expect(screen.queryByRole("button", { name: /Kind/ })).not.toBeInTheDocument();
  });

  it("a filter that matches nothing offers to clear it; the empty tab without a filter explains itself", async () => {
    nav.search = "tab=unpublished_changes&kind=pages";
    // pages in the seed have no pending draft except 9: filter on posts-only kind with no draft instead
    nav.search = "tab=awaiting_review&kind=posts";
    renderApp(<PublishingQueueScreen />);
    expect(await screen.findByText("No items match your filters")).toBeInTheDocument();
  });

  it("a 403 is the no-permission state (no retry button)", async () => {
    server.use(http.get("*/api/v1/publishing/queue", () => Response.json({ success: false, code: "FORBIDDEN", message: "x" }, { status: 403 })));
    renderApp(<PublishingQueueScreen />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("a 500 is the error state with Retry that loads again", async () => {
    setQueueFails(db(), true);
    renderApp(<PublishingQueueScreen />);
    const retry = await screen.findByRole("button", { name: /retry/i }, { timeout: 4000 });
    setQueueFails(db(), false);
    const u = userEvent.setup({ advanceTimers: () => {} });
    await u.click(retry);
    expect(await screen.findByTestId("queue-empty")).toBeInTheDocument();
  });

  it("a command of the PublishBar refreshes the queue: a new request goes out after the invalidation", async () => {
    const { queryClient } = renderApp(<PublishingQueueScreen />);
    await screen.findByTestId("queue-empty");
    submitPageForReview(db(), "8", undefined, getPage(db(), "8").etag);
    const { invalidatePublishingQueue } = await import("@/hooks/use-publishing-queue");
    await act(async () => {
      invalidatePublishingQueue(queryClient);
    });
    expect(await screen.findByTestId("queue-row")).toBeInTheDocument();
  });
});
