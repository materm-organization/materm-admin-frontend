import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormHost } from "@/components/protected/forms/form-host";
import { getMockDb } from "@/mocks/mock-db";
import { changeRecipientsAsSomeoneElse, formsState, setFormsRole, touchFormAsSomeoneElse } from "@/mocks/mock-forms";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, name: "Noy Keomany", roleID: 2, permissions: [] as PermissionGrant[] } }));
const nav = vi.hoisted(() => ({ search: "", replace: vi.fn(), push: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/forms/1",
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const EDITOR = grants({ "forms.manage": ["read", "update", "translate", "publish", "unpublish"], "cms.locales": ["read"], "forms.submissions": ["read"] });
const TRANSLATOR = grants({ "forms.manage": ["read", "translate"], "cms.locales": ["read"] });
const READER = grants({ "forms.manage": ["read"], "cms.locales": ["read"] });

const root = (id: number) => formsState(getMockDb()).forms.find((f) => f.id === id)!;
const user = () => userEvent.setup();
const open = async (id = 1, search = "") => {
  nav.search = search;
  const view = renderApp(<FormHost id={id} />);
  // `router.replace` moves the (mocked) address bar and renders again, so a tab / language click works as in the browser.
  nav.replace.mockImplementation((url: string) => {
    nav.search = url.includes("?") ? url.split("?")[1] : "";
    view.rerender(<FormHost id={id} />);
  });
  await screen.findByTestId(search.includes("tab=recipients") ? "form-recipients" : search.includes("tab=fields") ? "form-fields" : search.includes("tab=settings") ? "form-settings" : search.includes("tab=history") ? "revisions-tab" : "form-texts");
  return view;
};

beforeEach(() => {
  me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: EDITOR };
  nav.search = "";
  nav.replace.mockReset();
  nav.push.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
});

describe("FormEditor: the Texts tab", () => {
  useMockApi();

  it("shows the form, its state, the texts of the default language, the unread messages link and the five tabs", async () => {
    await open(1);
    expect(screen.getByRole("heading", { level: 1, name: "Contact form" })).toBeInTheDocument();
    expect(screen.getByText("system form", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "5 new messages" })).toHaveAttribute("href", "/admin/forms/submissions?form_id=1");
    expect(screen.getAllByTestId("status-badge")[0]).toHaveTextContent("Published");
    expect(screen.getByLabelText(/^Title/)).toHaveValue("Send a message");
    expect(screen.getByLabelText(/^Send button/)).toHaveValue("Send message");
    for (const tab of ["Texts", "Fields", "Recipients", "Settings", "History"]) expect(screen.getByRole("tab", { name: tab })).toBeInTheDocument();
    // the error messages are rows of code + text
    expect(within(screen.getByTestId("form-messages")).getAllByRole("listitem")).toHaveLength(6);
  });

  it("Save draft sends ONLY what changed with If-Match, keeps the live copy (a published form gets a draft) and moves the ETag without a refetch", async () => {
    const u = user();
    const seen: Array<{ ifMatch: string | null; body: unknown }> = [];
    let gets = 0;
    server.use(
      http.get(`${API}/forms/1`, () => {
        gets += 1;
        return undefined;
      }),
      http.patch(`${API}/forms/1`, async ({ request }) => {
        seen.push({ ifMatch: request.headers.get("If-Match"), body: await request.clone().json() });
        return undefined;
      })
    );
    const { queryClient } = await open(1);
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    const title = screen.getByLabelText(/^Title/);
    await u.clear(title);
    await u.type(title, "Write to us");
    expect(await screen.findByTestId("publish-dirty")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(screen.queryByTestId("publish-dirty")).not.toBeInTheDocument());
    expect(seen).toEqual([{ ifMatch: '"1"', body: { translations: { la: { title: "Write to us" } } } }]);
    expect(queryClient.getQueryData<{ etag: string }>(["/forms/1"])?.etag).toBe('"2"');
    expect(gets).toBe(1);
    // the live copy is untouched, the working copy has the edit
    expect(root(1).live.translations.find((t) => t.locale_code === "la")!.title).toBe("Send a message");
    expect(screen.getAllByTestId("status-badge")[0]).toHaveTextContent("Published, changes pending");
  });

  it("a language without texts offers to add them; a new language needs a title and a send button before it can be saved", async () => {
    const u = user();
    await open(2, "locale=en");
    expect(screen.getByTestId("form-text-missing")).toHaveTextContent("There is no text in English yet.");
    await u.click(screen.getByRole("button", { name: "Add texts in English" }));
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    expect(toast.error).toHaveBeenCalledWith("Fix the marked fields first.");
    expect(screen.getAllByText("This is required.").length).toBeGreaterThanOrEqual(2);
    await u.type(screen.getByLabelText(/^Title/), "Stay in touch");
    await u.type(screen.getByLabelText(/^Send button/), "Join");
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(root(2).live.translations.map((t) => t.locale_code)).toEqual(["la", "en"]));
    expect(root(2).live.translations[1]).toMatchObject({ title: "Stay in touch", submit_label: "Join" });
  });

  it("a server refusal is put under the field and the tab/language of the first problem is opened", async () => {
    const u = user();
    server.use(
      http.patch(`${API}/forms/1`, () =>
        Response.json({ success: false, code: "VALIDATION_FAILED", message: "x", errors: [{ in: "body", path: "/translations/en/title", code: "too_long", params: { max: 120 } }] }, { status: 422 })
      )
    );
    await open(1, "locale=en");
    await u.type(screen.getByLabelText(/^Title/), "!");
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Too long (maximum 120).")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("The form was not saved. Check the marked fields.");
  });

  it("409 on save opens the conflict dialog; loading the latest starts the forms again from the server's version", async () => {
    const u = user();
    await open(1);
    touchFormAsSomeoneElse(getMockDb(), 1);
    await u.type(screen.getByLabelText(/^Title/), "!");
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await u.click(await screen.findByRole("button", { name: /Load the latest version/ }));
    await waitFor(() => expect(screen.getByLabelText(/^Title/)).toHaveValue("Send a message"));
  });
});

describe("FormEditor: publishing", () => {
  useMockApi();

  it("the dry run of a form without a catch-all recipient lists the blocker and Go to field opens the Recipients tab", async () => {
    const u = user();
    await open(1);
    await u.type(screen.getByLabelText(/^Title/), "!");
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(screen.queryByTestId("publish-dirty")).not.toBeInTheDocument());
    await u.click(screen.getByRole("button", { name: /^Publish/ }));
    const dialog = await screen.findByTestId("publish-blockers");
    expect(within(dialog).getByText("Form")).toBeInTheDocument();
    expect(within(dialog).getByText(/Add at least one active To recipient/)).toBeInTheDocument();
    await u.click(within(dialog).getByRole("button", { name: /Go to field: Recipients/ }));
    expect(nav.replace).toHaveBeenLastCalledWith(expect.stringContaining("tab=recipients"), { scroll: false });
  });

  it("unpublish of the contact form is held by the page that shows it until confirmed, then the form is archived", async () => {
    const u = user();
    await open(1);
    await u.click(screen.getByRole("button", { name: "Unpublish" }));
    await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Unpublish" }));
    const dialog = await screen.findByTestId("referenced-dialog");
    expect(dialog).toHaveTextContent("Contact");
    await u.click(within(dialog).getByRole("button", { name: /Unpublish/ }));
    await waitFor(() => expect(root(1).status).toBe("archived"));
    expect(await screen.findByTestId("notice-form_referenced")).toBeInTheDocument();
  });

  it("publishes a form that is ready (trek booking has its recipients): the pending draft becomes live", async () => {
    const u = user();
    await open(3);
    expect(screen.getAllByTestId("status-badge")[0]).toHaveTextContent("Published, changes pending");
    await u.click(screen.getByRole("button", { name: "Publish changes" }));
    await u.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Publish changes" }));
    await waitFor(() => expect(root(3).status).toBe("published"));
    await waitFor(() => expect(screen.getAllByTestId("status-badge")[0]).toHaveTextContent("Published"));
    expect(screen.getAllByTestId("status-badge")[0]).not.toHaveTextContent("pending");
  });
});

describe("FormEditor: the Recipients tab", () => {
  useMockApi();

  it("says so when a published form has nobody to tell, and blocks a set without a catch-all To for all topics", async () => {
    const u = user();
    await open(1, "tab=recipients");
    expect(screen.getByTestId("recipients-empty")).toHaveTextContent("published but has no recipients");
    expect(screen.getByText(/Recipients are saved on their own and apply at once/)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Add a recipient" }));
    await u.type(screen.getByLabelText("E-mail address of recipient 1"), "events@materm.example");
    await u.click(screen.getByRole("combobox", { name: "Topic of recipient 1" }));
    await u.click(await screen.findByRole("option", { name: "Music nights & events" }));
    expect(screen.getByTestId("recipients-catch-all")).toHaveTextContent("A published form needs at least one active To recipient for all topics.");
    await u.click(screen.getByRole("button", { name: "Save recipients" }));
    expect(toast.error).toHaveBeenCalledWith("Fix the marked rows first.");
    expect(root(1).recipients).toEqual([]);
  });

  it("saves the whole set with the recipients_etag as If-Match, does not touch the form's ETag, and the status stays as it was", async () => {
    const u = user();
    const seen: Array<{ ifMatch: string | null; body: unknown }> = [];
    server.use(http.put(`${API}/forms/1/recipients`, async ({ request }) => {
      seen.push({ ifMatch: request.headers.get("If-Match"), body: await request.clone().json() });
      return undefined;
    }));
    const { queryClient } = await open(1, "tab=recipients");
    const before = queryClient.getQueryData<{ etag: string; data: { data: { recipients_etag: string } } }>(["/forms/1"])!;
    await u.click(screen.getByRole("button", { name: "Add a recipient" }));
    await u.type(screen.getByLabelText("E-mail address of recipient 1"), " hello@materm.example ");
    await u.click(screen.getByRole("button", { name: "Save recipients" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("The recipients were saved. They apply now."));
    expect(seen).toEqual([{ ifMatch: before.data.data.recipients_etag, body: { recipients: [{ email: "hello@materm.example", kind: "to", topic_value: null, is_active: true }] } }]);
    const after = queryClient.getQueryData<{ etag: string; data: { data: { recipients_etag: string; recipient_count: number; lock_version: number } } }>(["/forms/1"])!;
    expect(after.etag).toBe(before.etag);
    expect(after.data.data.lock_version).toBe(1);
    expect(after.data.data.recipients_etag).not.toBe(before.data.data.recipients_etag);
    expect(after.data.data.recipient_count).toBe(1);
    // saved: the button is quiet again and the row is still there
    expect(screen.getByRole("button", { name: "Save recipients" })).toBeDisabled();
    expect(screen.getByLabelText("E-mail address of recipient 1")).toHaveValue("hello@materm.example");
  });

  it("topic-bound recipients: the topic labels are offered, the row keeps the topic value", async () => {
    const u = user();
    await open(3, "tab=recipients");
    expect(screen.getAllByTestId("recipient-row")).toHaveLength(4);
    expect(screen.getByLabelText("E-mail address of recipient 2")).toHaveValue("treks@materm.example");
    expect(screen.getByRole("combobox", { name: "Topic of recipient 2" })).toHaveTextContent("Day trek");
    await u.click(screen.getByRole("button", { name: "Remove recipient 4" }));
    await u.click(screen.getByRole("button", { name: "Save recipients" }));
    await waitFor(() => expect(root(3).recipients.map((r) => r.email)).toEqual(["bookings@materm.example", "treks@materm.example", "camp@materm.example"]));
  });

  it("a stale recipients_etag (somebody else changed the set) opens the conflict dialog and keeps my rows", async () => {
    const u = user();
    await open(3, "tab=recipients");
    changeRecipientsAsSomeoneElse(getMockDb(), 3, "new-colleague@materm.example");
    await u.click(screen.getByRole("button", { name: "Add a recipient" }));
    await u.type(screen.getByLabelText("E-mail address of recipient 5"), "mine@materm.example");
    await u.click(screen.getByRole("button", { name: "Save recipients" }));
    expect(await screen.findByRole("button", { name: /Load the latest version/ })).toBeInTheDocument();
    expect(screen.getByLabelText("E-mail address of recipient 5")).toHaveValue("mine@materm.example");
  });

  it("server refusals are shown at the row (duplicate) or for the whole set", async () => {
    const u = user();
    server.use(
      http.put(`${API}/forms/1/recipients`, () =>
        Response.json({ success: false, code: "VALIDATION_FAILED", message: "x", errors: [{ in: "body", path: "/recipients/0/email", code: "invalid_format" }, { in: "body", path: "/recipients", code: "recipients_required" }] }, { status: 422 })
      )
    );
    await open(1, "tab=recipients");
    await u.click(screen.getByRole("button", { name: "Add a recipient" }));
    await u.type(screen.getByLabelText("E-mail address of recipient 1"), "a@materm.example");
    await u.click(screen.getByRole("button", { name: "Save recipients" }));
    expect(await screen.findByText("The value has an invalid format.")).toBeInTheDocument();
    expect(screen.getByText("At least one active To recipient for all topics is needed.")).toBeInTheDocument();
  });
});

describe("FormEditor: the Fields and Settings tabs and the rights", () => {
  useMockApi();

  it("the fields are a read-only table; option labels are edited per language and sent as the whole map", async () => {
    const u = user();
    const seen: unknown[] = [];
    server.use(http.patch(`${API}/forms/1`, async ({ request }) => {
      seen.push(await request.clone().json());
      return undefined;
    }));
    await open(1, "tab=fields&locale=en");
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(within(table).getByText("topic")).toBeInTheDocument();
    expect(within(table).getByText("booking, events, camping, other")).toBeInTheDocument();
    expect(within(table).getAllByText("personal data").length).toBe(4);
    const events = screen.getByLabelText("Label of events in English");
    await u.clear(events);
    await u.type(events, "Events");
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({ field_translations: { topic: { en: { option_labels: { booking: "Booking & stays", events: "Events", camping: "Camping & treks", other: "Something else" } } } } });
  });

  it("Settings: numbers are checked before they are sent, then saved as integers", async () => {
    const u = user();
    const seen: unknown[] = [];
    server.use(http.patch(`${API}/forms/3`, async ({ request }) => {
      seen.push(await request.clone().json());
      return undefined;
    }));
    await open(3, "tab=settings");
    const days = screen.getByLabelText("Keep messages for (days)");
    await u.clear(days);
    await u.type(days, "10");
    expect(await screen.findByText("Outside the allowed range.")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    expect(seen).toEqual([]);
    await u.clear(days);
    await u.type(days, "90");
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(seen).toEqual([{ retention_days: 90 }]));
  });

  it("a translator changes the texts of every language (the default too) but the settings and recipients are read-only", async () => {
    const u = user();
    me.current = { ...me.current, permissions: TRANSLATOR };
    setFormsRole(getMockDb(), "translator");
    const seen: unknown[] = [];
    server.use(http.patch(`${API}/forms/1`, async ({ request }) => {
      seen.push(await request.clone().json());
      return undefined;
    }));
    await open(1);
    expect(screen.getByTestId("translate-mode-note")).toBeInTheDocument();
    const title = screen.getByLabelText(/^Title/);
    expect(title).toBeEnabled();
    await u.type(title, "!");
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(seen).toEqual([{ translations: { la: { title: "Send a message!" } } }]));
    await u.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByLabelText(/^Name/)).toBeDisabled();
    await u.click(screen.getByRole("tab", { name: "Recipients" }));
    expect(screen.queryByRole("button", { name: "Add a recipient" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Publish/ })).not.toBeInTheDocument();
  });

  it("a reader sees everything and can change nothing", async () => {
    me.current = { ...me.current, permissions: READER };
    setFormsRole(getMockDb(), "reader");
    await open(1);
    expect(screen.getByTestId("read-only-note")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
  });

  it("the History tab lists the revisions of the form", async () => {
    await open(3, "tab=history");
    expect(await screen.findByTestId("revisions-tab")).toBeInTheDocument();
    expect(await screen.findAllByText(/Draft|Published/)).not.toHaveLength(0);
  });

  it("an unknown form is the not-found state", async () => {
    nav.search = "";
    renderApp(<FormHost id={99} />);
    expect(await screen.findByText("Form not found")).toBeInTheDocument();
  });
});
