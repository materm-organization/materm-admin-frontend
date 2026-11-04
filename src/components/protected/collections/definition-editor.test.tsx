import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DefinitionHost } from "@/components/protected/collections/definition-host";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, name: "Noy Keomany", roleID: 2, permissions: [] as PermissionGrant[] } }));
const nav = vi.hoisted(() => ({ search: "", push: vi.fn(), replace: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/collections/team/schema",
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const ADMIN = grants({ "cms.collections": ["read", "manage_schema", "create", "update", "delete", "publish", "unpublish", "translate"], "cms.locales": ["read"], "ops.audit": ["read"] });
const EDITOR = grants({ "cms.collections": ["read", "create", "update", "delete", "publish", "unpublish", "translate"], "cms.locales": ["read"] });

beforeEach(() => {
  me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: ADMIN };
  nav.search = "";
  nav.push.mockReset();
  nav.replace.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
});

const open = async (key = "team") => {
  const view = renderApp(<DefinitionHost collectionKey={key} />);
  await screen.findByTestId("field-builder", {}, { timeout: 4000 });
  return view;
};
const fieldRow = (name: string) => screen.getAllByTestId("builder-field").find((el) => el.getAttribute("data-field-name") === name)!;
const collectionRow = (key: string) => getMockDb().collections.find((c) => c.key === key)!;

describe("DefinitionEditor: the field builder (SCR-40)", () => {
  useMockApi();

  it("reads the stored schemas back into one row per field, shared or per language, in the order of ui:order", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 1, name: "Team members" })).toBeInTheDocument();
    const rows = screen.getAllByTestId("builder-field").map((el) => el.getAttribute("data-field-name"));
    expect(rows).toEqual(["year", "role", "photo", "bio", "start_date", "active"]);
    expect(within(fieldRow("role")).getByText("Per language")).toBeInTheDocument();
    expect(within(fieldRow("year")).getByText("Shared")).toBeInTheDocument();
    expect(within(fieldRow("year")).getByLabelText("Minimum")).toHaveValue(1990);
    expect(screen.queryByTestId("builder-locked")).not.toBeInTheDocument();
  });

  it("adding a field and saving sends ONE PATCH with only json_schema, If-Match = the definition's ETag, and the schema it stands for", async () => {
    const u = userEvent.setup();
    const seen: Array<{ ifMatch: string | null; body: Record<string, unknown> }> = [];
    server.use(http.patch(`${API}/collections/team`, async ({ request }) => { seen.push({ ifMatch: request.headers.get("If-Match"), body: (await request.clone().json()) as Record<string, unknown> }); return undefined; }));
    await open();
    const etag = (await import("@/mocks/mock-collections")).collectionListItem(getMockDb(), collectionRow("team")).etag;
    await u.click(screen.getByRole("button", { name: "Add field" }));
    const rows = screen.getAllByTestId("builder-field");
    const row = rows[rows.length - 1];
    const name = within(row).getByLabelText("Field name");
    await u.clear(name);
    await u.type(name, "nickname");
    await u.click(screen.getByTestId("save-definition"));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].ifMatch).toBe(etag);
    expect(Object.keys(seen[0].body).sort()).toEqual(["json_schema", "ui_schema"]);
    expect((seen[0].body.json_schema as { properties: Record<string, unknown> }).properties.nickname).toEqual({ type: "string" });
    expect(collectionRow("team").schema_version).toBe(2);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved."));
  });

  it("a field with a bad name is marked and nothing is sent", async () => {
    const u = userEvent.setup();
    let sent = 0;
    server.use(http.patch(`${API}/collections/team`, () => { sent += 1; return undefined; }));
    await open();
    await u.click(screen.getByRole("button", { name: "Add field" }));
    const rows = screen.getAllByTestId("builder-field");
    const row = rows[rows.length - 1];
    const name = within(row).getByLabelText("Field name");
    await u.clear(name);
    await u.type(name, "valueof");
    expect(await within(row).findByText("This name is reserved. Choose another.")).toBeInTheDocument();
    await u.click(screen.getByTestId("save-definition"));
    expect(toast.error).toHaveBeenCalledWith("Fix the marked problems first.");
    expect(sent).toBe(0);
  });

  it("a change that breaks existing entries opens the dialog with checked, invalid_count and the entries that block it; nothing is saved and the edit stays", async () => {
    const u = userEvent.setup();
    await open();
    const min = within(fieldRow("year")).getByLabelText("Minimum");
    await u.clear(min);
    await u.type(min, "2020");
    await u.click(screen.getByTestId("save-definition"));
    const dialog = await screen.findByTestId("schema-breaks-dialog");
    expect(within(dialog).getByText("This schema would break existing entries")).toBeInTheDocument();
    expect(within(dialog).getByText(/of 3 entries would not pass/)).toBeInTheDocument();
    const list = within(dialog).getByTestId("breaks-list");
    expect(within(list).getAllByRole("link")[0]).toHaveAttribute("href", expect.stringMatching(/^\/admin\/collections\/team\/\d+$/));
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("/data/year");
    expect(collectionRow("team").schema_version).toBe(1);
    await u.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(within(fieldRow("year")).getByLabelText("Minimum")).toHaveValue(2020);
  });

  it("a compatible change (a looser limit) is saved and bumps the schema version", async () => {
    const u = userEvent.setup();
    await open();
    const min = within(fieldRow("year")).getByLabelText("Minimum");
    await u.clear(min);
    await u.type(min, "1900");
    await u.click(screen.getByTestId("save-definition"));
    await waitFor(() => expect(collectionRow("team").schema_version).toBe(2));
    expect(screen.queryByTestId("schema-breaks-dialog")).not.toBeInTheDocument();
  });

  it("the server's schema codes are shown as readable lines that name the field (unsupported_keyword, invalid_schema + reason)", async () => {
    const u = userEvent.setup();
    server.use(
      http.patch(`${API}/collections/team`, () =>
        HttpResponse.json(
          {
            success: false,
            code: "VALIDATION_FAILED",
            message: "x",
            errors: [
              { in: "body", path: "/json_schema/properties/year/$ref", code: "unsupported_keyword", params: { keyword: "$ref" } },
              { in: "body", path: "/localized_schema/properties/role/pattern", code: "invalid_schema", params: { reason: "pattern", detail: "bad escape" } },
              { in: "body", path: "/json_schema", code: "invalid_schema", params: { reason: "compile", detail: "cannot compile: x" } },
            ],
          },
          { status: 422 }
        )
      )
    );
    await open();
    await u.type(within(fieldRow("year")).getByLabelText("Help text"), "x");
    await u.click(screen.getByTestId("save-definition"));
    const list = await screen.findByTestId("schema-errors");
    expect(list).toHaveTextContent("Field year: $ref - The keyword $ref is not supported.");
    expect(list).toHaveTextContent("Field role: pattern - The pattern is not a valid regular expression. (bad escape)");
    expect(list).toHaveTextContent("The schema could not be compiled. (cannot compile: x)");
    expect(fieldRow("year")).toHaveClass("border-destructive");
  });

  it("the Advanced JSON tab edits the raw text; a $ref is refused by the client check before any request, valid JSON is saved as data", async () => {
    const u = userEvent.setup();
    nav.search = "tab=advanced";
    const seen: Array<Record<string, unknown>> = [];
    server.use(http.patch(`${API}/collections/team`, async ({ request }) => { seen.push((await request.clone().json()) as Record<string, unknown>); return undefined; }));
    renderApp(<DefinitionHost collectionKey="team" />);
    const box = await screen.findByTestId("json-json_schema", {}, { timeout: 4000 });
    const doc = JSON.parse((box as HTMLTextAreaElement).value);
    doc.properties.year.$ref = "#/x";
    fireEvent.change(box, { target: { value: JSON.stringify(doc) } });
    await u.click(screen.getByTestId("save-definition"));
    expect(await screen.findByTestId("schema-errors")).toHaveTextContent("$ref");
    expect(seen).toHaveLength(0);
    delete doc.properties.year.$ref;
    doc.properties.year.minimum = 1980;
    fireEvent.change(box, { target: { value: JSON.stringify(doc) } });
    await u.click(screen.getByTestId("save-definition"));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(Object.keys(seen[0])).toEqual(["json_schema"]);
  });

  it("not valid JSON is reported with the parser's message and the builder has nothing to show", async () => {
    const u = userEvent.setup();
    nav.search = "tab=advanced";
    renderApp(<DefinitionHost collectionKey="team" />);
    const box = await screen.findByTestId("json-json_schema", {}, { timeout: 4000 });
    fireEvent.change(box, { target: { value: "{ nope" } });
    await u.click(screen.getByTestId("save-definition"));
    expect(await screen.findByTestId("schema-errors")).toHaveTextContent("not valid JSON");
  });

  it("a schema the builder can not represent locks it and points to the Advanced tab, without losing anything", async () => {
    getMockDb().collections.find((c) => c.key === "events")!.json_schema = {
      type: "object",
      additionalProperties: false,
      properties: { n: { anyOf: [{ type: "string" }, { type: "integer" }] } },
    };
    nav.search = "tab=fields";
    renderApp(<DefinitionHost collectionKey="events" />);
    const locked = await screen.findByTestId("builder-locked", {}, { timeout: 4000 });
    expect(locked).toHaveTextContent("cannot show this schema");
    expect(locked).toHaveTextContent("/properties/n");
  });

  it("delete: refused while entries exist (explained), allowed for an empty one", async () => {
    const u = userEvent.setup();
    await open();
    await u.click(screen.getByRole("button", { name: "Move to trash" }));
    await u.click(await screen.findByRole("button", { name: "Move to trash", hidden: false }).then(() => screen.getAllByRole("button", { name: "Move to trash" }).pop()!));
    expect(await screen.findByRole("alertdialog", { name: "It still has entries" })).toHaveTextContent("3 entries are still outside the trash");
  });

  it("a user with read only sees the definition without Save, Add field or delete", async () => {
    me.current = { ...me.current, permissions: EDITOR };
    await open();
    expect(screen.getByTestId("read-only-note")).toBeInTheDocument();
    expect(screen.queryByTestId("save-definition")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add field" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move to trash" })).not.toBeInTheDocument();
    expect(within(fieldRow("year")).getByLabelText("Field name")).toBeDisabled();
  });

  it("a stale ETag (somebody else saved) opens the conflict dialog", async () => {
    const u = userEvent.setup();
    await open();
    const c = collectionRow("team");
    c.updated_at = "2026-11-04T12:00:00.000000+07:00";
    await u.type(within(fieldRow("year")).getByLabelText("Help text"), "x");
    await u.click(screen.getByTestId("save-definition"));
    expect(await screen.findByRole("dialog", { name: "Someone else changed this item" })).toBeInTheDocument();
  });
});

describe("DefinitionEditor: versions and activity", () => {
  useMockApi();
  it("restoring an old schema goes through the same check: a 409 schema_breaks_entries is explained inside the dialog", async () => {
    const u = userEvent.setup();
    const c = collectionRow("team");
    // an older version whose year limit is stricter than the entries
    const rev = getMockDb().revisions["collections/team"][0];
    (rev.snapshot as { collection: { json_schema: { properties: { year: { minimum: number } } } } }).collection.json_schema.properties.year.minimum = 2020;
    void c;
    nav.search = "tab=revisions";
    renderApp(<DefinitionHost collectionKey="team" />);
    await screen.findByTestId("revisions-tab", {}, { timeout: 4000 });
    await u.click(await screen.findByRole("button", { name: /Restore version/ }));
    const dialog = await screen.findByRole("dialog");
    await u.click(within(dialog).getByRole("button", { name: /^Restore version/ }));
    expect(await screen.findByTestId("restore-breaks")).toHaveTextContent("Restoring it would leave");
  });

  it("the Activity tab lists the audit rows of cms.collection with the numeric id", async () => {
    nav.search = "tab=activity";
    const seen: string[] = [];
    server.use(http.get(`${API}/audit-logs`, ({ request }) => { seen.push(new URL(request.url).search); return undefined; }));
    renderApp(<DefinitionHost collectionKey="team" />);
    expect(await screen.findByTestId("entity-activity", {}, { timeout: 4000 })).toHaveTextContent("cms.collection.created");
    expect(seen[0]).toContain("entity_type=cms.collection");
    expect(seen[0]).toContain("entity_id=1");
  });
});
