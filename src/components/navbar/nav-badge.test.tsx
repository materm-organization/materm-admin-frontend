import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http } from "msw";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NavMain } from "@/components/navbar/nav-main";
import { SidebarProvider } from "@/components/ui/sidebar";
import { buildNavMainItemsForUser } from "@/lib/nav-main-items";
import { getMockDb } from "@/mocks/mock-db";
import { getPage, submitPageForReview } from "@/mocks/mock-pages";
import { getPost, submitPostForReview } from "@/mocks/mock-posts";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

import en from "../../../i18n/en.json";

const path = vi.hoisted(() => ({ current: "/admin/forms/submissions" }));
const me = vi.hoisted(() => ({ current: { id: 6, name: "Noy Keomany", roleID: 2, permissions: [] as PermissionGrant[] } }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));

const renderNav = (keys: string[]) => {
  const items = buildNavMainItemsForUser(keys);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Vientiane">
      <QueryClientProvider client={client}>
        <SidebarProvider>
          <NavMain items={items} />
        </SidebarProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>
  );
};

beforeEach(() => {
  path.current = "/admin/forms/submissions";
  me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: grants({ "forms.submissions": ["read"], "forms.manage": ["read"] }) };
});

describe("NavMain: the messages entry (doc/07 2.1)", () => {
  useMockApi();

  it("shows the number of new messages next to Messages and marks only that entry as the current page", async () => {
    renderNav(["forms.submissions", "forms.manage"]);
    const badge = await screen.findByTestId("nav-badge");
    expect(badge).toHaveTextContent("7");
    expect(badge).toHaveAttribute("aria-label", "7 new messages");
    expect(screen.getByRole("link", { name: /Messages/ })).toHaveAttribute("aria-current", "page");
    // the URL prefix `/admin/forms` is NOT also marked
    expect(screen.getByRole("link", { name: "Forms" })).not.toHaveAttribute("aria-current");
  });

  it("a detail page below the inbox keeps the same entry marked", async () => {
    path.current = "/admin/forms/submissions/12";
    renderNav(["forms.submissions", "forms.manage"]);
    await screen.findByTestId("nav-badge");
    expect(screen.getByRole("link", { name: /Messages/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Forms" })).not.toHaveAttribute("aria-current");
  });

  it("the form editor marks Forms, not Messages", async () => {
    path.current = "/admin/forms/3";
    renderNav(["forms.submissions", "forms.manage"]);
    await screen.findByTestId("nav-badge");
    expect(screen.getByRole("link", { name: "Forms" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Messages/ })).not.toHaveAttribute("aria-current");
  });

  it("no badge at 0, and 99+ over 99", async () => {
    server.use(http.get("*/api/v1/submissions/summary", () => Response.json({ success: true, data: { new: 0, by_form: [] } })));
    const { unmount } = renderNav(["forms.submissions"]);
    await screen.findByRole("link", { name: /Messages/ });
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId("nav-badge")).not.toBeInTheDocument();
    unmount();
    server.use(http.get("*/api/v1/submissions/summary", () => Response.json({ success: true, data: { new: 150, by_form: [] } })));
    renderNav(["forms.submissions"]);
    expect(await screen.findByTestId("nav-badge")).toHaveTextContent("99+");
  });

  it("no request and no badge for a person who cannot read the inbox", async () => {
    let calls = 0;
    me.current = { ...me.current, permissions: grants({ "forms.manage": ["read"] }) };
    server.use(http.get("*/api/v1/submissions/summary", () => { calls += 1; return Response.json({ success: true, data: { new: 4, by_form: [] } }); }));
    renderNav(["forms.manage"]);
    await screen.findByRole("link", { name: "Forms" });
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toBe(0);
    expect(screen.queryByTestId("nav-badge")).not.toBeInTheDocument();
  });
});

describe("NavMain: the publishing queue entry (SCR-39)", () => {
  useMockApi();
  const submit = () => {
    submitPageForReview(getMockDb(), "8", undefined, getPage(getMockDb(), "8").etag);
    submitPostForReview(getMockDb(), "3", undefined, getPost(getMockDb(), "3").etag);
  };

  it("shows the number of items awaiting review to a person who can review, and marks the entry on /admin/publishing", async () => {
    path.current = "/admin/publishing";
    me.current = { ...me.current, permissions: grants({ "cms.pages": ["read", "review"], "cms.blog": ["read"] }) };
    submit();
    renderNav(["cms.pages", "cms.blog"]);
    const badge = await screen.findByTestId("nav-badge");
    expect(badge).toHaveAttribute("data-query", "publishing.awaiting");
    expect(badge).toHaveTextContent("2");
    expect(badge).toHaveAttribute("aria-label", "2 items awaiting review");
    expect(screen.getByRole("link", { name: /Publishing queue/ })).toHaveAttribute("aria-current", "page");
  });

  it("no badge and no request for a person who can read but not review (the entry is still there)", async () => {
    let calls = 0;
    path.current = "/admin/publishing";
    me.current = { ...me.current, permissions: grants({ "cms.pages": ["read"] }) };
    submit();
    server.use(http.get("*/api/v1/publishing/queue", () => { calls += 1; return Response.json({ success: true, data: { awaiting_review: { count: 2, items: [] } } }); }));
    renderNav(["cms.pages"]);
    await screen.findByRole("link", { name: /Publishing queue/ });
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toBe(0);
    expect(screen.queryByTestId("nav-badge")).not.toBeInTheDocument();
  });

  it("no badge at 0; the entry is gone for a person without any contributing key", async () => {
    path.current = "/admin/publishing";
    me.current = { ...me.current, permissions: grants({ "cms.pages": ["read", "review"] }) };
    const { unmount } = renderNav(["cms.pages"]);
    await screen.findByRole("link", { name: /Publishing queue/ });
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId("nav-badge")).not.toBeInTheDocument();
    unmount();
    path.current = "/admin/menus";
    me.current = { ...me.current, permissions: grants({ "cms.menus": ["read"] }) };
    renderNav(["cms.menus"]);
    await screen.findByRole("link", { name: /Menus/ });
    expect(screen.queryByRole("link", { name: /Publishing queue/ })).not.toBeInTheDocument();
  });
});
