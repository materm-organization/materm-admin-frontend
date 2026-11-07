import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PageHost } from "@/components/protected/pages/page-host";
import { getMockDb } from "@/mocks/mock-db";
import { createSection, getPage } from "@/mocks/mock-pages";
import { useMockApi } from "@/mocks/test-setup";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const me = vi.hoisted(() => ({ current: { id: 6, roleID: 2, permissions: [] as PermissionGrant[] } }));
const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/pages/8",
  useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const ALL = {
  "cms.pages": ["read", "create", "update", "delete", "publish", "unpublish", "review", "translate"],
  "cms.sections": ["read", "create", "update", "delete", "publish", "unpublish", "translate"],
  "cms.seo": ["read", "update", "translate"],
};
const db = () => getMockDb();
const sectionsOf = (id: number) => db().pages.find((p) => p.id === id)!.live.sections;
// Page 8 is a draft (rows written in place): hero + intro text. Shared 1 = published gallery cards, 2 = a draft intro text.
const place = (sharedId: number) => createSection(db(), "8", { shared_section_id: sharedId }, getPage(db(), "8").etag!);
const open = async (search = "") => {
  nav.search = search;
  const view = renderApp(<PageHost id={8} />);
  await screen.findByTestId("section-list");
  return view;
};

beforeEach(() => {
  me.current = { id: 6, roleID: 2, permissions: grants(ALL) };
  nav.search = "";
  nav.replace.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
});

describe("PageEditor: shared sections (SCR-20, 05 18.9)", () => {
  useMockApi();

  it("the Shared tab of the picker offers what fits the page; picking one places a reference and warns when it is not published", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "Add section" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a section" });
    await user.click(within(dialog).getByRole("tab", { name: "Shared" }));
    expect(await within(dialog).findByTestId("shared-option-1")).toHaveTextContent("Gallery teaser");
    // only the draft intro text carries the "not published" hint
    expect(within(dialog).getByTestId("shared-option-2")).toHaveTextContent("Not published yet");
    await user.click(within(dialog).getByTestId("shared-option-2"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("The section was added."));
    expect(toast.warning).toHaveBeenCalledWith("This shared section is not published yet. Publishing the page is blocked until it is.");
    const created = sectionsOf(8).at(-1)!;
    expect(created).toMatchObject({ shared_section_id: 2, props: {}, variant: null });
    const row = await screen.findByTestId(`section-row-${created.id}`);
    expect(row).toHaveTextContent("Shared");
    expect(row).toHaveTextContent("Our promise (text)");
    expect(within(row).getByTestId("shared-state-badge")).toHaveTextContent("Not published");
    // a reference has no language badges
    expect(within(row).queryByTitle("All languages complete")).not.toBeInTheDocument();
  });

  it("a reference opens the read-only panel with 'Edit source' (a new tab) and no props editor", async () => {
    const created = place(1).data.section as { id: number };
    await open(`section=${created.id}`);
    const panel = await screen.findByTestId("shared-reference-panel");
    expect(screen.queryByTestId("section-editor")).not.toBeInTheDocument();
    expect(within(panel).getByTestId("shared-reference-name")).toHaveTextContent("Gallery teaser");
    const link = within(panel).getByTestId("edit-source-link");
    expect(link).toHaveAttribute("href", "/admin/sections/1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(await within(panel).findByTestId("shared-readonly-note")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /^Save/ })).not.toBeInTheDocument();
  });

  it("a shared section that is not published says so in the panel (the page cannot be published while it is shown)", async () => {
    const created = place(2).data.section as { id: number };
    await open(`section=${created.id}`);
    expect(await screen.findByTestId("shared-not-live-alert")).toHaveTextContent("Publishing this page is blocked");
  });

  it("Detach to a copy: a confirmation, then the section is the page's own with the shared draft copied; the ordinary editor takes over", async () => {
    const user = userEvent.setup();
    const created = place(3).data.section as { id: number };
    await open(`section=${created.id}`);
    await user.click(await screen.findByTestId("detach-button"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("including its unpublished draft");
    await user.click(within(dialog).getByRole("button", { name: "Detach" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("The section is now a copy that belongs to this page only."));
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("unpublished draft of the shared section was copied"));
    const own = sectionsOf(8).find((s) => s.id === created.id)!;
    expect(own.shared_section_id).toBeNull();
    expect(own.props).toMatchObject({ accessible_heading: { la: "The forest photo story (revised)" } });
    expect(await screen.findByTestId("section-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("shared-reference-panel")).not.toBeInTheDocument();
  });

  it("the ⋯ menu of a reference has the detach item; deleting it says only the reference goes", async () => {
    const user = userEvent.setup();
    const created = place(1).data.section as { id: number };
    await open();
    await screen.findByTestId(`section-row-${created.id}`);
    await user.click(within(screen.getByTestId(`section-row-${created.id}`)).getByRole("button", { name: /More actions for/ }));
    expect(await screen.findByRole("menuitem", { name: "Detach to a page-only copy" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("The shared section itself is not deleted");
  });

  it("publishing is blocked while a shown reference points at a draft: the blocker links to the shared section and 'Go to field' selects the section", async () => {
    const user = userEvent.setup();
    const created = place(2).data.section as { id: number; public_id: string };
    await open();
    await user.click(await screen.findByRole("button", { name: "Publish" }));
    const dialog = await screen.findByTestId("publish-blockers");
    expect(within(dialog).getByTestId("publish-blocker")).toHaveTextContent("The shared section is not published yet");
    expect(within(dialog).getByTestId("open-shared-link")).toHaveAttribute("href", "/admin/sections/2");
    await user.click(within(dialog).getByRole("button", { name: /^Go to field/ }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    expect(nav.replace.mock.calls.at(-1)![0]).toContain(encodeURIComponent(`/sections/${created.public_id}/shared_section_id`));
  });

  it("without cms.sections:update there is neither Detach nor the visibility switch; without read there is no Shared tab", async () => {
    const user = userEvent.setup();
    const created = place(1).data.section as { id: number };
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.pages": ["read", "update"], "cms.sections": ["read", "create"] }) };
    await open(`section=${created.id}`);
    const panel = await screen.findByTestId("shared-reference-panel");
    expect(within(panel).queryByTestId("detach-button")).not.toBeInTheDocument();
    expect(within(panel).queryByLabelText("Hidden on the website")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add section" }));
    expect(await screen.findByRole("tab", { name: "Shared" })).toBeInTheDocument();
  });
});
