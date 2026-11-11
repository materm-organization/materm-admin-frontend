import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MediaLibrary } from "@/components/protected/media/media-library";
import { MediaPicker } from "@/components/protected/media/media-picker";
import { addSeedVideo, getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { grants, renderApp } from "@/test/render-app";
import { mp4File } from "@/test/mp4-fixture";
import type { PermissionGrant } from "@/types/user";

const me = vi.hoisted(() => ({ current: { id: 6, roleID: 2, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    usePathname: () => "/admin/media",
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => React.useMemo(() => new URLSearchParams(nav.search), []),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  nav.search = "kind=video";
  window.localStorage.clear();
  me.current = { id: 6, roleID: 2, permissions: grants({ "media.library": ["read", "create", "update", "delete", "translate"], "cms.locales": ["read"] }) };
});

describe("library with a video", () => {
  useMockApi();

  it("kind filter 'Videos': the tile has the film placeholder, the duration, and no 'No alt text' badge", async () => {
    addSeedVideo(getMockDb());
    renderApp(<MediaLibrary />);
    const tile = (await screen.findByRole("button", { name: "Open forest-loop.mp4" })).closest("li")!;
    expect(tile.querySelector("video")).toBeNull();
    expect(tile.querySelector("[data-slot=video-duration-badge]")).toHaveTextContent("0:13");
    expect(within(tile).queryByText("No alt text")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open hero-bg.png" })).not.toBeInTheDocument();
  });

  it("the upload dialog accepts an MP4, pre-checks it in the browser, then uploads a good one", async () => {
    nav.search = "";
    const user = userEvent.setup({ applyAccept: false });
    renderApp(<MediaLibrary />);
    await screen.findByRole("button", { name: "Open hero-bg.png" });
    await user.click(screen.getByRole("button", { name: "Upload files" }));
    const dialog = await screen.findByRole("dialog", { name: "Upload files" });
    expect(dialog.textContent).toMatch(/MP4/);
    const input = within(dialog).getByTestId("media-upload-input") as HTMLInputElement;
    expect(input.accept).toContain("video/mp4");
    await user.upload(input, mp4File("fresh.mp4", { moovLast: true, seed: 21 }));
    // the browser pre-check refuses it before sending
    expect(await within(dialog).findByText(/-movflags \+faststart/)).toBeInTheDocument();
    expect(getMockDb().assets.some((a) => a.original_filename === "fresh.mp4")).toBe(false);
    await user.upload(input, mp4File("fresh2.mp4", { durationMs: 8000, seed: 22 }));
    await vi.waitFor(() => expect(getMockDb().assets.some((a) => a.original_filename === "fresh2.mp4" && a.kind === "video")).toBe(true));
  });
});

describe("MediaPicker video opt-in", () => {
  useMockApi();
  const open = (accept?: string) => renderApp(<MediaPicker open onOpenChange={vi.fn()} onSelect={vi.fn()} accept={accept} />);

  it("images by default: no Videos kind option, an MP4 is not accepted by the upload tab", async () => {
    addSeedVideo(getMockDb());
    const user = userEvent.setup();
    open("image/*");
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("button", { name: "hero-bg.png" });
    await user.click(within(dialog).getByRole("combobox", { name: "Type" }));
    expect(screen.queryByRole("option", { name: "Videos" })).not.toBeInTheDocument();
  });

  it("accept=video/mp4 offers the Videos kind", async () => {
    addSeedVideo(getMockDb());
    const user = userEvent.setup();
    open("video/mp4");
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("combobox", { name: "Type" }));
    expect(await screen.findByRole("option", { name: "Videos" })).toBeInTheDocument();
  });
});
