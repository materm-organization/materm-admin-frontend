import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SharedSectionsList } from "@/components/protected/sections/shared-sections-list";
import { getMockDb } from "@/mocks/mock-db";
import { createSection, getPage } from "@/mocks/mock-pages";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, name: "Noy Keomany", roleID: 2, permissions: [] as PermissionGrant[] } }));
const nav = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/sections",
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const EDITOR = grants({ "cms.sections": ["read", "create", "update", "delete", "publish", "unpublish", "translate"], "cms.pages": ["read"] });
const VIEWER = grants({ "cms.sections": ["read"] });

beforeEach(() => {
  me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: EDITOR };
  nav.search = "";
  nav.push.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
});

const rowOf = async (name: string) => {
  const table = await screen.findByRole("table");
  return (await within(table).findAllByText(name))[0].closest("tr") as HTMLElement;
};
const place = (pageId: number, sharedId: number) => createSection(getMockDb(), String(pageId), { shared_section_id: sharedId }, getPage(getMockDb(), String(pageId)).etag!);

describe("SharedSectionsList (SCR-22)", () => {
  useMockApi();

  it("lists the shared sections with kind, state (with the pending flag) and usage; the trashed one is not there", async () => {
    place(8, 1);
    renderApp(<SharedSectionsList />);
    const teaser = await rowOf("Gallery teaser");
    expect(within(teaser).getByRole("link", { name: "Gallery teaser" })).toHaveAttribute("href", "/admin/sections/1");
    expect(within(teaser).getByTestId("used-in-1")).toHaveTextContent("1 page");
    const story = await rowOf("Forest photo story");
    expect(within(story).getByTestId("status-badge")).toHaveAttribute("data-state", "pending");
    expect(within(await rowOf("Our promise (text)")).getByTestId("used-in-2")).toHaveTextContent("Not used");
    expect(screen.queryByText("Old banner")).not.toBeInTheDocument();
  });

  it("'used in N pages' opens the list of the pages (the trash counted apart); a page link needs cms.pages:read", async () => {
    const user = userEvent.setup();
    place(8, 1);
    const trashedPage = getMockDb().pages.find((p) => p.id === 7)!;
    trashedPage.live.sections.push({ ...trashedPage.live.sections[0], id: 900, public_id: "0192d3a4-7c1e-7b52-9d0a-3f5e2a1b5900", section_type: "gallery_cards", shared_section_id: 1, props: {} });
    renderApp(<SharedSectionsList />);
    const teaser = await rowOf("Gallery teaser");
    expect(within(teaser).getByTestId("used-in-1")).toHaveTextContent("1 page · 1 in the trash");
    await user.click(within(teaser).getByTestId("used-in-1"));
    const sheet = await screen.findByTestId("usages-sheet");
    const list = await within(sheet).findByTestId("usage-list");
    expect(within(list).getByTestId("usage-page-8")).toHaveTextContent("Summer trek");
    expect(within(within(list).getByTestId("usage-page-8")).getByRole("link")).toHaveAttribute("href", "/admin/pages/8");
    expect(within(list).getByTestId("usage-page-7")).toHaveTextContent("In the trash");
    expect(within(within(list).getByTestId("usage-page-7")).queryByRole("link")).not.toBeInTheDocument();
  });

  it("the filters of the address reach the API (unused, pending changes, kind, state)", async () => {
    const seen: URLSearchParams[] = [];
    server.use(http.get(`${API}/shared-sections`, ({ request }) => { seen.push(new URL(request.url).searchParams); return undefined; }));
    nav.search = "in_use=false&section_type=intro_text,photo_story&status=draft&keyword=promise";
    renderApp(<SharedSectionsList />);
    await rowOf("Our promise (text)");
    const q = seen.at(-1)!;
    expect(q.get("in_use")).toBe("false");
    expect(q.get("section_type")).toBe("intro_text,photo_story");
    expect(q.get("status")).toBe("draft");
    expect(q.get("keyword")).toBe("promise");
    expect(screen.queryByText("Gallery teaser")).not.toBeInTheDocument();
  });

  it("New shared section: creates with the chosen kind (only kinds that can be shared) and opens the editor", async () => {
    const user = userEvent.setup();
    renderApp(<SharedSectionsList />);
    await rowOf("Gallery teaser");
    await user.click(screen.getByRole("button", { name: "New shared section" }));
    const dialog = await screen.findByRole("dialog", { name: "New shared section" });
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await within(dialog).findByText("The name is required.")).toBeInTheDocument();
    expect(within(dialog).getByText("Choose a kind of section.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Name"), "  Our values  ");
    await user.click(await within(dialog).findByRole("radio", { name: /Intro text/ }));
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalled());
    const created = getMockDb().sharedSections.at(-1)!;
    expect(created).toMatchObject({ section_type: "intro_text", status: "draft" });
    expect(created.live.name).toBe("Our values");
    expect(nav.push).toHaveBeenCalledWith(`/admin/sections/${created.id}`);
  });

  it("a reader sees the list but neither New shared section nor the trash switch; the trash needs delete", async () => {
    me.current = { ...me.current, permissions: VIEWER };
    renderApp(<SharedSectionsList />);
    await rowOf("Gallery teaser");
    expect(screen.queryByRole("button", { name: "New shared section" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Trash")).not.toBeInTheDocument();
  });

  it("the trash lists the deleted ones with a Restore button (cms.sections:delete)", async () => {
    const user = userEvent.setup();
    nav.search = "trashed=true";
    renderApp(<SharedSectionsList />);
    const old = await rowOf("Old banner");
    await user.click(within(old).getByRole("button", { name: "Restore Old banner" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('"Old banner" was restored as a draft.'));
    expect(getMockDb().sharedSections.find((s) => s.id === 4)).toMatchObject({ deleted_at: null, status: "draft" });
  });
});
