import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";

import { FaqHost } from "@/components/protected/faq/faq-host";
import { touchFaqGroupAsSomeoneElse } from "@/mocks/mock-faq";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, name: "Noy Keomany", roleID: 2, permissions: [] as PermissionGrant[] } }));
const nav = vi.hoisted(() => ({ search: "", replace: vi.fn(), push: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/faq/2",
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const EDITOR = grants({ "cms.faq": ["read", "create", "update", "delete", "publish", "unpublish", "translate"], "cms.locales": ["read"] });
const TRANSLATOR = grants({ "cms.faq": ["read", "translate"], "cms.locales": ["read"] });

const root = (id: number) => getMockDb().faqGroups.find((g) => g.id === id)!;
const open = async (id = 1, search = "") => {
  nav.search = search;
  const view = renderApp(<FaqHost id={id} />);
  await screen.findByTestId(search.includes("tab=settings") ? "faq-settings" : search.includes("tab=revisions") ? "revisions-tab" : "faq-items", {}, { timeout: 4000 });
  if (!search.includes("tab=")) await screen.findAllByTestId(/^faq-item-\d+$/, {}, { timeout: 4000 });
  return view;
};
const user = () => userEvent.setup();
// Types into the Tiptap editor of an answer through its editor instance (jsdom has no real typing for contenteditable).
const typeAnswer = async (scope: HTMLElement, text: string) => {
  const pm = scope.querySelector(".ProseMirror") as unknown as { editor: Editor };
  await act(async () => {
    pm.editor.chain().focus().insertContent(text).run();
  });
};

beforeEach(() => {
  me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: EDITOR };
  nav.search = "";
  nav.replace.mockReset();
  nav.push.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
});

describe("FaqEditor: the questions tab", () => {
  useMockApi();

  it("shows the name, the key, the chip, the questions in order (the hidden one marked) and how many of 100", async () => {
    await open(1);
    expect(screen.getByRole("heading", { level: 1, name: "Contact questions" })).toBeInTheDocument();
    expect(screen.getByText("contact")).toBeInTheDocument();
    expect(screen.getByTestId("status-badge")).toHaveTextContent("Published");
    expect(screen.getAllByTestId(/^faq-item-\d+$/).map((el) => el.getAttribute("data-testid"))).toEqual(["faq-item-1", "faq-item-2", "faq-item-3", "faq-item-4"]);
    expect(screen.getByTestId("faq-items-count")).toHaveTextContent("4 of 100 questions");
    expect(within(screen.getByTestId("faq-item-3")).getByText("Hidden")).toBeInTheDocument();
    expect(within(screen.getByTestId("faq-item-1")).getByText("How do I book a trip?")).toBeInTheDocument();
  });

  it("a question opens to its texts in the chosen language; one Save sends ONLY the changed text with the group's ETag and moves it from the answer", async () => {
    const u = user();
    const seen: Array<{ ifMatch: string | null; body: unknown }> = [];
    server.use(http.patch(`${API}/faq-groups/1/items/1`, async ({ request }) => { seen.push({ ifMatch: request.headers.get("If-Match"), body: await request.clone().json() }); return undefined; }));
    const { queryClient } = await open(1);
    const item = screen.getByTestId("faq-item-1");
    await u.click(within(item).getByRole("button", { name: /How do I book a trip\?/ }));
    const panel = await screen.findByTestId("faq-item-panel-1");
    const question = within(panel).getByLabelText(/^Question/);
    expect(question).toHaveValue("How do I book a trip?");
    await u.clear(question);
    await u.type(question, "How can I book?");
    expect(within(item).getByTestId("faq-item-dirty-1")).toBeInTheDocument();
    expect(screen.getByTestId("publish-dirty")).toBeInTheDocument();
    await u.click(within(panel).getByRole("button", { name: "Save question" }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({ ifMatch: '"1"', body: { translations: { la: { question: "How can I book?" } } } });
    await waitFor(() => expect(screen.queryByTestId("faq-item-dirty-1")).not.toBeInTheDocument());
    expect(queryClient.getQueryData<{ etag: string }>(["/faq-groups/1"])?.etag).toBe('"2"');
    expect(root(1).live.items[0].translations[0].question).toBe("How do I book a trip?"); // published: the edit is in the draft
    expect(screen.getByTestId("status-badge")).toHaveTextContent("Published, changes pending");
  });

  it("the English texts of a question: a row needs BOTH texts; the save is held back and the field says it", async () => {
    const u = user();
    await open(3, "locale=en");
    await u.click(within(screen.getByTestId("faq-item-8")).getByRole("button", { name: /Is food included\?/ }));
    const panel = await screen.findByTestId("faq-item-panel-8");
    await u.type(within(panel).getByLabelText(/^Question/), "Is food included?");
    expect(await within(panel).findByText("Required.")).toBeInTheDocument();
    await u.click(within(panel).getByRole("button", { name: "Save question" }));
    expect(toast.error).toHaveBeenCalledWith("Fix the problems shown in the form first.");
    await typeAnswer(panel, "Meals on the trail are.");
    await waitFor(() => expect(within(panel).queryByText("Required.")).not.toBeInTheDocument());
    await u.click(within(panel).getByRole("button", { name: "Save question" }));
    await waitFor(() => expect(root(3).lock_version).toBeGreaterThan(2));
    const draft = getMockDb().revisions["faq-groups/3"].find((r) => r.kind === "draft")!.snapshot as unknown as { items: Array<{ id: number; translations: Array<{ locale_code: string; question: string }> }> };
    expect(draft.items.find((i) => i.id === 8)!.translations.find((t) => t.locale_code === "en")!.question).toBe("Is food included?");
  });

  it("the switch hides a question at once (PATCH is_visible); the order is one PUT with every id", async () => {
    const u = user();
    const seen: Array<{ method: string; body: unknown; ifMatch: string | null }> = [];
    server.use(
      http.patch(`${API}/faq-groups/1/items/2`, async ({ request }) => { seen.push({ method: "PATCH", ifMatch: request.headers.get("If-Match"), body: await request.clone().json() }); return undefined; }),
      http.put(`${API}/faq-groups/1/items/order`, async ({ request }) => { seen.push({ method: "PUT", ifMatch: request.headers.get("If-Match"), body: await request.clone().json() }); return undefined; })
    );
    await open(1);
    await u.click(screen.getByRole("switch", { name: "Show question 2 on the website" }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({ method: "PATCH", ifMatch: '"1"', body: { is_visible: false } });
    await waitFor(() => expect(within(screen.getByTestId("faq-item-2")).getByText("Hidden")).toBeInTheDocument());
    await u.click(screen.getByRole("button", { name: "Move Question 1 down" }));
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]).toEqual({ method: "PUT", ifMatch: '"2"', body: { items: [{ id: 2 }, { id: 1 }, { id: 3 }, { id: 4 }] } });
    await waitFor(() => expect(screen.getAllByTestId(/^faq-item-\d+$/).map((el) => el.getAttribute("data-testid"))[0]).toBe("faq-item-2"));
  });

  it("Add question: the default language needs both texts; then POST with Idempotency-Key and the new question is open at the end", async () => {
    const u = user();
    const posts: Array<{ key: string | null; ifMatch: string | null; body: { translations: Record<string, { question: string }> } }> = [];
    server.use(http.post(`${API}/faq-groups/2/items`, async ({ request }) => { posts.push({ key: request.headers.get("Idempotency-Key"), ifMatch: request.headers.get("If-Match"), body: (await request.clone().json()) as { translations: Record<string, { question: string }> } }); return undefined; }));
    await open(2);
    await u.click(screen.getByRole("button", { name: "Add question" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a question" });
    await u.click(within(dialog).getByRole("button", { name: "Add question" }));
    expect((await within(dialog).findAllByText("Required.")).length).toBe(2);
    expect(posts).toHaveLength(0);
    await u.type(within(dialog).getByLabelText(/^Question/), "Can I pay by card?");
    await typeAnswer(dialog, "Yes, at the office.");
    await u.click(within(dialog).getByRole("button", { name: "Add question" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].ifMatch).toBe('"1"');
    expect(posts[0].key).toBeTruthy();
    expect(posts[0].body.translations.la.question).toBe("Can I pay by card?");
    await waitFor(() => expect(screen.getByTestId("faq-items-count")).toHaveTextContent("3 of 100 questions"));
    expect(root(2).live.items).toHaveLength(3);
    expect(await screen.findByTestId("faq-item-panel-11")).toBeInTheDocument();
  });

  it("Delete question asks first and sends DELETE with the ETag", async () => {
    const u = user();
    const seen: Array<string | null> = [];
    server.use(http.delete(`${API}/faq-groups/2/items/5`, ({ request }) => { seen.push(request.headers.get("If-Match")); return undefined; }));
    await open(2);
    await u.click(screen.getByRole("button", { name: "Delete question 1" }));
    await u.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByTestId("faq-item-5")).not.toBeInTheDocument());
    expect(seen).toEqual(['"1"']);
  });

  it("Save draft in the bar saves the name and every edited question one after the other (each ETag from the answer before)", async () => {
    const u = user();
    const seen: Array<{ url: string; ifMatch: string | null }> = [];
    server.use(
      http.patch(`${API}/faq-groups/:id`, ({ request }) => { seen.push({ url: new URL(request.url).pathname, ifMatch: request.headers.get("If-Match") }); return undefined; }),
      http.patch(`${API}/faq-groups/:id/items/:itemId`, ({ request }) => { seen.push({ url: new URL(request.url).pathname, ifMatch: request.headers.get("If-Match") }); return undefined; })
    );
    await open(1);
    for (const id of [1, 2]) {
      await u.click(within(screen.getByTestId(`faq-item-${id}`)).getAllByRole("button", { name: /\?/ })[0]);
      const panel = await screen.findByTestId(`faq-item-panel-${id}`);
      await u.type(within(panel).getByLabelText(/^Question/), " (edited)");
    }
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen).toEqual([
      { url: "/api/v1/faq-groups/1/items/1", ifMatch: '"1"' },
      { url: "/api/v1/faq-groups/1/items/2", ifMatch: '"2"' },
    ]);
    await waitFor(() => expect(screen.queryByTestId("publish-dirty")).not.toBeInTheDocument());
  });

  it("a conflict (somebody else saved the group) opens the conflict dialog and the order is put back", async () => {
    const u = user();
    await open(1);
    touchFaqGroupAsSomeoneElse(getMockDb(), 1);
    await u.click(screen.getByRole("button", { name: "Move Question 1 down" }));
    expect(await screen.findByRole("dialog", { name: "Someone else changed this item" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId(/^faq-item-\d+$/).map((el) => el.getAttribute("data-testid"))[0]).toBe("faq-item-1"));
  });
});

describe("FaqEditor: publishing, settings, history", () => {
  useMockApi();

  it("publishing booking is blocked by the empty answer of a visible question: the dialog groups it under Question 2 and Go to field opens that question", async () => {
    const u = user();
    await open(2);
    await u.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = await screen.findByTestId("publish-blockers");
    expect(within(dialog).getByText("Question 2")).toBeInTheDocument();
    expect(within(dialog).getByText("Required in the default language (la).")).toBeInTheDocument();
    await u.click(within(dialog).getByRole("button", { name: /Go to/ }));
    expect(await screen.findByTestId("faq-item-panel-6")).toBeInTheDocument();
  });

  it("hiding the question with the empty answer lets the group publish (dry run, confirmation, live)", async () => {
    const u = user();
    await open(2);
    await u.click(screen.getByRole("switch", { name: "Show question 2 on the website" }));
    await waitFor(() => expect(within(screen.getByTestId("faq-item-6")).getByText("Hidden")).toBeInTheDocument());
    await u.click(screen.getByRole("button", { name: "Publish" }));
    const confirm = await screen.findByRole("dialog");
    await u.click(within(confirm).getByRole("button", { name: /^Publish/ }));
    await waitFor(() => expect(screen.getByTestId("status-badge")).toHaveTextContent("Published"));
    expect(root(2).status).toBe("published");
  });

  it("the Settings tab edits the internal name with Save draft (PATCH name only); the key is read only", async () => {
    const u = user();
    const seen: unknown[] = [];
    server.use(http.patch(`${API}/faq-groups/2`, async ({ request }) => { seen.push(await request.clone().json()); return undefined; }));
    await open(2, "tab=settings");
    expect(screen.getByTestId("faq-key")).toHaveTextContent("booking");
    const name = screen.getByLabelText("Name");
    await u.clear(name);
    await u.type(name, "Booking and payment");
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(seen).toEqual([{ name: "Booking and payment" }]));
    expect(root(2).live.group.name).toBe("Booking and payment");
  });

  it("unpublishing the contact group (a FAQ section names it) lists the page and repeats with confirm_references=true", async () => {
    const u = user();
    const urls: string[] = [];
    server.use(http.post(`${API}/faq-groups/1/unpublish`, ({ request }) => { urls.push(new URL(request.url).search); return undefined; }));
    await open(1);
    await u.click(screen.getByRole("button", { name: "Unpublish" }));
    await u.click(await screen.findByRole("button", { name: "Unpublish" }));
    const dialog = await screen.findByTestId("referenced-dialog");
    expect(within(dialog).getByText(/place uses this FAQ group|places use this FAQ group/)).toBeInTheDocument();
    await u.click(within(dialog).getByRole("button", { name: "Unpublish anyway" }));
    await waitFor(() => expect(urls).toEqual(["", "?confirm_references=true"]));
    await waitFor(() => expect(root(1).status).toBe("archived"));
  });

  it("the History tab lists the versions", async () => {
    await open(1, "tab=revisions");
    expect(await screen.findByTestId("revisions-tab")).toBeInTheDocument();
  });
});

describe("FaqEditor: translate mode and read only", () => {
  useMockApi();

  it("a translator edits the texts of every language; there is no add, delete, switch or drag; the name is read only", async () => {
    me.current = { ...me.current, permissions: TRANSLATOR };
    getMockDb().translateOnly = ["faq-groups"];
    const u = user();
    const patches: unknown[] = [];
    server.use(http.patch(`${API}/faq-groups/1/items/1`, async ({ request }) => { patches.push(await request.clone().json()); return undefined; }));
    await open(1);
    expect(screen.getByTestId("translate-mode-note")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add question" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete question/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move Question/ })).not.toBeInTheDocument();
    await u.click(within(screen.getByTestId("faq-item-1")).getByRole("button", { name: /How do I book a trip\?/ }));
    const panel = await screen.findByTestId("faq-item-panel-1");
    await u.type(within(panel).getByLabelText(/^Question/), "!");
    await u.click(within(panel).getByRole("button", { name: "Save question" }));
    await waitFor(() => expect(patches).toEqual([{ translations: { la: { question: "How do I book a trip?!" } } }]));
  });

  it("a reader sees everything and changes nothing", async () => {
    me.current = { ...me.current, permissions: grants({ "cms.faq": ["read"], "cms.locales": ["read"] }) };
    const u = user();
    await open(1);
    expect(screen.getByTestId("read-only-note")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
    await u.click(within(screen.getByTestId("faq-item-1")).getByRole("button", { name: /How do I book a trip\?/ }));
    const panel = await screen.findByTestId("faq-item-panel-1");
    expect(within(panel).getByLabelText(/^Question/)).toBeDisabled();
    expect(within(panel).queryByRole("button", { name: "Save question" })).not.toBeInTheDocument();
  });
});

describe("FaqHost", () => {
  useMockApi();
  it("a group that does not exist is a not-found state", async () => {
    renderApp(<FaqHost id={999} />);
    expect(await screen.findByText("FAQ group not found")).toBeInTheDocument();
  });
});
