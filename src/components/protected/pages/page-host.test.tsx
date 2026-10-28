import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PageHost } from "@/components/protected/pages/page-host";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, roleID: 2, permissions: [] as PermissionGrant[] } }));
const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/pages/9",
  useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => {
  me.current = { id: 6, roleID: 2, permissions: grants({ "cms.pages": ["read", "create", "update", "delete", "publish", "unpublish", "review", "translate"], "cms.sections": ["read", "create", "update", "delete", "translate"], "cms.seo": ["read", "update"] }) };
  nav.search = "";
  nav.replace.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
});

describe("PageHost (T1.4.7: the publishing parts of SCR-20)", () => {
  useMockApi();

  it("shows the page, its state, the publishing bar and the editor tabs", async () => {
    renderApp(<PageHost id={9} />);
    expect(await screen.findByRole("heading", { name: "Events and treks" })).toBeInTheDocument();
    expect(screen.getByText("/events", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByTestId("status-badge")).toHaveTextContent("Published, changes pending");
    expect(screen.getByRole("button", { name: "Publish changes" })).toBeInTheDocument();
    for (const name of ["Content", "Details", "SEO", "History"]) expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    expect(await screen.findByTestId("section-list")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All pages" })).toHaveAttribute("href", "/admin/pages");
  });

  it("Go to field: the pointer of a blocker goes into the URL (?field=) with the section it belongs to, and is shown", async () => {
    const user = userEvent.setup();
    renderApp(<PageHost id={6} />);
    await user.click(await screen.findByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("dialog", { name: /cannot be published yet/ });
    await user.click(within(dialog).getByRole("button", { name: "Go to field: Title" }));
    expect(nav.replace).toHaveBeenCalledTimes(1);
    const url = nav.replace.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("field")).toMatch(/^\/sections\/[0-9a-f-]+\/props\/title\/la$/);
    expect(params.get("sectionKey")).toBe("hero_brand");
    expect(params.get("sectionIndex")).toBe("0");
  });

  it("?field= opens the section it names and shows the problem at the field (the former notice box is gone)", async () => {
    const db = getMockDb();
    const hero = db.pages.find((p) => p.id === 6)!.live.sections[0];
    nav.search = `section=${hero.id}&field=${encodeURIComponent(`/sections/${hero.public_id}/props/title/la`)}&fieldCode=empty_default_locale&sectionKey=hero_brand&sectionIndex=0`;
    renderApp(<PageHost id={6} />);
    expect(await screen.findByTestId("section-editor")).toBeInTheDocument();
    expect(await screen.findByText("This text is required in the default language.")).toBeInTheDocument();
    expect(screen.queryByTestId("field-target")).not.toBeInTheDocument();
    // the address is cleaned: the pointer was consumed
    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    const url = nav.replace.mock.calls.at(-1)![0] as string;
    expect(url).toContain(`section=${hero.id}`);
    expect(url).not.toContain("field=");
  });

  it("a restore from the History tab updates the page and its ETag from the answer, without refetching the page", async () => {
    nav.search = "tab=revisions";
    const user = userEvent.setup();
    let gets = 0;
    server.use(http.get(`${API}/pages/9`, () => { gets += 1; return undefined; }));
    renderApp(<PageHost id={9} />);
    await screen.findByRole("heading", { name: "Events and treks" });
    expect(gets).toBe(1);
    const rows = (await screen.findAllByRole("row")).slice(1);
    await user.click(within(rows[3]).getByRole("button", { name: "Restore version 1 as draft" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore version 1 as draft?" });
    await user.click(within(dialog).getByRole("button", { name: "Restore version 1 as draft" }));
    expect(await screen.findByRole("heading", { name: "Events (old)" })).toBeInTheDocument();
    expect(gets).toBe(1);
    // and the next command uses the NEW ETag: discard works without a conflict
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Changes discarded."));
    expect(await screen.findByRole("heading", { name: "Events" })).toBeInTheDocument();
  });

  it("a page that does not exist is the not-found state, a 403 the no permission state", async () => {
    const first = renderApp(<PageHost id={999} />);
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All pages" })).toBeInTheDocument();
    first.unmount();

    server.use(http.get(`${API}/pages/9`, () => HttpResponse.json({ success: false, code: "FORBIDDEN", message: "no" }, { status: 403 })));
    renderApp(<PageHost id={9} />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
  });

  it("a page in the trash says so and has no commands", async () => {
    const user = userEvent.setup();
    renderApp(<PageHost id={7} />);
    expect(await screen.findByText("This page is in the trash")).toBeInTheDocument();
    expect(screen.getByTestId("status-badge")).toHaveTextContent("In the trash");
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(nav.replace).toHaveBeenCalled();
  });
});
