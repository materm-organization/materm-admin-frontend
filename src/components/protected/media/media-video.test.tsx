import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MediaAssetSheet } from "@/components/protected/media/media-asset-sheet";
import { MediaThumb } from "@/components/protected/media/media-thumb";
import { addSeedVideo, getMockDb, SEED_VIDEO_ID } from "@/mocks/mock-db";
import { setUploadSlotsBusy } from "@/mocks/mock-media-upload";
import { useMockApi } from "@/mocks/test-setup";
import { MediaAPI } from "@/services/media.api";
import { buildMp4, mp4File } from "@/test/mp4-fixture";
import { mapUploadError } from "@/lib/media-upload";
import { grants, renderApp } from "@/test/render-app";
import { renderWithIntl } from "@/test/render";
import { formatDuration, isMissingAlt } from "@/lib/media";
import type { PermissionGrant } from "@/types/user";

const me = vi.hoisted(() => ({ current: { id: 6, roleID: 2, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/media",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => {
  me.current = { id: 6, roleID: 2, permissions: grants({ "media.library": ["read", "create", "update", "delete", "translate"], "cms.locales": ["read"] }) };
  setUploadSlotsBusy(0);
});

describe("formatDuration / isMissingAlt", () => {
  it("m:ss from milliseconds", () => {
    expect(formatDuration(12_500)).toBe("0:13");
    expect(formatDuration(34_200)).toBe("0:34");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(null)).toBe("");
  });
  it("a video is never 'missing alt'", () => {
    expect(isMissingAlt({ kind: "video", is_decorative: false, translations: {} }, "la")).toBe(false);
    expect(isMissingAlt({ kind: "image", is_decorative: false, translations: {} }, "la")).toBe(true);
  });
});

describe("MediaThumb: video tile", () => {
  it("film icon, play badge and m:ss duration; the video is never loaded", () => {
    const { container } = renderWithIntl(<MediaThumb asset={{ url: "http://files/x.mp4", kind: "video", mime_type: "video/mp4", duration_ms: 34_200 }} alt="" />);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-slot=video-play-badge]")).not.toBeNull();
    expect(container.querySelector("[data-slot=video-duration-badge]")).toHaveTextContent("0:34");
  });
  it("no duration badge when the duration is unknown", () => {
    const { container } = renderWithIntl(<MediaThumb asset={{ url: "http://files/x.mp4", kind: "video" }} alt="" compact />);
    expect(container.querySelector("[data-slot=video-duration-badge]")).toBeNull();
    expect(container.querySelector("[data-slot=video-play-badge]")).not.toBeNull();
  });
});

describe("mock backend behaves like the real one for MP4", () => {
  useMockApi();
  const upload = (file: File, allow = false) => MediaAPI.UploadFile(file, { allowDuplicate: allow });
  const code = async (p: Promise<unknown>) => p.then(() => null, (e) => mapUploadError(e));

  it("accepts a valid MP4 (201 shape: kind video, duration_ms, size, ready)", async () => {
    const res = await upload(mp4File("ok.mp4", { durationMs: 12_000, width: 640, height: 360, seed: 1 }));
    expect(res.kind).toBe("created");
    if (res.kind === "created") expect(res.asset).toMatchObject({ kind: "video", mime_type: "video/mp4", status: "ready", duration_ms: 12_000, width: 640, height: 360 });
  });

  it("the 422 matrix with params", async () => {
    expect(await code(upload(mp4File("a.mp4", { moovLast: true, seed: 2 })))).toMatchObject({ kind: "faststartRequired" });
    expect(await code(upload(mp4File("a.mp4", { durationMs: 34_200 + 1000, seed: 3 })))).toMatchObject({ kind: "durationTooLong", params: { seconds: "35.2", max: 35 } });
    expect(await code(upload(mp4File("a.mp4", { width: 3840, height: 2160, seed: 4 })))).toMatchObject({ kind: "dimensionsTooLarge", params: { width: 3840, height: 2160 } });
    expect(await code(upload(mp4File("a.mp4", { codec: "hvc1", seed: 5 })))).toMatchObject({ kind: "codecUnsupported", params: { codec: "hvc1" } });
    expect(await code(upload(mp4File("a.mp4", { durationMs: 1000, mdatBytes: 6_000_000, seed: 6 })))).toMatchObject({ kind: "bitrateTooHigh" });
    expect(await code(upload(new File([buildMp4({ brand: "isom" }).slice(0, 300) as BlobPart], "cut.mp4", { type: "video/mp4" })))).toMatchObject({ kind: "damaged" });
  });

  it("415 for non-MP4 content named .mp4, with the allowed list; 413 max_video_bytes over 50 MiB", async () => {
    expect(await code(upload(new File(["MZ not a video"], "fake.mp4", { type: "video/mp4" })))).toMatchObject({ kind: "unsupported", params: { allowed: expect.stringContaining("video/mp4") } });
    const big = new File([new Uint8Array(50 * 1024 * 1024 + 1)], "big.mp4", { type: "video/mp4" });
    expect(await code(upload(big))).toMatchObject({ kind: "videoTooLarge" });
  }, 30_000);

  it("503 upload_slots_busy comes with Retry-After 3; a duplicate is 409 with kind video", async () => {
    const file = mp4File("busy.mp4", { seed: 7 });
    setUploadSlotsBusy(1);
    expect(await code(upload(file))).toMatchObject({ kind: "busy", retryAfter: 3 });
    expect((await upload(file)).kind).toBe("created");
    const dup = await upload(mp4File("again.mp4", { seed: 7 }));
    expect(dup.kind).toBe("duplicate");
    if (dup.kind === "duplicate") expect(dup.existing?.kind).toBe("video");
  });

  it("replace: a video replaces only a video (kind_mismatch both ways)", async () => {
    const video = addSeedVideo(getMockDb());
    const detail = (await MediaAPI.GetAsset(video.id)).data;
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])], "p.png", { type: "image/png" });
    expect(await code(MediaAPI.ReplaceFile(video.id, png, (await MediaAPI.GetAsset(video.id)).etag))).toMatchObject({ kind: "kindMismatch" });
    const replaced = await MediaAPI.ReplaceFile(video.id, mp4File("v2.mp4", { durationMs: 2500, seed: 9 }), (await MediaAPI.GetAsset(video.id)).etag);
    expect(replaced.data.data).toMatchObject({ id: SEED_VIDEO_ID, kind: "video", duration_ms: 2500 });
    expect(detail.data.kind).toBe("video");
    const imageEtag = (await MediaAPI.GetAsset(2)).etag;
    expect(await code(MediaAPI.ReplaceFile(2, mp4File("v.mp4", { seed: 10 }), imageEtag))).toMatchObject({ kind: "kindMismatch" });
  });
});

describe("MediaAssetSheet for a video", () => {
  useMockApi();

  it("plays the file with a native player and shows duration / size, without alt text fields or alt warnings", async () => {
    addSeedVideo(getMockDb());
    renderApp(<MediaAssetSheet assetId={SEED_VIDEO_ID} onClose={vi.fn()} />);
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByRole("heading", { name: /forest-loop.mp4/ })).toBeInTheDocument();
    const video = sheet.querySelector("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.hasAttribute("crossorigin")).toBe(false);
    expect(video.getAttribute("src")).toBe(getMockDb().assets.find((a) => a.id === SEED_VIDEO_ID)!.url);
    expect(within(sheet).getAllByText(/video\/mp4/).length).toBeGreaterThan(0);
    expect(within(sheet).getAllByText(/0:13/).length).toBeGreaterThan(0);
    expect(within(sheet).getByText("Duration")).toBeInTheDocument();
    expect(within(sheet).queryByLabelText("Alt text")).not.toBeInTheDocument();
    expect(within(sheet).queryByText(/Decorative image/)).not.toBeInTheDocument();
    expect(within(sheet).queryByText(/alt text/i, { selector: "[role=alert], h5, div[data-slot=alert-title]" })).not.toBeInTheDocument();
    // caption and credit stay editable
    expect(within(sheet).getByLabelText("Caption")).toBeEnabled();
    expect(within(sheet).getByRole("button", { name: "Replace file" })).toBeInTheDocument();
  });

  it("a player that cannot load the file falls back to the film placeholder", async () => {
    addSeedVideo(getMockDb());
    renderApp(<MediaAssetSheet assetId={SEED_VIDEO_ID} onClose={vi.fn()} />);
    const sheet = await screen.findByRole("dialog");
    await within(sheet).findByRole("heading", { name: /forest-loop.mp4/ });
    fireEvent.error(sheet.querySelector("video")!);
    await waitFor(() => expect(sheet.querySelector("video")).toBeNull());
    expect(sheet.querySelector("[data-slot=media-placeholder]")).not.toBeNull();
  });

  it("replace dialog of a video: only MP4 is offered, an image is refused with the kind_mismatch text, a bad MP4 stops before sending", async () => {
    addSeedVideo(getMockDb());
    const user = userEvent.setup({ applyAccept: false });
    renderApp(<MediaAssetSheet assetId={SEED_VIDEO_ID} onClose={vi.fn()} />);
    const sheet = await screen.findByRole("dialog");
    await user.click(await within(sheet).findByRole("button", { name: "Replace file" }));
    const dialog = (await screen.findAllByRole("dialog")).find((d) => within(d).queryByLabelText("New file"))!;
    const input = within(dialog).getByLabelText("New file") as HTMLInputElement;
    expect(input.accept).toBe("video/mp4");
    expect(within(dialog).getByText(/Only an MP4 video can replace a video/)).toBeInTheDocument();

    await user.upload(input, new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1])], "p.png", { type: "image/png" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("The new file must be the same kind as the current one");
    expect(within(dialog).getByRole("button", { name: "Replace" })).toBeDisabled();

    await user.upload(input, mp4File("late.mp4", { moovLast: true, seed: 11 }));
    expect(await within(dialog).findByText(/-movflags \+faststart/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Replace" })).toBeDisabled();

    await user.upload(input, mp4File("good.mp4", { durationMs: 4000, seed: 12 }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Replace" })).toBeEnabled());
    await user.click(within(dialog).getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("The file was replaced."));
    expect(getMockDb().assets.find((a) => a.id === SEED_VIDEO_ID)).toMatchObject({ original_filename: "good.mp4", duration_ms: 4000 });
  });

  it("an image row's replace dialog does not offer video", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderApp(<MediaAssetSheet assetId={2} onClose={vi.fn()} />);
    const sheet = await screen.findByRole("dialog");
    await user.click(await within(sheet).findByRole("button", { name: "Replace file" }));
    const dialog = (await screen.findAllByRole("dialog")).find((d) => within(d).queryByLabelText("New file"))!;
    expect((within(dialog).getByLabelText("New file") as HTMLInputElement).accept).not.toContain("video");
    await user.upload(within(dialog).getByLabelText("New file"), mp4File("v.mp4", { seed: 13 }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("must be the same kind");
  });
});
