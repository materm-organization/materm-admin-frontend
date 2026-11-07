import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SharedSectionHost } from "@/components/protected/sections/shared-section-host";
import { getMockDb } from "@/mocks/mock-db";
import { createSection, getPage, publishPage } from "@/mocks/mock-pages";
import { touchSharedAsSomeoneElse } from "@/mocks/mock-shared-sections";
import { useMockApi } from "@/mocks/test-setup";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const me = vi.hoisted(() => ({ current: { id: 6, name: "Noy Keomany", roleID: 2, permissions: [] as PermissionGrant[] } }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/sections/1",
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const EDITOR = grants({ "cms.sections": ["read", "create", "update", "delete", "publish", "unpublish", "translate"], "cms.pages": ["read"] });
const VIEWER = grants({ "cms.sections": ["read"] });
const db = () => getMockDb();
const place = (pageId: number, sharedId: number) => createSection(db(), String(pageId), { shared_section_id: sharedId }, getPage(db(), String(pageId)).etag!);
const shared = (id: number) => db().sharedSections.find((s) => s.id === id)!;
const open = async (id = 1) => {
  const view = renderApp(<SharedSectionHost id={id} />);
  await screen.findByTestId("shared-type-line");
  return view;
};

beforeEach(() => {
  me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: EDITOR };
  nav.push.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
});

describe("SharedSectionEditor (SCR-22)", () => {
  useMockApi();

  it("shows the name, the kind with its version (read only), the state, where it is used and no Preview button", async () => {
    place(8, 1);
    await open();
    expect(screen.getByLabelText("Name")).toHaveValue("Gallery teaser");
    expect(screen.getByTestId("shared-type-line")).toHaveTextContent("Gallery cards · version 1");
    expect(screen.getByTestId("shared-used-line")).toHaveTextContent("Used in 1 page");
    expect(screen.getByTestId("publish-bar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.getByTestId("shared-preview-note")).toHaveTextContent("Preview in this page");
    // the form is the section editor of SCR-21 without a "hidden" switch
    expect(await screen.findByTestId("section-editor")).toBeInTheDocument();
    expect(screen.queryByLabelText("Hidden on the website")).not.toBeInTheDocument();
  });

  it("renames inline with the shared section's own ETag; text typed while the save runs stays typed", async () => {
    const user = userEvent.setup();
    await open();
    const input = screen.getByLabelText("Name");
    await user.clear(input);
    await user.type(input, "Teaser A");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.type(input, "B");
    await waitFor(() => expect(shared(1).status).toBe("published"));
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Teaser AB"));
    // the first value reached the server as a draft (the section is published), the second is still unsaved
    const draft = db().revisions["shared-sections/1"].find((r) => r.kind === "draft")!;
    expect((draft.snapshot as { name: string }).name).toBe("Teaser A");
    expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled();
  });

  it("a stale ETag opens the conflict dialog", async () => {
    const user = userEvent.setup();
    await open();
    act(() => void touchSharedAsSomeoneElse(db(), 1));
    const input = screen.getByLabelText("Name");
    await user.clear(input);
    await user.type(input, "Mine");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(await screen.findByRole("dialog", { name: "Someone else changed this item" })).toBeInTheDocument();
  });

  it("publish: the confirmation lists the live pages that show it; unpublish lists the pages that lose it and can always be confirmed", async () => {
    const user = userEvent.setup();
    place(8, 1);
    publishPage(db(), "8", new URLSearchParams(), undefined, getPage(db(), "8").etag!);
    await open();
    await user.click(await screen.findByRole("button", { name: "Unpublish" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(await within(confirm).findByTestId("unpublish-shared-extra")).toHaveTextContent("1 live page loses this section");
    expect(within(confirm).getByTestId("unpublish-shared-pages")).toHaveTextContent("Summer trek");
    expect(within(confirm).getByTestId("unpublish-shared-extra")).toHaveTextContent("cannot be published until you publish it again");
    await user.click(within(confirm).getByRole("button", { name: "Unpublish" }));
    await waitFor(() => expect(shared(1).status).toBe("archived"));
    // the warning of the answer stays on the page as a notice
    expect(await screen.findByTestId("notice-shared_section_referenced")).toHaveTextContent("1 page cannot be published");
  });

  it("publishing a draft shows the pages that go live with it", async () => {
    const user = userEvent.setup();
    place(8, 2);
    await open(2);
    await user.click(await screen.findByRole("button", { name: "Publish" }));
    const dialog = await screen.findByTestId("publish-confirm");
    expect(await within(dialog).findByTestId("publish-shared-extra")).toHaveTextContent("No live page shows it yet");
  });

  it("Delete is disabled with the reason while pages use it; Usage lists them", async () => {
    const user = userEvent.setup();
    place(8, 1);
    await open();
    expect(screen.getByTestId("delete-button")).toBeDisabled();
    expect(screen.getByTestId("delete-reason")).toHaveTextContent("Detach or delete the section in those pages first");
    await user.click(screen.getByRole("tab", { name: "Usage" }));
    expect(await screen.findByTestId("usage-page-8")).toHaveTextContent("Summer trek");
  });

  it("an unused section is deleted after a confirmation and the editor goes back to the list", async () => {
    const user = userEvent.setup();
    await open(2);
    await user.click(screen.getByTestId("delete-button"));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/admin/sections"));
    expect(shared(2).deleted_at).not.toBeNull();
  });

  it("a delete that the server refuses (the counts were stale) lists the pages from the 409, a page in the trash with its hint", async () => {
    const user = userEvent.setup();
    await open();
    // used after the screen loaded: the page 8 names it now (the editor still shows 'not used')
    place(8, 1);
    const trashedPage = db().pages.find((p) => p.id === 7)!;
    trashedPage.live.sections.push({ ...trashedPage.live.sections[0], id: 900, public_id: "0192d3a4-7c1e-7b52-9d0a-3f5e2a1b5900", section_type: "gallery_cards", shared_section_id: 1, props: {} });
    await user.click(screen.getByTestId("delete-button"));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByTestId("delete-blocked");
    expect(within(dialog).getAllByTestId("reference-row")).toHaveLength(2);
    expect(dialog).toHaveTextContent("The page is in the trash.");
    expect(dialog).toHaveTextContent("restore the page first");
    expect(shared(1).deleted_at).toBeNull();
  });

  it("a trashed shared section is read only with a Restore button for those who may delete", async () => {
    const user = userEvent.setup();
    await open(4);
    expect(screen.getByTestId("shared-trashed-banner")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("readonly");
    await user.click(screen.getByTestId("restore-button"));
    await waitFor(() => expect(shared(4).deleted_at).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('"Old banner" was restored as a draft.');
  });

  it("Usage: 'Preview in this page' makes the ordinary page preview link (a page in the trash has none); with no page using it the button is disabled and says why", async () => {
    const user = userEvent.setup();
    me.current = { ...me.current, permissions: grants({ "cms.sections": ["read", "create", "update", "delete", "publish", "unpublish"], "cms.pages": ["read", "update"], "cms.locales": ["read"] }) };
    place(8, 1);
    const trashedPage = db().pages.find((p) => p.id === 7)!;
    trashedPage.live.sections.push({ ...trashedPage.live.sections[0], id: 900, public_id: "0192d3a4-7c1e-7b52-9d0a-3f5e2a1b5900", section_type: "gallery_cards", shared_section_id: 1, props: {} });
    const { unmount } = await open();
    await user.click(screen.getByRole("tab", { name: "Usage" }));
    expect(await screen.findByTestId("preview-in-page-8")).toBeInTheDocument();
    expect(screen.queryByTestId("preview-in-page-7")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("preview-in-page-8"));
    const dialog = await screen.findByRole("dialog", { name: "Preview link" });
    expect(within(dialog).getByTestId("preview-frozen-shared")).toHaveTextContent("create a new link to see them");
    await user.click(within(dialog).getByRole("button", { name: /^Create/ }));
    await waitFor(() => expect(getMockDb().previewLinks.some((l) => l.page_id === 8)).toBe(true));
    unmount();
    await open(2);
    await user.click(screen.getAllByRole("tab", { name: "Usage" }).at(-1)!);
    expect(await screen.findByTestId("preview-none")).toHaveTextContent("No page uses this shared section");
    expect(within(screen.getByTestId("preview-none")).getByRole("button", { name: "Preview in this page" })).toBeDisabled();
  });

  it("a reader has no commands, no rename and no Delete; the form is read only", async () => {
    me.current = { ...me.current, permissions: VIEWER };
    await open();
    expect(screen.queryByRole("button", { name: "Rename" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("delete-button")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish changes" })).not.toBeInTheDocument();
    expect(screen.getByText("You may read this shared section but not change it.")).toBeInTheDocument();
  });

  it("History shows the trail of cms.shared_section with cms.sections:read only", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("tab", { name: "Activity" }));
    expect(await screen.findByTestId("entity-activity")).toHaveTextContent("cms.shared_section.created");
  });

  it("an unknown id is a not-found state, not an empty editor", async () => {
    renderApp(<SharedSectionHost id={999} />);
    expect(await screen.findByText("Shared section not found")).toBeInTheDocument();
  });
});
