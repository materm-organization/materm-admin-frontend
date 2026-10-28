import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CachePurgeSection } from "@/components/protected/system/cache-purge";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 1, roleID: 2, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/system", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  me.current = { id: 1, roleID: 2, permissions: grants({ "ops.system": ["read", "execute"], "cms.locales": ["read"] }) };
});

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  renderApp(<CachePurgeSection />);
  await user.click(await screen.findByRole("button", { name: "Clear cache..." }));
  return screen.findByRole("dialog", { name: "Clear the website cache" });
}

describe("CachePurgeSection (SCR-45 clear cache)", () => {
  useMockApi();

  it("is hidden without ops.system:execute (the page itself needs only read)", () => {
    me.current = { id: 1, roleID: 2, permissions: grants({ "ops.system": ["read"] }) };
    renderApp(<CachePurgeSection />);
    expect(screen.queryByRole("button", { name: "Clear cache..." })).not.toBeInTheDocument();
  });

  it("clears chosen tags: quick picks plus a typed one, sent as the allow-list tags; the answer shows the pairs the server added", async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(
      http.post(`${API}/system/cache/purge`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { event_id: 90412, scope: "tags", tags: ["menu:main", "page:3", "pages", "settings"], status: "queued", queued_at: "2026-10-27T04:02:11Z" } });
      })
    );
    const dialog = await openDialog(user);
    expect(within(dialog).getByRole("button", { name: /Clear 0 parts|Clear # part/ })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "settings" }));
    await user.click(within(dialog).getByRole("button", { name: "menu:main" }));
    await user.type(within(dialog).getByLabelText("A page, post or other item"), "page:3");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await user.type(within(dialog).getByLabelText("Reason (optional)"), "menu changed");
    expect(within(dialog).getByText("3 of 50 selected")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Clear 3 parts" }));
    const result = await within(dialog).findByTestId("purge-result");
    expect(body).toEqual({ scope: "tags", tags: ["settings", "menu:main", "page:3"], reason: "menu changed" });
    expect(within(result).getByText("Request #90412 was queued")).toBeInTheDocument();
    // `pages` was added by the server for `page:3`
    expect(within(result).getByText("pages")).toBeInTheDocument();
  });

  it("refuses a tag outside the allow-list before sending anything (internal tags and *)", async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(http.post(`${API}/system/cache/purge`, () => { calls += 1; return HttpResponse.json({}); }));
    const dialog = await openDialog(user);
    const input = within(dialog).getByLabelText("A page, post or other item");
    await user.type(input, "category:3");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(await within(dialog).findByText('"category:3" is not a part that can be cleared.')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "*");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(await within(dialog).findByText('"*" is not a part that can be cleared.')).toBeInTheDocument();
    expect(calls).toBe(0);
  });

  it("'Everything' needs a second, explicit confirmation and sends scope all without tags", async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("radio", { name: /Everything/ }));
    await user.click(within(dialog).getByRole("button", { name: "Clear everything..." }));
    expect(await screen.findByText("Clear the whole cache?")).toBeInTheDocument();
    expect(getMockDb().purges.all).toBe(0);
    await user.click(screen.getByRole("button", { name: "Yes, clear everything" }));
    const result = await screen.findByTestId("purge-result");
    expect(within(result).getByText("*")).toBeInTheDocument();
    expect(getMockDb().purges.all).toBe(1);
  });

  it("the second step can be backed out of without sending", async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("radio", { name: /Everything/ }));
    await user.click(within(dialog).getByRole("button", { name: "Clear everything..." }));
    await user.click(await screen.findByRole("button", { name: "Back" }));
    expect(getMockDb().purges.all).toBe(0);
    expect(screen.getByRole("button", { name: "Clear everything..." })).toBeInTheDocument();
  });

  it("the rate limit (429 + Retry-After) is shown inside the dialog with the wait", async () => {
    const user = userEvent.setup();
    getMockDb().purges.all = 3;
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("radio", { name: /Everything/ }));
    await user.click(within(dialog).getByRole("button", { name: "Clear everything..." }));
    await user.click(await screen.findByRole("button", { name: "Yes, clear everything" }));
    const problem = await screen.findByTestId("purge-problem");
    expect(within(problem).getByText("Too many requests")).toBeInTheDocument();
    expect(within(problem).getByText(/about 30 minutes/)).toBeInTheDocument();
  });

  it("403 and 503 are explained in the dialog", async () => {
    const user = userEvent.setup();
    server.use(http.post(`${API}/system/cache/purge`, () => HttpResponse.json({ success: false, code: "FORBIDDEN" }, { status: 403 })));
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "settings" }));
    await user.click(within(dialog).getByRole("button", { name: "Clear 1 part" }));
    expect(await within(dialog).findByText("You are not allowed to clear the cache.")).toBeInTheDocument();
    server.use(http.post(`${API}/system/cache/purge`, () => HttpResponse.json({ success: false, code: "SERVICE_UNAVAILABLE" }, { status: 503 })));
    await user.click(within(dialog).getByRole("button", { name: "Clear 1 part" }));
    expect(await within(dialog).findByText("Temporarily unavailable")).toBeInTheDocument();
  });

  it("a 422 on /tags/<i> marks the tag that was refused", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/system/cache/purge`, () =>
        HttpResponse.json({ success: false, code: "VALIDATION_FAILED", errors: [{ in: "body", path: "/tags/1", code: "pattern_mismatch" }] }, { status: 422 })
      )
    );
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "settings" }));
    await user.click(within(dialog).getByRole("button", { name: "locales" }));
    await user.click(within(dialog).getByRole("button", { name: "Clear 2 parts" }));
    const problem = await within(dialog).findByTestId("purge-problem");
    expect(within(problem).getByText("A part was not accepted")).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByLabelText("Selected parts")).toBeInTheDocument());
  });

  it("offers ui:<code> for the active languages when the user can read them", async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    expect(await within(dialog).findByRole("button", { name: "ui:la" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "ui:en" })).toBeInTheDocument();
    // Thai is not active in the fixture
    expect(within(dialog).queryByRole("button", { name: "ui:th" })).not.toBeInTheDocument();
  });
});
