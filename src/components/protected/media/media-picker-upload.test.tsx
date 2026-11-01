import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MediaPicker, type MediaPickerProps } from "@/components/protected/media/media-picker";
import { matchesAccept } from "@/lib/media-upload";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const me = vi.hoisted(() => ({ current: { id: 6, roleID: 2, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (name: string, extra: number) => new File([new Uint8Array([...PNG, extra])], name, { type: "image/png" });
const grant = (media: string[]) => grants({ "media.library": media, "cms.locales": ["read"] });

beforeEach(() => {
  window.localStorage.clear();
  me.current = { id: 6, roleID: 2, permissions: grant(["read", "create"]) };
});

async function openUpload(props: Partial<MediaPickerProps> = {}) {
  const user = userEvent.setup({ applyAccept: false });
  const onSelect = vi.fn();
  const onOpenChange = vi.fn();
  renderApp(<MediaPicker open onOpenChange={onOpenChange} onSelect={onSelect} {...props} />);
  const picker = await screen.findByRole("dialog", { name: /Choose/ });
  await within(picker).findByRole("button", { name: "blog-card-2.jpg" });
  await user.click(within(picker).getByRole("button", { name: "Upload new" }));
  const dialog = await screen.findByRole("dialog", { name: "Upload files" });
  return { user, picker, dialog, onSelect, onOpenChange, input: within(dialog).getByTestId("media-upload-input") as HTMLInputElement };
}

describe("MediaPicker: Upload new", () => {
  useMockApi();

  it("is hidden without media.library:create", async () => {
    me.current = { id: 6, roleID: 2, permissions: grant(["read"]) };
    renderApp(<MediaPicker open onOpenChange={vi.fn()} onSelect={vi.fn()} />);
    const picker = await screen.findByRole("dialog");
    await within(picker).findByRole("button", { name: "blog-card-2.jpg" });
    expect(within(picker).queryByRole("button", { name: "Upload new" })).not.toBeInTheDocument();
  });

  it("single mode: the uploaded file is selected and the picker closes", async () => {
    const { user, input, onSelect, onOpenChange } = await openUpload();
    await user.upload(input, png("fresh.png", 1));
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(onSelect.mock.calls[0][0]).toMatchObject([{ filename: "fresh.png", mime_type: "image/png" }]);
    expect(getMockDb().assets.some((a) => a.original_filename === "fresh.png")).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("multiple mode: the uploaded file joins the selection; 'Add selected' returns it with the others", async () => {
    const { user, picker, dialog, input, onSelect } = await openUpload({ mode: "multiple" });
    await user.upload(input, png("fresh-m.png", 2));
    await within(dialog).findByText("All 1 files are done.", undefined, { timeout: 4000 });
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await within(picker).findByText("1 selected");
    await user.click(within(picker).getByRole("button", { name: "blog-card-2.jpg" }));
    await user.click(within(picker).getByRole("button", { name: "Add selected" }));
    const rows = onSelect.mock.calls[0][0] as Array<{ id: number; filename: string }>;
    expect(rows.map((r) => r.filename)).toEqual(["fresh-m.png", "blog-card-2.jpg"]);
  });

  it("a duplicate: 'Use the existing file' selects the asset the server already has", async () => {
    const bytes = new Uint8Array([...PNG, 9]);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    getMockDb().assets.find((a) => a.id === 6)!.checksum_sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const before = getMockDb().assets.length;
    const { user, dialog, input, onSelect } = await openUpload();
    await user.upload(input, png("same-as-6.png", 9));
    await user.click(await within(dialog).findByRole("button", { name: "Use the existing file" }, { timeout: 4000 }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect.mock.calls[0][0]).toMatchObject([{ id: 6, filename: "blog-card-2.jpg" }]);
    expect(getMockDb().assets).toHaveLength(before);
  });

  it("with an image-only filter a PDF is rejected on the client and never sent", async () => {
    const before = getMockDb().assets.length;
    const { user, dialog, input, onSelect } = await openUpload({ accept: "image/*" });
    expect(input.accept).not.toContain("pdf");
    await user.upload(input, new File(["%PDF-1.4"], "doc.pdf", { type: "application/pdf" }));
    const row = await within(dialog).findByRole("listitem");
    expect(within(row).getByText("This kind of file is not accepted here.")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
    expect(getMockDb().assets).toHaveLength(before);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("matchesAccept", () => {
  it("handles wildcards, exact types, extensions and blank", () => {
    expect(matchesAccept({ name: "a.png", type: "image/png" }, "image/*")).toBe(true);
    expect(matchesAccept({ name: "a.pdf", type: "application/pdf" }, "image/*")).toBe(false);
    expect(matchesAccept({ name: "a.pdf", type: "" }, "application/pdf")).toBe(true);
    expect(matchesAccept({ name: "a.PNG", type: "" }, ".png,.jpg")).toBe(true);
    expect(matchesAccept({ name: "a.bin", type: "" }, undefined)).toBe(true);
  });
});
