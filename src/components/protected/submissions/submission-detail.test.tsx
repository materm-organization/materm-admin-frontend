import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SubmissionDetailView } from "@/components/protected/submissions/submission-detail";
import { getMockDb } from "@/mocks/mock-db";
import { setSubmissionsRights, submissionsState, touchSubmissionAsSomeoneElse } from "@/mocks/mock-submissions";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";
import { etagOf } from "@/mocks/mock-core";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, name: "Noy Keomany", roleID: 2, permissions: [] as PermissionGrant[] } }));
const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/forms/submissions/9",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const FULL = grants({ "forms.submissions": ["read", "update", "export"], "forms.manage": ["read"] });
const READER = grants({ "forms.submissions": ["read"] });
const user = () => userEvent.setup();
const row = (id: number) => submissionsState(getMockDb()).items.find((s) => s.id === id)!;
// The page is opened from a list link, so it carries the row's own `created_at`.
const open = async (id: number, extra = "") => {
  nav.search = `created_at=${encodeURIComponent(row(id).created_at)}${extra}`;
  const view = renderApp(<SubmissionDetailView id={id} />);
  await screen.findByTestId("submission-detail");
  return view;
};
const logs = ["log", "info", "warn", "error", "debug"] as const;

beforeEach(() => {
  me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: FULL };
  Object.values(toast).forEach((fn) => fn.mockReset());
});
afterEach(() => vi.restoreAllMocks());

describe("SubmissionDetailView (SCR-32): what is shown", () => {
  useMockApi();

  it("shows the fields of the schema in order with their labels, then the meta; the ?created_at= hint is sent", async () => {
    const seen: string[] = [];
    server.use(http.get(`${API}/submissions/:id`, ({ request }) => {
      seen.push(new URL(request.url).search);
      return undefined;
    }));
    await open(11);
    expect(new URLSearchParams(seen[0]).get("created_at")).toBe("2026-10-22T08:00:00.000111+07:00");
    expect(screen.getByRole("heading", { level: 1, name: "ສົມຊາຍ" })).toBeInTheDocument();
    const fields = screen.getByTestId("submission-fields");
    expect(within(fields).getAllByRole("term").map((t) => t.textContent)).toEqual(["Full name", "Email", "What is it about?", "Message", "legacy_field"]);
    expect(within(fields).getByText("kept from an older version of the form")).toBeInTheDocument();
    expect(screen.getByText("The grey names are fields the form does not have any more.")).toBeInTheDocument();
    // the IP fingerprint is the first 12 characters only
    expect(screen.getByText(/^a3f911c07be2\.\.\.$/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact form" })).toHaveAttribute("href", "/admin/forms/1");
  });

  it("a visitor's HTML is text: nothing in it becomes an element, a link or a script", async () => {
    await open(12);
    const fields = screen.getByTestId("submission-fields");
    expect(within(fields).getByText(/<img src=x onerror="alert\(1\)"> Hello <script>alert\("xss"\)<\/script>/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("<b>Bold</b> Visitor");
    expect(document.querySelector("[data-testid=submission-detail] img, [data-testid=submission-detail] script, [data-testid=submission-detail] b, [data-testid=submission-detail] a[href^='javascript']")).toBeNull();
    // the line break of the message is kept
    expect(within(fields).getByText(/Second line with a link/).className).toContain("whitespace-pre-wrap");
  });

  it("a consent is shown as Yes with the label of its field", async () => {
    await open(6);
    const fields = screen.getByTestId("submission-fields");
    expect(within(fields).getByText("Yes")).toBeInTheDocument();
    expect(within(fields).getByText("I agree to receive the newsletter")).toBeInTheDocument();
  });

  it("an anonymised message shows only the form, topic, status and dates, and offers no move, reply or note", async () => {
    await open(8);
    expect(screen.getByTestId("anonymised-note")).toHaveTextContent("Only the form, topic, status and dates remain.");
    expect(screen.queryByTestId("submission-fields")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark as|Archive|Reopen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Reply/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add a note")).not.toBeInTheDocument();
    expect(screen.queryByText("Browser")).not.toBeInTheDocument();
  });

  it("flags a message that is past its retention date", async () => {
    await open(7);
    expect(screen.getByText("Past its retention date")).toBeInTheDocument();
  });

  it("an unknown message is the not-found state; a 403 is no permission", async () => {
    nav.search = "";
    const { unmount } = renderApp(<SubmissionDetailView id={999} />);
    expect(await screen.findByText("Message not found")).toBeInTheDocument();
    unmount();
    server.use(http.get(`${API}/submissions/:id`, () => Response.json({ success: false, code: "FORBIDDEN", message: "x" }, { status: 403 })));
    renderApp(<SubmissionDetailView id={9} />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
  });

  it("is kept in the cache for a minute at most and never in storage or a log", async () => {
    const spies = logs.map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const { queryClient } = await open(9);
    expect(queryClient.getQueryCache().findAll({ queryKey: ["/submissions/9"] }).every((q) => q.options.gcTime === 60_000)).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    for (const spy of spies) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toMatch(/dara\.jr@example\.com|Looking for a weekend/);
  });
});

describe("SubmissionDetailView: status", () => {
  useMockApi();

  it("offers only the moves the status table allows from the current status", async () => {
    // spam -> Not spam only
    const { unmount: a } = await open(4);
    const buttons = () => within(screen.getByRole("group", { name: "Actions for this message" })).getAllByRole("button").map((b) => b.textContent);
    expect(buttons()).toEqual(["Not spam"]);
    a();
    // replied -> Archive only
    const { unmount: b } = await open(2);
    expect(buttons()).toEqual(["Archive"]);
    b();
    // archived -> Reopen only
    const { unmount: c } = await open(1);
    expect(buttons()).toEqual(["Reopen"]);
    c();
    // read -> replied, archive, spam
    await open(5);
    expect(buttons()).toEqual(["Mark as replied", "Archive", "Mark as spam"]);
  });

  it("a person without the update right sees no move and no note form, and the message stays new", async () => {
    me.current = { ...me.current, permissions: READER };
    setSubmissionsRights(getMockDb(), { update: false });
    let patches = 0;
    server.use(http.patch(`${API}/submissions/:id`, () => {
      patches += 1;
      return undefined;
    }));
    await open(9);
    expect(screen.queryByRole("button", { name: /Mark as|Archive/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add a note")).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 1300));
    expect(patches).toBe(0);
    expect(row(9).status).toBe("new");
  });

  it("a new message becomes read after one second open - once, with no If-Match - and the screen follows the answer without a refetch", async () => {
    const seen: Array<{ ifMatch: string | null; body: unknown; search: string }> = [];
    let gets = 0;
    server.use(
      http.get(`${API}/submissions/9`, () => {
        gets += 1;
        return undefined;
      }),
      http.patch(`${API}/submissions/9`, async ({ request }) => {
        seen.push({ ifMatch: request.headers.get("If-Match"), body: await request.clone().json(), search: new URL(request.url).search });
        return undefined;
      })
    );
    await open(9);
    expect(screen.getByTestId("submission-status")).toHaveTextContent("New");
    await waitFor(() => expect(screen.getByTestId("submission-status")).toHaveTextContent("Read"), { timeout: 3000 });
    expect(seen).toHaveLength(1);
    expect(seen[0].ifMatch).toBeNull();
    expect(seen[0].body).toEqual({ status: "read" });
    expect(seen[0].search).toContain("created_at=");
    // the answer was a list item: the fields and notes are still on the screen
    expect(screen.getByTestId("submission-fields")).toHaveTextContent("minibus");
    expect(gets).toBe(1);
  });

  it("a 409 on that automatic move (somebody was faster) is silent", async () => {
    server.use(http.patch(`${API}/submissions/9`, () => Response.json({ success: false, code: "INVALID_STATE", message: "x", details: { reason: "invalid_transition" } }, { status: 409 })));
    await open(9);
    await new Promise((r) => setTimeout(r, 1500));
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByTestId("submission-status")).toHaveTextContent("New");
  });

  it("a click moves it with the ETag as If-Match; a stale ETag is explained and the page is reloaded", async () => {
    const u = user();
    const seen: Array<string | null> = [];
    server.use(http.patch(`${API}/submissions/5`, ({ request }) => {
      seen.push(request.headers.get("If-Match"));
      return undefined;
    }));
    await open(5);
    await u.click(screen.getByRole("button", { name: "Mark as replied" }));
    await waitFor(() => expect(screen.getByTestId("submission-status")).toHaveTextContent("Replied"));
    expect(seen[0]).toMatch(/^"2026-10-05T22:00:00\.000105Z"$/);
    expect(toast.success).toHaveBeenCalledWith("Marked as Replied.");
    expect(within(screen.getByRole("group", { name: "Actions for this message" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Archive"]);

    touchSubmissionAsSomeoneElse(getMockDb(), 5);
    await u.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Somebody else changed this message. It was reloaded."));
  });

  it("Reply opens the mail program with the address and subject encoded, then asks whether to mark it as replied", async () => {
    const u = user();
    document.addEventListener("click", (e) => e.preventDefault(), { capture: true, once: true });
    await open(5);
    const reply = screen.getByRole("link", { name: "Reply by e-mail" });
    expect(reply).toHaveAttribute("href", "mailto:anou@example.com?subject=Re%3A%20camping");
    await u.click(reply);
    const ask = await screen.findByTestId("ask-replied");
    await u.click(within(ask).getByRole("button", { name: "Mark as replied" }));
    await waitFor(() => expect(screen.getByTestId("submission-status")).toHaveTextContent("Replied"));
    expect(screen.queryByTestId("ask-replied")).not.toBeInTheDocument();
  });

  it("an address that could inject a header gets no Reply link", async () => {
    row(9).data.email = "a@b.example\r\nBcc: x@y.example";
    await open(9);
    expect(screen.queryByRole("link", { name: "Reply by e-mail" })).not.toBeInTheDocument();
  });
});

describe("SubmissionDetailView: notes", () => {
  useMockApi();

  it("adds a note (append-only): shown with its author, the counter counts characters, the ETag is not touched; an Idempotency-Key is sent", async () => {
    const u = user();
    const seen: Array<{ key: string | null; body: unknown; search: string }> = [];
    server.use(http.post(`${API}/submissions/9/notes`, async ({ request }) => {
      seen.push({ key: request.headers.get("Idempotency-Key"), body: await request.clone().json(), search: new URL(request.url).search });
      return undefined;
    }));
    const { queryClient } = await open(9);
    const before = queryClient.getQueryData<{ etag: string }>(["/submissions/9", row(9).created_at])?.etag;
    expect(screen.getByText("No notes yet.")).toBeInTheDocument();
    await u.type(screen.getByLabelText("Add a note"), "Called back.");
    expect(screen.getByText("12 / 2000")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Add note" }));
    const notes = await screen.findByTestId("submission-notes");
    expect(notes).toHaveTextContent("Called back.");
    expect(notes).toHaveTextContent("Noy Keomany");
    expect(seen[0].body).toEqual({ note: "Called back." });
    expect(seen[0].key).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[0].search).toContain("created_at=");
    expect(screen.getByLabelText("Add a note")).toHaveValue("");
    // the automatic "read" move may have moved the ETag; a note itself never does
    const after = queryClient.getQueryData<{ etag: string }>(["/submissions/9", row(9).created_at])?.etag;
    expect(after === before || after === etagOf(row(9).updated_at)).toBe(true);
  });

  it("an empty note and one over 2000 characters are refused before a request; the note's text is shown as text", async () => {
    const u = user();
    let posts = 0;
    server.use(http.post(`${API}/submissions/9/notes`, () => {
      posts += 1;
      return undefined;
    }));
    await open(9);
    await u.click(screen.getByRole("button", { name: "Add note" }));
    expect(screen.getByText("Write the note first.")).toBeInTheDocument();
    const box = screen.getByLabelText("Add a note");
    await u.click(box);
    await u.paste("x".repeat(2001));
    await u.click(screen.getByRole("button", { name: "Add note" }));
    expect(screen.getByText("A note can have at most 2000 characters.")).toBeInTheDocument();
    expect(posts).toBe(0);
    await u.clear(box);
    await u.type(box, "<b>x</b>");
    await u.click(screen.getByRole("button", { name: "Add note" }));
    const notes = await screen.findByTestId("submission-notes");
    expect(within(notes).getByText("<b>x</b>")).toBeInTheDocument();
    expect(notes.querySelector("b")).toBeNull();
  });

  it("a note that fails is retried with the SAME Idempotency-Key", async () => {
    const u = user();
    const keys: Array<string | null> = [];
    let first = true;
    server.use(http.post(`${API}/submissions/9/notes`, ({ request }) => {
      keys.push(request.headers.get("Idempotency-Key"));
      if (first) {
        first = false;
        return Response.json({ success: false, code: "INTERNAL_ERROR", message: "x" }, { status: 500 });
      }
      return undefined;
    }));
    await open(9);
    await u.type(screen.getByLabelText("Add a note"), "Once.");
    await u.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(keys).toHaveLength(1));
    await u.click(screen.getByRole("button", { name: "Add note" }));
    await screen.findByTestId("submission-notes");
    expect(keys[1]).toBe(keys[0]);
    expect(row(9).notes).toHaveLength(1);
  });
});
