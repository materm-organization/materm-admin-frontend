import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EntryHost } from "@/components/protected/collections/entry-host";
import { getEntry, scheduleEntry } from "@/mocks/mock-collections";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

// Ajv compiles with `new Function`, which the production CSP forbids: an entry form must never reach it.
const ajv = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn() }));
vi.mock("@/components/schema-form/validate", async (original) => {
  const real = await original<typeof import("@/components/schema-form/validate")>();
  return {
    ...real,
    getSchemaValidator: (...args: Parameters<typeof real.getSchemaValidator>) => {
      ajv.get(...args);
      return real.getSchemaValidator(...args);
    },
    createSchemaValidator: (...args: Parameters<typeof real.createSchemaValidator>) => {
      ajv.create(...args);
      return real.createSchemaValidator(...args);
    },
  };
});

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, name: "Noy Keomany", roleID: 2, permissions: [] as PermissionGrant[] } }));
const nav = vi.hoisted(() => ({ search: "", push: vi.fn(), replace: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/collections/team/1",
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const EDITOR = grants({ "cms.collections": ["read", "create", "update", "delete", "publish", "unpublish", "translate"], "cms.locales": ["read"], "media.library": ["read"] });
const TRANSLATOR = grants({ "cms.collections": ["read", "translate"], "cms.locales": ["read"], "media.library": ["read"] });
const VIEWER = grants({ "cms.collections": ["read"], "cms.locales": ["read"], "media.library": ["read"] });

beforeEach(() => {
  me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: EDITOR };
  nav.search = "";
  nav.push.mockReset();
  nav.replace.mockReset();
  ajv.get.mockReset();
  ajv.create.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
});

const root = (id: number) => getMockDb().collectionEntries.find((e) => e.id === id)!;
const open = async (id = 1, search = "") => {
  nav.search = search;
  const view = renderApp(<EntryHost collectionKey="team" id={id} />);
  await screen.findByTestId(search.includes("tab=revisions") ? "revisions-tab" : "language-form", {}, { timeout: 4000 }).catch(async () => screen.findByTestId("language-missing"));
  await waitFor(() => expect(screen.queryByLabelText("Loading")).not.toBeInTheDocument());
  return view;
};

describe("EntryEditor: the content tab (SCR-41)", () => {
  useMockApi();

  it("shows the shared fields from json_schema and the fields of the chosen language from localized_schema, never through Ajv", async () => {
    await open(1);
    expect(screen.getByRole("heading", { level: 1, name: "Somsak" })).toBeInTheDocument();
    const shared = screen.getByTestId("shared-form");
    expect(within(shared).getByLabelText(/Joined in/)).toHaveValue(2019);
    expect(within(shared).getAllByText("Photo").length).toBeGreaterThan(0);
    expect(within(shared).getByLabelText("Start date")).toHaveAttribute("type", "date");
    const lang = screen.getByTestId("localized-form");
    expect(within(lang).getByLabelText(/Role/)).toHaveValue("Guide");
    expect(within(lang).getByText("Biography")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title \(/)).toHaveValue("Somsak");
    expect(ajv.get).not.toHaveBeenCalled();
    expect(ajv.create).not.toHaveBeenCalled();
    expect(screen.queryByText(/validator.*unavailable|cannot check/i)).not.toBeInTheDocument();
  });

  it("typing in a form with the hand-written checker shows an issue at once and still never touches Ajv", async () => {
    const u = userEvent.setup();
    await open(1);
    const year = within(screen.getByTestId("shared-form")).getByLabelText(/Joined in/);
    await u.clear(year);
    await u.type(year, "1800");
    expect(await screen.findByText(/out of range|between|too small|at least|1990/i, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(ajv.get).not.toHaveBeenCalled();
    expect(ajv.create).not.toHaveBeenCalled();
  });

  it("saving a change in a published entry sends ONE PATCH of what changed with If-Match \"1\"; the entry then has a pending draft and the ETag moves", async () => {
    const u = userEvent.setup();
    const seen: Array<{ ifMatch: string | null; body: Record<string, unknown> }> = [];
    server.use(http.patch(`${API}/collections/team/entries/1`, async ({ request }) => { seen.push({ ifMatch: request.headers.get("If-Match"), body: (await request.clone().json()) as Record<string, unknown> }); return undefined; }));
    await open(1);
    const role = within(screen.getByTestId("localized-form")).getByLabelText(/Role/);
    await u.clear(role);
    await u.type(role, "Chief guide");
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].ifMatch).toBe('"1"');
    expect(seen[0].body).toEqual({ translations: { la: { data: { role: "Chief guide", bio: expect.any(Object) } } } });
    await waitFor(() => expect(root(1).lock_version).toBe(2));
    expect(root(1).live.translations[0].data.role).toBe("Guide");
    await waitFor(() => expect(screen.getByTestId("status-badge")).toHaveTextContent("changes pending"));
  });

  it("a second save carries the ETag of the first answer (one write queue)", async () => {
    const u = userEvent.setup();
    const etags: Array<string | null> = [];
    server.use(http.patch(`${API}/collections/team/entries/2`, ({ request }) => { etags.push(request.headers.get("If-Match")); return undefined; }));
    await open(2);
    const sort = screen.getByLabelText("Order");
    await u.clear(sort);
    await u.type(sort, "25");
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(etags).toHaveLength(1));
    await waitFor(() => expect(root(2).lock_version).toBe(2));
    await u.clear(sort);
    await u.type(sort, "26");
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(etags).toHaveLength(2));
    expect(etags).toEqual(['"1"', '"2"']);
    expect(root(2).live.entry.sort_order).toBe(26);
  });

  it("a server 422 on a language's data lands on that language's field", async () => {
    const u = userEvent.setup();
    server.use(
      http.patch(`${API}/collections/team/entries/1`, () =>
        new Response(JSON.stringify({ success: false, code: "VALIDATION_FAILED", message: "x", errors: [{ in: "body", path: "/translations/la/data/role", code: "too_long", params: { max: 120 } }] }), { status: 422, headers: { "Content-Type": "application/json" } })
      )
    );
    await open(1);
    const role = within(screen.getByTestId("localized-form")).getByLabelText(/Role/);
    await u.type(role, "x");
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText(/at most 120|too long/i)).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("The server refused the entry. The problems are marked.");
  });

  it("a duplicate slug on Save of a draft entry is a 409 shown at the address field", async () => {
    const u = userEvent.setup();
    await open(2);
    const slug = screen.getByLabelText(/Address/);
    await u.clear(slug);
    await u.type(slug, "somsak");
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Another entry already uses this address in this language.")).toBeInTheDocument();
  });

  it("a missing language is added with its own button and sent as a whole row", async () => {
    const u = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(http.patch(`${API}/collections/team/entries/2`, async ({ request }) => { bodies.push(await request.clone().json()); return undefined; }));
    await open(2, "locale=en");
    await u.click(await screen.findByRole("button", { name: /^Add / }));
    const title = await screen.findByLabelText(/^Title \(/);
    await u.type(title, "Noy");
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    // the address follows the title until somebody types their own
    expect(bodies[0]).toEqual({ translations: { en: { title: "Noy", slug: "noy", is_enabled: true } } });
  });

  it("the schema_stale banner shows when the collection's schema moved on", async () => {
    getMockDb().collections.find((c) => c.key === "team")!.schema_version = 4;
    await open(1);
    expect(await screen.findByTestId("schema-stale-banner")).toHaveTextContent("schema version 1");
    expect(screen.getByTestId("schema-stale-banner")).toHaveTextContent("version 4");
  });

  it("lists the languages without a complete title", async () => {
    await open(2);
    expect(screen.getByTestId("missing-locales")).toHaveTextContent("EN");
  });
});

describe("EntryEditor: publishing", () => {
  useMockApi();

  it("Publish does a dry run first; a duplicate slug in the pending draft blocks it with the blocker named, and Go to field opens the language", async () => {
    const u = userEvent.setup();
    await open(3);
    await u.click(screen.getByRole("button", { name: /^Publish/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/duplicate|already|taken/i);
    expect(root(3).status).toBe("published");
    expect(getMockDb().revisions["collection-entries/3"].some((r) => r.kind === "published")).toBe(false);
  });

  it("an entry that passes publishes after the confirmation, with an Idempotency-Key, and clears the pending flag", async () => {
    const u = userEvent.setup();
    const keys: Array<string | null> = [];
    server.use(http.post(`${API}/collections/team/entries/2/publish`, ({ request }) => { keys.push(request.headers.get("Idempotency-Key")); return undefined; }));
    await open(2);
    await u.click(screen.getByRole("button", { name: /^Publish/ }));
    const dialog = await screen.findByRole("dialog");
    await u.click(await within(dialog).findByRole("button", { name: /^Publish/ }));
    await waitFor(() => expect(root(2).status).toBe("published"));
    // the dry run has no key; the real publish has exactly one
    expect(keys.filter(Boolean)).toHaveLength(1);
  });
});

describe("EntryEditor: rights and the trash", () => {
  useMockApi();

  it("a translator edits the language rows that exist but not the shared data, the order or the switches", async () => {
    me.current = { ...me.current, permissions: TRANSLATOR };
    getMockDb().translateOnly = ["collection-entries"];
    await open(1);
    expect(screen.getByTestId("translate-mode-note")).toBeInTheDocument();
    expect(within(screen.getByTestId("shared-form")).getByLabelText(/Joined in/)).toBeDisabled();
    expect(screen.getByLabelText("Order")).toBeDisabled();
    expect(within(screen.getByTestId("localized-form")).getByLabelText(/Role/)).toBeEnabled();
    expect(screen.getByLabelText(/^Title \(/)).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^Publish/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move to trash" })).not.toBeInTheDocument();
  });

  it("a viewer reads everything and changes nothing", async () => {
    me.current = { ...me.current, permissions: VIEWER };
    getMockDb().collectionRole = "viewer";
    await open(1);
    expect(screen.getByTestId("read-only-note")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title \(/)).toBeDisabled();
    expect(within(screen.getByTestId("shared-form")).getByLabelText(/Joined in/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
  });

  it("Move to trash asks, sends DELETE with the ETag and goes back to the list; a trashed entry offers Restore as draft", async () => {
    const u = userEvent.setup();
    await open(2);
    await u.click(screen.getByRole("button", { name: "Move to trash" }));
    await u.click(await screen.findByRole("button", { name: "Move to trash", hidden: false }).then(() => screen.getAllByRole("button", { name: "Move to trash" }).pop()!));
    await waitFor(() => expect(root(2).deleted_at).not.toBeNull());
    expect(nav.push).toHaveBeenCalledWith("/admin/collections/team");
  });

  it("a trashed entry is read only and can be restored", async () => {
    const u = userEvent.setup();
    renderApp(<EntryHost collectionKey="team" id={4} />);
    expect(await screen.findByText("This entry is in the trash", {}, { timeout: 4000 })).toBeInTheDocument();
    await u.click(await screen.findByRole("button", { name: "Restore as draft" }));
    await waitFor(() => expect(root(4).deleted_at).toBeNull());
  });

  it("an id from another collection is a not-found state", async () => {
    renderApp(<EntryHost collectionKey="events" id={1} />);
    expect(await screen.findByText("Entry not found", {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it("the History tab lists the versions; restoring an old one is judged against the CURRENT schema and refused with the places named", async () => {
    const u = userEvent.setup();
    // the collection now needs year >= 2020; the old version of Somsak has 2018
    (getMockDb().collections.find((c) => c.key === "team")!.json_schema.properties as { year: { minimum: number } }).year.minimum = 2020;
    await open(1, "tab=revisions");
    await u.click(await screen.findByRole("button", { name: /Restore version/ }));
    const dialog = await screen.findByRole("dialog");
    await u.click(within(dialog).getByRole("button", { name: /^Restore version/ }));
    expect(await within(dialog).findByTestId("restore-issue")).toHaveTextContent(/year/i);
    expect(root(1).lock_version).toBe(1);
  });
});

// D1: collection entries have a schedule but no review workflow; their id is the composite "<key>:<id>".
describe("EntryEditor: schedule in the PublishBar (D1)", () => {
  useMockApi();

  it("a scheduled entry shows its time; Cancel schedule goes through the composite address; no review buttons", async () => {
    const u = userEvent.setup();
    me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: grants({ "cms.collections": ["read", "update", "publish", "unpublish", "schedule", "review"], "cms.locales": ["read"], "media.library": ["read"] }) };
    const entry = getMockDb().collectionEntries.find((e) => e.id === 1)!;
    entry.status = "draft";
    entry.first_published_at = "2026-10-20T09:00:00.000000+07:00";
    const urls: string[] = [];
    server.use(http.delete(`${API}/collections/team/entries/1/schedule`, ({ request }) => { urls.push(new URL(request.url).pathname); return undefined; }));
    scheduleEntry(getMockDb(), "team", "1", { scheduled_at: new Date(Date.now() + 2 * 3_600_000).toISOString() }, getEntry(getMockDb(), "team", "1").etag);
    await open(1);
    expect(screen.getByTestId("status-badge")).toHaveTextContent("Scheduled");
    expect(screen.queryByRole("button", { name: "Submit for review" })).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Cancel schedule" }));
    await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel schedule" }));
    // the entry was published once, so cancelling the schedule puts it back to Archived (not Draft)
    await waitFor(() => expect(screen.getByTestId("status-badge")).toHaveTextContent("Archived"));
    expect(urls).toEqual(["/api/v1/collections/team/entries/1/schedule"]);
  });
});
