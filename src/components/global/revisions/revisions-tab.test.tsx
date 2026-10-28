import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { RevisionsTab, type RevisionsTabProps } from "@/components/global/revisions/revisions-tab";
import { useMockApi } from "@/mocks/test-setup";
import { getMockDb } from "@/mocks/mock-db";
import { server } from "@/test/msw-server";
import { renderApp } from "@/test/render-app";

const API = "*/api/v1";
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/media",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const assetEtag = () => `"${getMockDb().assets.find((a) => a.id === 2)!.updated_at}"`;

function renderTab(props: Partial<RevisionsTabProps> = {}) {
  const onRestored = vi.fn();
  const utils = renderApp(
    <RevisionsTab resource="media/assets" id={2} canRestore etag={assetEtag()} onRestored={onRestored} {...props} />
  );
  return { onRestored, ...utils };
}

describe("RevisionsTab (SCR-37)", () => {
  useMockApi();

  it("lists the versions newest first with kind, who replaced the state, when and the note", async () => {
    renderTab();
    const rows = await screen.findAllByRole("row");
    // header + 4 versions
    expect(rows).toHaveLength(5);
    expect(within(rows[1]).getByText("v4")).toBeInTheDocument();
    expect(within(rows[2]).getByText("v3")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Before restore")).toBeInTheDocument();
    expect(within(rows[2]).getByText("restore of v1")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Noy Keomany")).toBeInTheDocument();
    expect(within(rows[4]).getByText("Somchai Vongsa")).toBeInTheDocument();
    expect(within(rows[1]).getByText("System")).toBeInTheDocument();
    expect(screen.getByText("4 versions")).toBeInTheDocument();
  });

  it("hides preview rows by default and asks for them with include_preview when the switch is on", async () => {
    const user = userEvent.setup();
    const seen: Array<string | null> = [];
    server.use(
      http.get(`${API}/media/assets/2/revisions`, ({ request }) => {
        seen.push(new URL(request.url).searchParams.get("include_preview"));
        const base = getMockDb().revisions["media/assets/2"];
        const summary = base.map((revision, i) => {
          const { entity, snapshot, ...r } = revision;
          void entity;
          void snapshot;
          return { ...r, is_preview: i === 0, change_note: i === 0 ? "preview" : r.change_note };
        });
        return HttpResponse.json({ success: true, data: summary.reverse(), meta: { total: summary.length, page: 1, limit: 20, total_page: 1 } });
      })
    );
    renderTab();
    await screen.findByText("v4");
    // the backend ignores include_preview for save-live; the preview row (v1) is filtered here as well
    expect(screen.queryByText("v1")).not.toBeInTheDocument();
    expect(seen[0]).toBeNull();
    await user.click(screen.getByRole("switch", { name: "Show preview rows" }));
    expect(await screen.findByText("v1")).toBeInTheDocument();
    expect(seen.at(-1)).toBe("true");
  });

  it("opens a version: the snapshot as fields, and a word-level comparison with the previous version", async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole("button", { name: "View version 2" }));
    const dialog = await screen.findByRole("dialog", { name: /Version 2/ });
    // default compare (no current state given) = the previous version v1 -> v2: the English alt was added
    await user.click(within(dialog).getByRole("tab", { name: "Changes" }));
    expect(await within(dialog).findByText("Changes from version 1 to version 2")).toBeInTheDocument();
    const english = within(dialog).getByRole("region", { name: "English (en)" });
    expect(within(english).getByText("Alt text")).toBeInTheDocument();
    expect(within(english).getByText("Two climbers on a glacier")).toBeInTheDocument();
    // fields tab shows labels, not JSON
    await user.click(within(dialog).getByRole("tab", { name: "Fields" }));
    expect(within(dialog).getAllByText("Alt text").length).toBeGreaterThan(0);
    expect(within(dialog).queryByText(/"locale_code"/)).not.toBeInTheDocument();
  });

  it("compares with the current state when the editor passes it (what a restore would change)", async () => {
    const user = userEvent.setup();
    const current = {
      asset: { folder_id: 2, is_decorative: true, focal_x: null, focal_y: null },
      translations: [{ locale_code: "la", alt: "ແກ້ໄຂໃໝ່", caption: null, credit: null }],
    };
    renderTab({ currentSnapshot: current });
    await user.click(await screen.findByRole("button", { name: "View version 2" }));
    const dialog = await screen.findByRole("dialog", { name: /Version 2/ });
    await user.click(within(dialog).getByRole("tab", { name: "Changes" }));
    expect(await within(dialog).findByText(/What restoring version 2 would change/)).toBeInTheDocument();
    expect(within(dialog).getByText("Image › Decorative image")).toBeInTheDocument();
    expect(within(dialog).getByText("Yes")).toBeInTheDocument();
  });

  it("restores after a confirmation: If-Match from the editor, a note, a toast, and the new entity handed to onRestored", async () => {
    const user = userEvent.setup();
    let seen: { ifMatch: string | null; body: unknown } | null = null;
    server.use(
      http.post(`${API}/media/assets/2/revisions/:revId/restore`, async ({ request }) => {
        seen = { ifMatch: request.headers.get("If-Match"), body: await request.json() };
        return HttpResponse.json(
          { success: true, data: { id: 2, restored_from: { revision_id: 9000, version: 1 } } },
          { headers: { ETag: '"new-etag"' } }
        );
      })
    );
    const { onRestored } = renderTab();
    await user.click(await screen.findByRole("button", { name: "Restore version 1" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore version 1?" });
    expect(within(dialog).getByText("This takes effect on the website immediately")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Note (optional)"), "undo the alt change");
    await user.click(within(dialog).getByRole("button", { name: "Restore version 1" }));
    await waitFor(() => expect(onRestored).toHaveBeenCalled());
    expect(seen).toEqual({ ifMatch: assetEtag(), body: { change_note: "undo the alt change" } });
    expect(onRestored.mock.calls[0][0]).toMatchObject({ etag: '"new-etag"', restoredFrom: { revision_id: 9000, version: 1 } });
    expect(toast.success).toHaveBeenCalledWith("Version 1 was restored.");
    await waitFor(() => expect(screen.queryByText("Restore version 1?")).not.toBeInTheDocument());
  });

  it("without an etag prop it reads the entity's current ETag first", async () => {
    const user = userEvent.setup();
    const { onRestored } = renderTab({ etag: undefined });
    await user.click(await screen.findByRole("button", { name: "Restore version 1" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore version 1?" });
    await user.click(within(dialog).getByRole("button", { name: "Restore version 1" }));
    await waitFor(() => expect(onRestored).toHaveBeenCalled());
    // restoring v1 (no alt text) changed the real model
    expect(getMockDb().assets.find((a) => a.id === 2)!.translations.la?.alt ?? "").toBe("");
  });

  it("a stale ETag opens the conflict dialog; 'load the latest version' refreshes the editor", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const { onRestored } = renderTab({ etag: '"stale"', onRefresh });
    await user.click(await screen.findByRole("button", { name: "Restore version 1" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore version 1?" });
    await user.click(within(dialog).getByRole("button", { name: "Restore version 1" }));
    expect(await screen.findByText("Someone else changed this item")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Load the latest version/ }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("a snapshot saved by a newer schema cannot be restored (snapshot_incompatible)", async () => {
    const user = userEvent.setup();
    renderTab();
    // v4 is the row with schema_version 99 in the fixture
    await user.click(await screen.findByRole("button", { name: "Restore version 4" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore version 4?" });
    await user.click(within(dialog).getByRole("button", { name: "Restore version 4" }));
    const issue = await within(dialog).findByTestId("restore-issue");
    expect(within(issue).getByText("This version cannot be restored")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Restore version 4" })).toBeDisabled();
  });

  it("a restore that refers to deleted data lists the paths readably and restores nothing", async () => {
    const user = userEvent.setup();
    const { onRestored } = renderTab();
    // remove the folder v3's snapshot points at (folder 1 "Home")
    getMockDb().folders = getMockDb().folders.filter((f) => f.id !== 1);
    // v3 (restore row) has folder_id null; use a revision whose snapshot has folder 1: v2 (asset folder at the time = 1)
    await user.click(await screen.findByRole("button", { name: "Restore version 2" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore version 2?" });
    await user.click(within(dialog).getByRole("button", { name: "Restore version 2" }));
    const issue = await within(dialog).findByTestId("restore-issue");
    expect(within(issue).getByText("Some of the data in this version no longer exists")).toBeInTheDocument();
    expect(within(issue).getByText(/Image › Folder/)).toBeInTheDocument();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("canRestore=false: versions can be viewed but not restored", async () => {
    renderTab({ canRestore: false });
    await screen.findByText("v4");
    expect(screen.queryByRole("button", { name: /Restore version/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /View version/ })).toHaveLength(4);
  });

  it("a 403 on the list is the no-permission state, not an error with retry", async () => {
    server.use(http.get(`${API}/media/assets/2/revisions`, () => HttpResponse.json({ success: false, code: "FORBIDDEN" }, { status: 403 })));
    renderTab();
    expect(await screen.findByText("No permission")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again|retry/i })).not.toBeInTheDocument();
  });

  it("an entity without history shows the empty state", async () => {
    getMockDb().revisions = {};
    renderTab({ id: 3 });
    expect(await screen.findByText("No earlier versions yet")).toBeInTheDocument();
  });
});
