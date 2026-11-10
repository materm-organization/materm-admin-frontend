import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardView } from "@/components/protected/dashboard/dashboard-view";
import { setDashboardCards } from "@/mocks/mock-dashboard";
import { getMockDb } from "@/mocks/mock-db";
import { getAlbum, scheduleAlbum } from "@/mocks/mock-albums";
import { getPage, submitPageForReview } from "@/mocks/mock-pages";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const me = vi.hoisted(() => ({ current: { id: 6, name: "Noy Keomany", roleID: 2, permissions: [] as PermissionGrant[] } }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));

const ALL = grants({
  "forms.manage": ["read", "update"],
  "forms.submissions": ["read"],
  "cms.pages": ["read"],
  "cms.blog": ["read"],
  "ops.system": ["read"],
  "ops.audit": ["read"],
  "media.library": ["read"],
  "cms.locales": ["read"],
});

beforeEach(() => {
  me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: ALL };
});

describe("DashboardView (SCR-05)", () => {
  useMockApi();

  it("shows the documented cards and the proposed ones, with the numbers of the models", async () => {
    renderApp(<DashboardView />);
    const messages = await screen.findByTestId("card-submissions-new");
    expect(within(messages).getByText("7")).toBeInTheDocument();
    expect(within(messages).getByText("new messages")).toBeInTheDocument();
    expect(within(messages).getByRole("link", { name: /Open the inbox/ })).toHaveAttribute("href", "/admin/forms/submissions?status=new");
    expect(within(screen.getByTestId("card-failed-jobs")).getByText("2")).toBeInTheDocument();
    expect(within(screen.getByTestId("card-missing-alt")).getByRole("link", { name: /Open the media library/ })).toHaveAttribute("href", "/admin/media?missing_alt=true");
    const translation = screen.getByTestId("card-translation");
    expect(within(translation).getByText("en")).toBeInTheDocument();
    expect(within(translation).getByRole("progressbar")).toBeInTheDocument();
    // proposed cards
    expect(within(screen.getByTestId("card-content-counts")).getByText("Form")).toBeInTheDocument();
    expect(within(screen.getByTestId("card-activity")).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("card-relay")).getByText("Waiting")).toBeInTheDocument();
  });

  it("my drafts: a link only to a page this admin has and the person may open", async () => {
    renderApp(<DashboardView />);
    const drafts = await screen.findByTestId("card-my-drafts");
    expect(within(drafts).getByRole("link", { name: "Trek booking (2027 season)" })).toHaveAttribute("href", "/admin/forms/3");
    expect(within(drafts).getAllByText("Changes pending").length).toBeGreaterThan(0);
  });

  it("without the right to open forms the same draft is plain text, not a link", async () => {
    me.current = { ...me.current, permissions: grants({ "cms.pages": ["read"], "cms.blog": ["read"] }) };
    renderApp(<DashboardView />);
    const drafts = await screen.findByTestId("card-my-drafts");
    expect(within(drafts).getByText("Trek booking (2027 season)")).toBeInTheDocument();
    expect(within(drafts).queryByRole("link", { name: "Trek booking (2027 season)" })).not.toBeInTheDocument();
  });

  it("shows exactly the cards the server sent: a card the server left out is not on the page", async () => {
    setDashboardCards(getMockDb(), { omit: ["failed_jobs", "relay", "recent_activity", "content_counts", "translation"] });
    renderApp(<DashboardView />);
    await screen.findByTestId("card-submissions-new");
    expect(screen.queryByTestId("card-failed-jobs")).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-relay")).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-translation")).not.toBeInTheDocument();
    expect(screen.getByTestId("card-my-drafts")).toBeInTheDocument();
  });

  it("no card at all: a welcome with a link to the first page the person can open", async () => {
    me.current = { ...me.current, permissions: grants({ "cms.pages": ["read"] }) };
    setDashboardCards(getMockDb(), { omit: ["in_review", "scheduled_7d", "my_drafts", "submissions_new", "failed_jobs", "translation", "media_missing_alt", "content_counts", "recent_activity", "relay"] });
    renderApp(<DashboardView />);
    const welcome = await screen.findByTestId("dashboard-welcome");
    expect(within(welcome).getByRole("link", { name: /Open the first page/ })).toHaveAttribute("href", "/admin/pages");
  });

  it("a person who can open nothing is told so", async () => {
    me.current = { ...me.current, permissions: [] };
    setDashboardCards(getMockDb(), { omit: ["in_review", "scheduled_7d", "my_drafts", "submissions_new", "failed_jobs", "translation", "media_missing_alt", "content_counts", "recent_activity", "relay"] });
    renderApp(<DashboardView />);
    expect(await screen.findByText(/cannot open any page yet/)).toBeInTheDocument();
  });

  it("the whole page is one request: an error is the error state with Retry, and Retry loads it", async () => {
    const u = userEvent.setup();
    setDashboardCards(getMockDb(), { fail: true });
    renderApp(<DashboardView />);
    const retry = await screen.findByRole("button", { name: /retry/i }, { timeout: 4000 });
    setDashboardCards(getMockDb(), { fail: false });
    await u.click(retry);
    expect(await screen.findByTestId("card-submissions-new")).toBeInTheDocument();
  });

  it("a backend that has no such endpoint yet (404) shows the welcome, not an error page", async () => {
    server.use(http.get("*/api/v1/dashboard/summary", () => Response.json({ success: false, code: "NOT_FOUND", message: "x" }, { status: 404 })));
    renderApp(<DashboardView />);
    expect(await screen.findByTestId("dashboard-welcome")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("a 403 is the no-permission state", async () => {
    server.use(http.get("*/api/v1/dashboard/summary", () => Response.json({ success: false, code: "FORBIDDEN", message: "x" }, { status: 403 })));
    renderApp(<DashboardView />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
  });

  it("the two publishing cards (in review, scheduled in 7 days) are shown exactly when the server sends them, with links to the queue", async () => {
    submitPageForReview(getMockDb(), "8", undefined, getPage(getMockDb(), "8").etag);
    scheduleAlbum(getMockDb(), "3", { scheduled_at: new Date(Date.now() + 3_600_000).toISOString() }, getAlbum(getMockDb(), "3").etag);
    me.current = { ...me.current, permissions: [...ALL, ...grants({ "cms.galleries": ["read"] })] };
    renderApp(<DashboardView />);
    const review = await screen.findByTestId("card-in-review");
    expect(within(review).getByText("1")).toBeInTheDocument();
    expect(within(review).getByRole("link", { name: /Open the queue/ })).toHaveAttribute("href", "/admin/publishing?tab=awaiting_review");
    expect(within(screen.getByTestId("card-scheduled-7d")).getByRole("link", { name: /Open the schedule/ })).toHaveAttribute("href", "/admin/publishing?tab=scheduled");
  });

  it("without the cards in the answer there is no card; without the right to open the queue the card has no link", async () => {
    setDashboardCards(getMockDb(), { omit: ["in_review", "scheduled_7d"] });
    const first = renderApp(<DashboardView />);
    await screen.findByTestId("card-submissions-new");
    expect(screen.queryByTestId("card-in-review")).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-scheduled-7d")).not.toBeInTheDocument();
    first.unmount();
    setDashboardCards(getMockDb(), { omit: [] });
    me.current = { ...me.current, permissions: grants({ "forms.submissions": ["read"] }) };
    renderApp(<DashboardView />);
    const card = await screen.findByTestId("card-in-review");
    expect(within(card).queryByRole("link", { name: /Open the queue/ })).not.toBeInTheDocument();
  });
});
