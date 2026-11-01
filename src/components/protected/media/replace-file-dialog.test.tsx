import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MediaAssetSheet } from "@/components/protected/media/media-asset-sheet";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

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

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (name: string, extra = 0) => new File([new Uint8Array([...PNG, extra])], name, { type: "image/png" });

beforeEach(() => {
  me.current = { id: 6, roleID: 2, permissions: grants({ "media.library": ["read", "update", "translate"], "cms.locales": ["read"] }) };
  toast.success.mockReset();
  toast.error.mockReset();
});

async function openReplace() {
  const user = userEvent.setup({ applyAccept: false });
  renderApp(<MediaAssetSheet assetId={2} onClose={vi.fn()} />);
  const sheet = await screen.findByRole("dialog");
  await user.click(await within(sheet).findByRole("button", { name: "Replace file" }));
  const dialog = (await screen.findAllByRole("dialog")).find((d) => within(d).queryByLabelText("New file"))!;
  return { user, sheet, dialog };
}

describe("Replace file (FR-MEDIA-08)", () => {
  useMockApi();

  it("is hidden without media.library:update", async () => {
    me.current = { ...me.current, permissions: grants({ "media.library": ["read", "translate"], "cms.locales": ["read"] }) };
    renderApp(<MediaAssetSheet assetId={2} onClose={vi.fn()} />);
    const sheet = await screen.findByRole("dialog");
    await within(sheet).findByLabelText("Alt text");
    expect(within(sheet).queryByRole("button", { name: "Replace file" })).not.toBeInTheDocument();
  });

  it("sends the file with the asset's ETag as If-Match, keeps the id and the sheet shows the new file", async () => {
    const before = getMockDb().assets.find((a) => a.id === 2)!.updated_at;
    let seen: string | null = null;
    server.use(
      http.post(`${API}/media/assets/2/file`, ({ request }) => {
        seen = request.headers.get("If-Match");
        return undefined as never;
      })
    );
    const { user, dialog } = await openReplace();
    expect(within(dialog).getByRole("button", { name: "Replace" })).toBeDisabled();
    await user.upload(within(dialog).getByLabelText("New file"), png("replacement.png", 7));
    await user.click(within(dialog).getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("The file was replaced."));
    expect(seen).toBe(`"${before}"`);
    const row = getMockDb().assets.find((a) => a.id === 2)!;
    expect(row.original_filename).toBe("replacement.png");
    expect(row.updated_at).not.toBe(before);
    // the sheet reloaded the asset (same id, new name in the title)
    expect(await screen.findByRole("heading", { name: /replacement.png/ })).toBeInTheDocument();
  });

  it("a stale ETag (409 CONFLICT_LOCK_VERSION) opens the ConflictDialog", async () => {
    server.use(
      http.post(`${API}/media/assets/2/file`, () =>
        HttpResponse.json({ success: false, code: "CONFLICT_LOCK_VERSION", message: "changed" }, { status: 409 })
      )
    );
    const { user, dialog } = await openReplace();
    await user.upload(within(dialog).getByLabelText("New file"), png("late.png", 8));
    await user.click(within(dialog).getByRole("button", { name: "Replace" }));
    expect(await screen.findByText("Someone else changed this item")).toBeInTheDocument();
  });

  it("shows the server's refusal (415) and the client check (too large) inline", async () => {
    const { user, dialog } = await openReplace();
    await user.upload(within(dialog).getByLabelText("New file"), new File(["nope"], "x.png", { type: "image/png" }));
    await user.click(within(dialog).getByRole("button", { name: "Replace" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("This file type is not allowed.");

    const big = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 });
    await user.upload(within(dialog).getByLabelText("New file"), big);
    expect(within(dialog).getByRole("alert")).toHaveTextContent("The file is too large.");
    expect(within(dialog).getByRole("button", { name: "Replace" })).toBeDisabled();
  });

  it("cannot start while there are unsaved edits", async () => {
    const user = userEvent.setup();
    renderApp(<MediaAssetSheet assetId={2} onClose={vi.fn()} />);
    const sheet = await screen.findByRole("dialog");
    const alt = await within(sheet).findByLabelText("Alt text");
    await user.type(alt, " more");
    expect(within(sheet).getByRole("button", { name: "Replace file" })).toBeDisabled();
    expect(within(sheet).getByText(/Save your changes first/)).toBeInTheDocument();
  });
});
