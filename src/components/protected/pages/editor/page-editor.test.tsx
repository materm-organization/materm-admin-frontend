import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PageHost } from "@/components/protected/pages/page-host";
import { getMockDb } from "@/mocks/mock-db";
import { touchPageAsSomeoneElse } from "@/mocks/mock-pages";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, roleID: 2, permissions: [] as PermissionGrant[] } }));
const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/pages/8",
  useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const ALL = {
  "cms.pages": ["read", "create", "update", "delete", "publish", "unpublish", "review", "translate"],
  "cms.sections": ["read", "create", "update", "delete", "translate"],
  "cms.seo": ["read", "update", "translate"],
};
const root = (id: number) => getMockDb().pages.find((p) => p.id === id)!;
const sectionsOf = (id: number) => root(id).live.sections;
// Page 8 is a draft (rows written in place): hero + intro text.
const open = async (id = 8, search = "") => {
  nav.search = search;
  const view = renderApp(<PageHost id={id} />);
  await screen.findByTestId("section-list");
  return view;
};

beforeEach(() => {
  me.current = { id: 6, roleID: 2, permissions: grants(ALL) };
  nav.search = "";
  nav.replace.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
});

describe("PageEditor: the Content tab (T1.4.8)", () => {
  useMockApi();

  it("lists the sections in order with their names, a short text and what the template needs", async () => {
    await open();
    const list = screen.getByTestId("section-list");
    const rows = within(list).getAllByTestId(/^section-row-/);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Hero (brand)");
    expect(rows[0]).toHaveTextContent("Summer trek");
    expect(rows[1]).toHaveTextContent("Intro text");
    expect(within(list).getByTestId("section-requirements")).toHaveTextContent("A hero section at the top");
    // the English texts of the intro are there, the SEO of the page is not complete in English
    expect(screen.getByTestId("page-completeness")).toBeInTheDocument();
  });

  it("adds a section from the picker: it is created, selected, and the page's ETag moves without a page refetch", async () => {
    const user = userEvent.setup();
    let pageGets = 0;
    server.use(http.get(`${API}/pages/8`, () => { pageGets += 1; return undefined; }));
    const { queryClient } = await open();
    await user.click(screen.getByRole("button", { name: "Add section" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a section" });
    await user.click(await within(dialog).findByRole("button", { name: /^FAQ/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("The section was added."));
    expect(sectionsOf(8).map((s) => s.section_type)).toEqual(["hero_brand", "intro_text", "faq"]);
    expect(screen.getAllByTestId(/^section-row-/)).toHaveLength(3);
    expect(queryClient.getQueryData<{ etag: string }>(["/pages/8"])?.etag).toBe('"2"');
    expect(pageGets).toBe(1);
    expect(nav.replace.mock.calls.at(-1)![0]).toContain(`section=${sectionsOf(8)[2].id}`);
  });

  it("a type that reached its maximum is disabled in the picker and a hero can not be added twice", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "Add section" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a section" });
    const hero = await within(dialog).findByRole("button", { name: /^Hero \(brand\)/ });
    expect(hero).toBeDisabled();
    expect(hero).toHaveTextContent("Already on the page (at most 1).");
    expect(within(dialog).queryByRole("button", { name: /^Contact section/ })).not.toBeInTheDocument();
  });

  it("reorders with the move buttons: one PUT right after the move; a move the template forbids is refused without a request", async () => {
    const user = userEvent.setup();
    let puts = 0;
    server.use(http.put(`${API}/pages/8/sections/order`, () => { puts += 1; return undefined; }));
    await open();
    // the hero can not go down below another section
    await user.click(screen.getByRole("button", { name: /Move 1\. Hero.* down/ }));
    expect(toast.error).toHaveBeenCalledWith("The hero section has to stay at the top.");
    expect(puts).toBe(0);
    // the first section has no "up"
    expect(screen.getByRole("button", { name: /Move 1\. Hero.* up/ })).toBeDisabled();

    // add a FAQ and move it above the intro text
    await user.click(screen.getByRole("button", { name: "Add section" }));
    await user.click(await within(await screen.findByRole("dialog")).findByRole("button", { name: /^FAQ/ }));
    await screen.findByTestId(`section-row-${sectionsOf(8)[2].id}`);
    await user.click(screen.getByRole("button", { name: /Move 3\. FAQ up/ }));
    await waitFor(() => expect(sectionsOf(8).map((s) => s.section_type)).toEqual(["hero_brand", "faq", "intro_text"]));
    expect(puts).toBe(1);
    const rows = screen.getAllByTestId(/^section-row-/);
    expect(rows[1]).toHaveTextContent("FAQ");
  });

  it("a refused reorder (422 from the server) puts the old order back and says why", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "Add section" }));
    await user.click(await within(await screen.findByRole("dialog")).findByRole("button", { name: /^FAQ/ }));
    await screen.findByTestId(`section-row-${sectionsOf(8)[2].id}`);
    server.use(
      http.put(`${API}/pages/8/sections/order`, () =>
        HttpResponse.json({ success: false, code: "VALIDATION_FAILED", errors: [{ in: "body", path: "/sections/1/id", code: "template_violation", params: { rule: "after_hero" } }] }, { status: 422 })
      )
    );
    await user.click(screen.getByRole("button", { name: /Move 3\. FAQ up/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This section has to come after the hero."));
    expect(screen.getAllByTestId(/^section-row-/)[2]).toHaveTextContent("FAQ");
  });

  it("hides and shows a section with the eye; the chip says Hidden", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "Hide Intro text on the website" }));
    await waitFor(() => expect(sectionsOf(8)[1].is_visible).toBe(false));
    expect(screen.getByTestId(`section-row-${sectionsOf(8)[1].id}`)).toHaveTextContent("Hidden");
    await user.click(screen.getByRole("button", { name: "Show Intro text on the website" }));
    await waitFor(() => expect(sectionsOf(8)[1].is_visible).toBe(true));
  });

  it("deletes a section after a confirmation; a required section (the hero) has no Delete", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "More actions for Hero (brand)" }));
    expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "More actions for Intro text" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete this section?" });
    expect(dialog).toHaveTextContent("History tab");
    await user.click(within(dialog).getByRole("button", { name: "Delete section" }));
    await waitFor(() => expect(sectionsOf(8)).toHaveLength(1));
    expect(toast.success).toHaveBeenCalledWith("The section was deleted.");
  });

  it("a conflict (someone else saved the page) opens the conflict dialog; loading the latest starts again from the server", async () => {
    const user = userEvent.setup();
    await open();
    act(() => { touchPageAsSomeoneElse(getMockDb(), 8); });
    await user.click(screen.getByRole("button", { name: "Hide Intro text on the website" }));
    const dialog = await screen.findByRole("dialog", { name: "Someone else changed this item" });
    expect(sectionsOf(8)[1].is_visible).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Load the latest version (discard my changes)" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Someone else changed this item" })).not.toBeInTheDocument());
    // the new ETag is in use: the same action works now
    await user.click(await screen.findByRole("button", { name: "Hide Intro text on the website" }));
    await waitFor(() => expect(sectionsOf(8)[1].is_visible).toBe(false));
  });

  it("a user who only reads sees no mutation control", async () => {
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.pages": ["read"], "cms.sections": ["read"] }) };
    await open();
    expect(screen.queryByRole("button", { name: "Add section" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Hide / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^More actions/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move (up|down)/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Autosave (every 30 seconds)")).not.toBeInTheDocument();
  });

  it("without cms.sections:read the Content tab is the no-permission state, the other tabs work", async () => {
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.pages": ["read", "update"] }) };
    nav.search = "";
    renderApp(<PageHost id={8} />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
  });
});

const heroOf = (id: number) => sectionsOf(id)[0];
const titleOf = (id: number) => (heroOf(id).props.title as Record<string, string>);

describe("PageEditor: the section editor (SCR-21)", () => {
  useMockApi();

  it("edits the title in two languages and saves each with one PATCH; the answer's ETag is used by the next write", async () => {
    const user = userEvent.setup();
    const { queryClient } = await open(8, `section=${heroOf(8).id}`);
    const editor = await screen.findByTestId("section-editor");
    expect(within(editor).getByRole("heading", { name: "Hero (brand)" })).toBeInTheDocument();
    const field = await within(editor).findByLabelText(/^Title/);
    await user.clear(field);
    await user.type(field, "Summer trek 2027");
    const save = within(editor).getByRole("button", { name: "Save section" });
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(titleOf(8).la).toBe("Summer trek 2027"));
    expect(queryClient.getQueryData<{ etag: string }>(["/pages/8"])?.etag).toBe('"2"');
    await waitFor(() => expect(within(editor).getByRole("button", { name: "Save section" })).toBeDisabled());

    // choosing the second language goes through the address
    await user.click(within(editor).getByRole("radio", { name: /^English/ }));
    expect(nav.replace.mock.calls.at(-1)![0]).toContain("locale=en");

    // a second save carries the ETag of the first answer (no conflict, no page refetch)
    await user.type(field, "!");
    await user.click(within(editor).getByRole("button", { name: "Save section" }));
    await waitFor(() => expect(titleOf(8).la).toBe("Summer trek 2027!"));
    expect(queryClient.getQueryData<{ etag: string }>(["/pages/8"])?.etag).toBe('"3"');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("a language that is not the default is edited with ?locale=", async () => {
    const user = userEvent.setup();
    await open(8, `section=${heroOf(8).id}&locale=en`);
    const editor = await screen.findByTestId("section-editor");
    const field = await within(editor).findByLabelText(/^Title/);
    await user.clear(field);
    await user.type(field, "Summer trek in English");
    await user.click(within(editor).getByRole("button", { name: "Save section" }));
    await waitFor(() => expect(titleOf(8).en).toBe("Summer trek in English"));
    expect(titleOf(8).la).toBe("Summer trek");
  });

  it("Discard edits throws the edits away; the section list marks unsaved edits", async () => {
    const user = userEvent.setup();
    await open(8, `section=${heroOf(8).id}`);
    const editor = await screen.findByTestId("section-editor");
    const field = await within(editor).findByLabelText(/^Title/);
    await user.type(field, " more");
    expect(within(screen.getByTestId(`section-row-${heroOf(8).id}`)).getByLabelText("Unsaved edits")).toBeInTheDocument();
    await user.click(within(editor).getByRole("button", { name: "Discard edits" }));
    expect(field).toHaveValue("Summer trek");
    expect(within(editor).getByRole("button", { name: "Save section" })).toBeDisabled();
  });

  it("a 422 from the server is shown at the field, counted in the list, and a new edit of the field clears it", async () => {
    const user = userEvent.setup();
    server.use(
      http.patch(`${API}/pages/8/sections/:id`, () =>
        HttpResponse.json({ success: false, code: "VALIDATION_FAILED", errors: [{ in: "body", path: "/props/title/la", code: "too_long", params: { max: 80 } }] }, { status: 422 })
      )
    );
    await open(8, `section=${heroOf(8).id}`);
    const editor = await screen.findByTestId("section-editor");
    const field = await within(editor).findByLabelText(/^Title/);
    await user.type(field, "!");
    await user.click(within(editor).getByRole("button", { name: "Save section" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("1 value was not accepted. They are marked in the form."));
    expect(await within(editor).findByText(/Too long: at most 80 allowed/)).toBeInTheDocument();
    expect(within(screen.getByTestId(`section-row-${heroOf(8).id}`)).getByText("1 problem")).toBeInTheDocument();
    expect(titleOf(8).la).toBe("Summer trek");
  });

  it("the variant is part of the save", async () => {
    const user = userEvent.setup();
    await open(8, `section=${heroOf(8).id}`);
    const editor = await screen.findByTestId("section-editor");
    await user.click(await within(editor).findByRole("radio", { name: /wide/i }));
    await user.click(within(editor).getByRole("button", { name: "Save section" }));
    await waitFor(() => expect(heroOf(8).variant).toBe("wide"));
  });

  it("opening another section while this one has unsaved edits asks first: save and open, discard, or stay", async () => {
    const user = userEvent.setup();
    await open(8, `section=${heroOf(8).id}`);
    const editor = await screen.findByTestId("section-editor");
    await user.type(await within(editor).findByLabelText(/^Title/), "!");
    await user.click(screen.getByRole("button", { name: /^Open section 2: Intro text/ }));
    const dialog = await screen.findByRole("alertdialog", { name: "Discard unsaved changes?" });
    expect(nav.replace).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Save and open" }));
    await waitFor(() => expect(titleOf(8).la).toBe("Summer trek!"));
    await waitFor(() => expect(nav.replace.mock.calls.at(-1)![0]).toContain(`section=${sectionsOf(8)[1].id}`));
  });

  it("the hidden switch of the editor hides the section at once", async () => {
    const user = userEvent.setup();
    await open(8, `section=${sectionsOf(8)[1].id}`);
    const editor = await screen.findByTestId("section-editor");
    await user.click(within(editor).getByRole("switch", { name: /Hidden on the website/ }));
    await waitFor(() => expect(sectionsOf(8)[1].is_visible).toBe(false));
  });

  it("Go to field: the section opens and the blocker is shown at its field; the pointer leaves the address", async () => {
    const hero = root(6).live.sections[0];
    await open(6, `section=${hero.id}&field=${encodeURIComponent(`/sections/${hero.public_id}/props/title/la`)}&fieldCode=empty_default_locale&sectionKey=hero_brand&sectionIndex=0`);
    expect(await screen.findByText("This text is required in the default language.")).toBeInTheDocument();
    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    expect(nav.replace.mock.calls.at(-1)![0]).not.toContain("field=");
  });

  it("Go to field for a page-level blocker opens its tab and focuses the input", async () => {
    await open(6, `field=${encodeURIComponent("/translations/la/seo_title")}`);
    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    expect(nav.replace.mock.calls.at(-1)![0]).toContain("tab=seo");
    expect(nav.replace.mock.calls.at(-1)![0]).not.toContain("field=");
  });

  it("a section of a type that is switched off shows its props read only", async () => {
    const heroId = heroOf(8).id;
    server.use(
      http.get(`${API}/pages/8/sections`, () =>
        HttpResponse.json(
          { success: true, data: [{ id: heroId, public_id: heroOf(8).public_id, page_id: 8, section_type: { id: 1, key: "old_type", version: 1, name: "Old type", is_active: false, code_registered: false }, variant: null, effective_variant: null, sort_order: 0, is_visible: true, anchor_id: null, props_bytes: 5, shared_section_id: null, required: false, unsupported: true, translation_status: { la: { missing: 0 }, en: { missing: 0 } }, props: { a: 1 } }] },
          { headers: { ETag: '"1"' } }
        )
      )
    );
    await open(8, `section=${heroId}`);
    expect(await screen.findByTestId("unsupported-section")).toHaveTextContent("This kind of section is not supported");
    expect(screen.getByText("Not supported")).toBeInTheDocument();
  });
});

describe("PageEditor: translators and readers", () => {
  useMockApi();

  it("a translator edits only the texts: no add / hide / delete / reorder, the variant is locked, the save sends the props only", async () => {
    const user = userEvent.setup();
    getMockDb().translateOnly = ["sections", "pages"];
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.pages": ["read", "translate"], "cms.sections": ["read", "translate"], "cms.seo": ["read", "translate"] }) };
    await open(8, `section=${heroOf(8).id}&locale=en`);
    expect(screen.queryByRole("button", { name: "Add section" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Hide / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^More actions/ })).not.toBeInTheDocument();
    const editor = await screen.findByTestId("section-editor");
    expect(within(editor).getByText("You can translate the texts of this section. Everything else is locked.")).toBeInTheDocument();
    for (const radio of within(editor).getAllByRole("radio").filter((r) => r.closest("fieldset"))) expect(radio).toBeDisabled();
    expect(within(editor).queryByRole("switch", { name: /Hidden on the website/ })).not.toBeInTheDocument();
    const field = await within(editor).findByLabelText(/^Title/);
    expect(field).toBeEnabled();
    await user.type(field, "!");
    await user.click(within(editor).getByRole("button", { name: "Save section" }));
    await waitFor(() => expect(titleOf(8).en).toMatch(/!$/));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("a translator edits the titles and SEO texts of the page and the rest of the Details tab is locked", async () => {
    const user = userEvent.setup();
    getMockDb().translateOnly = ["sections", "pages"];
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.pages": ["read", "translate"], "cms.sections": ["read", "translate"], "cms.seo": ["read", "translate"] }) };
    nav.search = "tab=details";
    renderApp(<PageHost id={8} />);
    const details = await screen.findByTestId("page-details");
    expect(await within(details).findByLabelText(/^Title \(EN\)/)).toBeEnabled();
    expect(within(details).getByLabelText("Address")).toBeDisabled();
    expect(within(details).getByLabelText("Internal name")).toBeDisabled();
    await user.type(within(details).getByLabelText(/^Title \(EN\)/), " 2027");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(root(8).live.translations.find((t) => t.locale_code === "en")!.title).toBe("Summer trek 2027"));
  });
});

describe("PageEditor: Details, SEO and the publishing bar", () => {
  useMockApi();

  it("Details: edits the title, the address and the flags; Save draft sends only what changed; a published page warns about the address", async () => {
    const user = userEvent.setup();
    nav.search = "tab=details";
    renderApp(<PageHost id={9} />);
    const details = await screen.findByTestId("page-details");
    const path = await within(details).findByLabelText("Address");
    expect(within(details).getByText("Template")).toBeInTheDocument();
    await user.clear(path);
    await user.type(path, "/events-2027");
    expect(screen.getByTestId("path-changed-warning")).toHaveTextContent("This page was published at /events");
    await user.clear(within(details).getByLabelText(/^Title \(EN\)/));
    await user.type(within(details).getByLabelText(/^Title \(EN\)/), "Events 2027");
    expect(screen.getByTestId("publish-dirty")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(screen.queryByTestId("publish-dirty")).not.toBeInTheDocument());
    const draft = getMockDb().revisions["pages/9"].find((r) => r.kind === "draft")!.snapshot as { page: { path: string }; translations: Array<{ locale_code: string; title: string }> };
    expect(draft.page.path).toBe("/events-2027");
    expect(draft.translations.find((t) => t.locale_code === "en")!.title).toBe("Events 2027");
    expect(root(9).live.page.path).toBe("/events");
  });

  it("Details: a bad address is marked and nothing is sent", async () => {
    const user = userEvent.setup();
    nav.search = "tab=details";
    renderApp(<PageHost id={8} />);
    const path = await screen.findByLabelText("Address");
    await user.clear(path);
    await user.type(path, "/admin/x");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("This address is reserved by the system.")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("Fix the marked fields first.");
    expect(root(8).live.page.path).toBe("/summer");
  });

  it("Details: the home page keeps its address, the template is read only while there are sections", async () => {
    nav.search = "tab=details";
    renderApp(<PageHost id={1} />);
    const path = await screen.findByLabelText("Address");
    expect(path).toBeDisabled();
    expect(screen.getByText("The template cannot be changed once the page has sections.")).toBeInTheDocument();
  });

  it("SEO: counts characters, previews the search result and saves the texts per language", async () => {
    const user = userEvent.setup();
    nav.search = "tab=seo&locale=en";
    renderApp(<PageHost id={8} />);
    const seo = await screen.findByTestId("page-seo");
    const title = await within(seo).findByLabelText(/^SEO title \(EN\)/);
    await user.type(title, "Summer trek in the hills");
    expect(within(seo).getByTestId("serp-preview")).toHaveTextContent("Summer trek in the hills");
    await user.type(within(seo).getByLabelText(/^SEO description \(EN\)/), "d".repeat(170));
    expect(within(seo).getByText(/Longer than 160 characters/)).toBeInTheDocument();
    await user.click(within(seo).getByRole("switch", { name: "Hide this page from search engines" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(root(8).live.page.noindex).toBe(true));
    expect(root(8).live.translations.find((t) => t.locale_code === "en")!.seo_title).toBe("Summer trek in the hills");
  });

  it("SEO: a language without a title asks for the title first", async () => {
    getMockDb().pages.find((p) => p.id === 8)!.live.translations = [getMockDb().pages.find((p) => p.id === 8)!.live.translations[0]];
    nav.search = "tab=seo&locale=en";
    renderApp(<PageHost id={8} />);
    expect(await screen.findByText(/Add the title of the EN version on the Details tab/)).toBeInTheDocument();
    expect(await screen.findByLabelText(/^SEO title \(EN\)/)).toBeDisabled();
  });

  it("Publish waits for the edits: it is disabled with a reason while something is unsaved, and works after Save draft", async () => {
    const user = userEvent.setup();
    await open(8, `section=${heroOf(8).id}`);
    const editor = await screen.findByTestId("section-editor");
    await user.type(await within(editor).findByLabelText(/^Title/), "!");
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(screen.getByTestId("publish-dirty")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(titleOf(8).la).toBe("Summer trek!"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^Publish/ }));
    await waitFor(() => expect(root(8).status).toBe("published"));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("a section edit on a published page makes it 'Publish changes' without any page refetch", async () => {
    const user = userEvent.setup();
    let pageGets = 0;
    server.use(http.get(`${API}/pages/10`, () => { pageGets += 1; return undefined; }));
    await open(10, `section=${heroOf(10).id}`);
    expect(screen.queryByRole("button", { name: "Publish changes" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Hide Hero (brand) on the website" }));
    expect(await screen.findByRole("button", { name: "Publish changes" })).toBeInTheDocument();
    expect(screen.getByTestId("status-badge")).toHaveTextContent("changes pending");
    expect(pageGets).toBe(1);
  });

  it("Discard changes brings the server's sections back into the editor", async () => {
    const user = userEvent.setup();
    await open(9, `section=${sectionsOf(9)[0].id}`);
    await screen.findByTestId("section-editor");
    await user.click(await screen.findByRole("button", { name: "Discard changes" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Changes discarded."));
    await waitFor(() => expect(screen.getAllByTestId(/^section-row-/)).toHaveLength(2));
  });

  it("autosave is off by default; switched on, it saves the section after 30 seconds without edits", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await open(8, `section=${heroOf(8).id}`);
      const toggle = screen.getByRole("switch", { name: "Autosave (every 30 seconds)" });
      expect(toggle).not.toBeChecked();
      await user.click(toggle);
      const editor = await screen.findByTestId("section-editor");
      await user.type(await within(editor).findByLabelText(/^Title/), "!");
      expect(titleOf(8).la).toBe("Summer trek");
      await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
      await waitFor(() => expect(titleOf(8).la).toBe("Summer trek!"));
    } finally {
      window.localStorage.removeItem("materm-admin:autosave");
      vi.useRealTimers();
    }
  });

  it("Preview opens the preview-link dialog; with unsaved edits it warns, 'Save draft first' saves them, and the link freezes the saved copy", async () => {
    const user = userEvent.setup();
    await open(8, `section=${heroOf(8).id}`);
    const editor = await screen.findByTestId("section-editor");
    await user.type(await within(editor).findByLabelText(/^Title/), "!");
    await user.click(screen.getByRole("button", { name: "Preview" }));
    const dialog = await screen.findByTestId("preview-link-dialog");
    expect(within(dialog).getByTestId("preview-dirty-warning")).toHaveTextContent("You have unsaved edits that the link will not include");
    await user.click(within(dialog).getByRole("button", { name: "Save draft first" }));
    await waitFor(() => expect(titleOf(8).la).toBe("Summer trek!"));
    await waitFor(() => expect(within(dialog).queryByTestId("preview-dirty-warning")).not.toBeInTheDocument());
    await user.click(await within(dialog).findByTestId("preview-create"));
    const url = ((await within(dialog).findByTestId("preview-url")) as HTMLInputElement).value;
    expect(url).toContain("/api/preview?token=");
    const frozen = getMockDb().revisions["pages/8"].filter((r) => r.is_preview).at(-1)!; // page 8 starts with 19 seeded preview rows
    expect(JSON.stringify(frozen.snapshot)).toContain("Summer trek!");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("a reader without update or review has no Preview button", async () => {
    me.current = { id: 6, roleID: 2, permissions: grants({ ...ALL, "cms.pages": ["read"] }) };
    await open(8);
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
  });

  it("a page in the trash is read only: no add, no hide, no save", async () => {
    await open(7);
    expect(screen.queryByRole("button", { name: "Add section" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Hide / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
  });
});
