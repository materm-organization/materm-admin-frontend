import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MediaAssetSheet } from "@/components/protected/media/media-asset-sheet";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";
import { etagOf } from "@/mocks/mock-core";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, roleID: 2, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/media",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const FULL = grants({ "media.library": ["read", "update", "delete", "translate"], "cms.locales": ["read"] });

beforeEach(() => {
  me.current = { id: 6, roleID: 2, permissions: FULL };
  toast.success.mockReset();
  toast.error.mockReset();
});

function renderSheet(assetId = 2) {
  const onClose = vi.fn();
  const utils = renderApp(<MediaAssetSheet assetId={assetId} onClose={onClose} />);
  return { onClose, ...utils };
}

const asset = (id: number) => getMockDb().assets.find((a) => a.id === id)!;

describe("MediaAssetSheet (SCR-36)", () => {
  useMockApi();

  it("shows the file, its per-language text, the folder and the facts", async () => {
    renderSheet(2);
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByRole("heading", { name: /our-path-photo-1.jpg/ })).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Alt text")).toHaveValue(asset(2).translations.la.alt);
    expect(within(sheet).getByText("image/jpeg")).toBeInTheDocument();
    expect(within(sheet).getByRole("tab", { name: "Used in (1)" })).toBeInTheDocument();
    // checksum is shortened, never the full 64 characters
    expect(within(sheet).getByText(/^5b8ac7af/)).toBeInTheDocument();
  });

  it("edits alt text in another language: only the changed field is sent, with If-Match, and the ETag moves on", async () => {
    const user = userEvent.setup();
    let seen: { body: unknown; ifMatch: string | null } | null = null;
    server.use(
      http.patch(`${API}/media/assets/2`, async ({ request }) => {
        seen = { body: await request.json(), ifMatch: request.headers.get("If-Match") };
        return HttpResponse.json({ success: true, data: { ...asset(2), folder: null, variants: [], warnings: [] } }, { headers: { ETag: '"after"' } });
      })
    );
    renderSheet(2);
    const sheet = await screen.findByRole("dialog");
    await user.click(await within(sheet).findByRole("radio", { name: /^English/ }));
    const alt = within(sheet).getByLabelText("Alt text");
    await user.clear(alt);
    await user.type(alt, "Climbers on ice");
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(seen).not.toBeNull());
    expect(seen).toEqual({ body: { translations: { en: { alt: "Climbers on ice" } } }, ifMatch: etagOf(asset(2).updated_at) });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("The file was saved."));
    // saved: nothing left to save
    await waitFor(() => expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled());
  });

  it("clearing a caption / credit sends null; the real model keeps the edit", async () => {
    const user = userEvent.setup();
    asset(2).translations.en = { alt: "x", caption: "Old caption", credit: "Old credit" };
    renderSheet(2);
    const sheet = await screen.findByRole("dialog");
    await user.click(await within(sheet).findByRole("radio", { name: /^English/ }));
    await user.clear(within(sheet).getByLabelText("Caption"));
    await user.clear(within(sheet).getByLabelText("Credit"));
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(asset(2).translations.en.caption).toBeNull());
    expect(asset(2).translations.en.credit).toBeNull();
    // and a history row (the state before the edit) was written
    expect(getMockDb().revisions["media/assets/2"].length).toBeGreaterThan(4);
  });

  it("the focal point: a click sets {x, y} rounded to 3 decimals, arrows move it, clear removes it", async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(
      http.patch(`${API}/media/assets/2`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { ...asset(2), folder: null, variants: [], warnings: [] } }, { headers: { ETag: '"after"' } });
      })
    );
    renderSheet(2);
    const sheet = await screen.findByRole("dialog");
    const frame = await within(sheet).findByTestId("focal-frame");
    frame.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 300, right: 300, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(frame, { clientX: 126.6, clientY: 63.3, pointerId: 1 });
    const handle = await within(sheet).findByRole("button", { name: /Focal point at 42.2% across, 21.1% down/ });
    handle.focus();
    await user.keyboard("{ArrowRight}");
    expect(await within(sheet).findByRole("button", { name: /43.2% across/ })).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(body).toEqual({ focal: { x: 0.432, y: 0.211 } }));
  });

  it("the three crop previews exist", async () => {
    renderSheet(2);
    const sheet = await screen.findByRole("dialog");
    await within(sheet).findByTestId("focal-frame");
    expect(within(sheet).getByTestId("crop-hero")).toBeInTheDocument();
    expect(within(sheet).getByTestId("crop-card")).toBeInTheDocument();
    expect(within(sheet).getByTestId("crop-square")).toBeInTheDocument();
  });

  it("decorative flag and folder move go in the PATCH", async () => {
    const user = userEvent.setup();
    renderSheet(2);
    const sheet = await screen.findByRole("dialog");
    await user.click(await within(sheet).findByRole("switch", { name: "Decorative image (alt text not required)" }));
    await user.click(within(sheet).getByRole("combobox", { name: "Folder" }));
    await user.click(await screen.findByRole("option", { name: "Blog" }));
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(asset(2).is_decorative).toBe(true));
    expect(asset(2).folder_id).toBe(3);
  });

  it("a conflict (someone saved first) opens the ConflictDialog: 'keep mine' lists my edits, 'load the latest' drops them", async () => {
    const user = userEvent.setup();
    renderSheet(2);
    const sheet = await screen.findByRole("dialog");
    const alt = await within(sheet).findByLabelText("Alt text");
    await user.clear(alt);
    await user.type(alt, "My text");
    // another editor saves in between
    asset(2).updated_at = "2026-10-27T05:00:00.000001Z";
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    const conflict = await screen.findByText("Someone else changed this item");
    expect(conflict).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep my changes to review" }));
    expect(await screen.findByText("My changes")).toBeInTheDocument();
    expect(screen.getByText("My text")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Load the latest version/ }));
    await waitFor(() => expect(within(sheet).getByLabelText("Alt text")).toHaveValue(asset(2).translations.la.alt));
  });

  it("a 422 on a field is shown under that field", async () => {
    const user = userEvent.setup();
    server.use(
      http.patch(`${API}/media/assets/2`, () =>
        HttpResponse.json({ success: false, code: "VALIDATION_FAILED", errors: [{ in: "body", path: "/translations/la/alt", code: "too_long", params: { max: 250 } }] }, { status: 422 })
      )
    );
    renderSheet(2);
    const sheet = await screen.findByRole("dialog");
    await user.type(await within(sheet).findByLabelText("Alt text"), "!");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(/250/);
  });

  it("a user with only 'translate' edits the text but not the folder, the decorative flag or the focal point", async () => {
    me.current = { ...me.current, permissions: grants({ "media.library": ["read", "translate"], "cms.locales": ["read"] }) };
    renderSheet(2);
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByLabelText("Alt text")).toBeEnabled();
    expect(within(sheet).getByRole("switch", { name: "Decorative image (alt text not required)" })).toBeDisabled();
    expect(within(sheet).getByRole("combobox", { name: "Folder" })).toBeDisabled();
    expect(within(sheet).getByLabelText("Across (%)")).toBeDisabled();
    expect(within(sheet).getByText(/edit the text in each language/)).toBeInTheDocument();
  });

  it("a read-only user can look but not change or delete", async () => {
    me.current = { ...me.current, permissions: grants({ "media.library": ["read"], "cms.locales": ["read"] }) };
    renderSheet(2);
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByLabelText("Alt text")).toBeDisabled();
    expect(within(sheet).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("a user who may not read cms.locales still edits the languages the file has text in", async () => {
    server.use(http.get(`${API}/locales`, () => HttpResponse.json({ success: false, code: "FORBIDDEN" }, { status: 403 })));
    renderSheet(2);
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByLabelText("Alt text")).toBeEnabled();
    expect(within(sheet).getByRole("radio", { name: /^LA/ })).toBeInTheDocument();
  });

  it("deleting a file that is used is not offered; the usage list says where, with links to the editors", async () => {
    const user = userEvent.setup();
    renderSheet(15);
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByRole("button", { name: "Delete" })).toBeDisabled();
    await user.click(within(sheet).getByRole("button", { name: /Used in 3 places - see where/ }));
    const list = await within(sheet).findByRole("list", { name: "Where this file is used" });
    expect(within(list).getByRole("link", { name: /Blog/ })).toHaveAttribute("href", "/admin/pages/3");
    expect(within(list).getByRole("link", { name: "Music night under the stars" })).toHaveAttribute("href", "/admin/blog/posts/1");
    expect(within(list).getByText("draft only")).toBeInTheDocument();
  });

  it("MEDIA_IN_USE from the server (the page was stale) shows the usage list instead of failing silently", async () => {
    const user = userEvent.setup();
    // the UI believes it is unused (usage_count 0) but the server knows a page uses it
    asset(5).usage_count = 0;
    getMockDb().usages[5] = [{ entity_type: "cms.page", id: 3, title: "Blog", field: "/sections/0192d3a4-7c1e-7b52-9d0a-3f5e2a1b4c05/props/background/media_id", status: "published", in_draft_only: false }];
    renderSheet(5);
    const sheet = await screen.findByRole("dialog");
    await user.click(await within(sheet).findByRole("button", { name: "Delete" }));
    await user.click(await screen.findByRole("button", { name: "Move to trash" }));
    const dialog = await screen.findByRole("dialog", { name: "This file cannot be deleted" });
    expect(within(dialog).getByRole("link", { name: /Blog/ })).toHaveAttribute("href", "/admin/pages/3");
    expect(within(dialog).getByText(/used in 1 place/i)).toBeInTheDocument();
    expect(asset(5).deleted_at).toBeNull();
  });

  it("ENTITY_REFERENCED (only a draft uses it) is explained as such", async () => {
    const user = userEvent.setup();
    server.use(
      http.delete(`${API}/media/assets/5`, () =>
        HttpResponse.json(
          { success: false, code: "ENTITY_REFERENCED", details: { references: [{ entity_type: "cms.page", id: 6, title: "Spring campaign (draft)", field: "/sections/x/props/media_id" }], total_references: 1 } },
          { status: 409 }
        )
      )
    );
    renderSheet(5);
    const sheet = await screen.findByRole("dialog");
    await user.click(await within(sheet).findByRole("button", { name: "Delete" }));
    await user.click(await screen.findByRole("button", { name: "Move to trash" }));
    const dialog = await screen.findByRole("dialog", { name: "A draft still uses this file" });
    expect(within(dialog).getByText("Spring campaign (draft)")).toBeInTheDocument();
  });

  it("deleting an unused file: confirm, DELETE with If-Match, toast, the sheet closes", async () => {
    const user = userEvent.setup();
    let ifMatch: string | null = null;
    server.use(
      http.delete(`${API}/media/assets/5`, ({ request }) => {
        ifMatch = request.headers.get("If-Match");
        return HttpResponse.json({ success: true, data: null });
      })
    );
    const { onClose } = renderSheet(5);
    const sheet = await screen.findByRole("dialog");
    await user.click(await within(sheet).findByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Delete blog-card-1.jpg?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move to trash" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(ifMatch).toBe(etagOf(asset(5).updated_at));
    expect(toast.success).toHaveBeenCalledWith("The file was moved to the trash.");
  });

  it("a trashed file shows the purge date, is read-only and can be restored", async () => {
    const user = userEvent.setup();
    const a = asset(6);
    a.deleted_at = "2026-10-27T03:00:00.000000Z";
    a.purge_at = "2026-11-26T03:00:00.000Z";
    renderSheet(6);
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByText("This file is in the trash")).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Alt text")).toBeDisabled();
    expect(within(sheet).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Restore from trash" }));
    await waitFor(() => expect(asset(6).deleted_at).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("The file was restored.");
    await waitFor(() => expect(within(sheet).queryByText("This file is in the trash")).not.toBeInTheDocument());
  });

  it("the usage tab lists where the file is used", async () => {
    const user = userEvent.setup();
    renderSheet(18);
    const sheet = await screen.findByRole("dialog");
    await user.click(await within(sheet).findByRole("tab", { name: "Used in (1)" }));
    expect(await within(sheet).findByRole("link", { name: /Forest photo story/ })).toHaveAttribute("href", "/admin/galleries/1");
    expect(within(sheet).getByText("Album")).toBeInTheDocument();
  });

  it("a file nobody uses says so on the usage tab", async () => {
    const user = userEvent.setup();
    renderSheet(5);
    const sheet = await screen.findByRole("dialog");
    await user.click(await within(sheet).findByRole("tab", { name: "Used in (0)" }));
    expect(await within(sheet).findByText("This file is not used anywhere yet.")).toBeInTheDocument();
  });

  it("the history tab is the revisions tab of this asset; restoring there updates the sheet", async () => {
    const user = userEvent.setup();
    renderSheet(2);
    const sheet = await screen.findByRole("dialog");
    await user.click(await within(sheet).findByRole("tab", { name: "History" }));
    await user.click(await within(sheet).findByRole("button", { name: "Restore version 1" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore version 1?" });
    await user.click(within(dialog).getByRole("button", { name: "Restore version 1" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Version 1 was restored."));
    // v1 had no alt text at all
    expect(asset(2).translations.la?.alt ?? "").toBe("");
    await user.click(within(sheet).getByRole("tab", { name: "Details" }));
    await waitFor(() => expect(within(sheet).getByLabelText("Alt text")).toHaveValue(""));
  });

  it("warns (without blocking) when the default language ends up without alt text on a used file", async () => {
    const user = userEvent.setup();
    renderSheet(2);
    const sheet = await screen.findByRole("dialog");
    await user.clear(await within(sheet).findByLabelText("Alt text"));
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByText("The default language has no alt text")).toBeInTheDocument();
  });

  it("closing with unsaved edits asks first", async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet(2);
    const sheet = await screen.findByRole("dialog");
    await user.type(await within(sheet).findByLabelText("Alt text"), "x");
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Discard changes" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape, the X and the overlay also ask before dropping unsaved edits (they do not go through Cancel)", async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet(2);
    const sheet = await screen.findByRole("dialog");
    await user.type(await within(sheet).findByLabelText("Alt text"), "x");
    await user.keyboard("{Escape}");
    expect(await screen.findByText("Discard your changes?")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // "Cancel" keeps the edits (and the sheet) ...
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(within(sheet).getByLabelText("Alt text")).toHaveValue(asset(2).translations.la.alt + "x");
    // ... "Discard changes" lets go.
    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("button", { name: "Discard changes" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("with nothing edited Escape closes at once", async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet(2);
    await screen.findByRole("dialog");
    await within(screen.getByRole("dialog")).findByLabelText("Alt text");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("not found and no-permission reads", async () => {
    const first = renderSheet(999);
    expect(await screen.findByText("This file does not exist")).toBeInTheDocument();
    first.unmount();
    server.use(http.get(`${API}/media/assets/2`, () => HttpResponse.json({ success: false, code: "FORBIDDEN" }, { status: 403 })));
    renderSheet(2);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
  });
});
