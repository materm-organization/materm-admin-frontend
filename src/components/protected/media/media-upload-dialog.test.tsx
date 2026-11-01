import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MediaLibrary } from "@/components/protected/media/media-library";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, roleID: 2, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
const nav = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    usePathname: () => "/admin/media",
    useRouter: () => ({ push: nav.push, replace: nav.push }),
    useSearchParams: () => React.useMemo(() => new URLSearchParams(nav.search), []),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const grant = (media: string[]) => grants({ "media.library": media, "cms.locales": ["read"] });
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (name: string, extra: number) => new File([new Uint8Array([...PNG, extra])], name, { type: "image/png" });

beforeEach(() => {
  nav.search = "";
  nav.push.mockReset();
  window.localStorage.clear();
  me.current = { id: 6, roleID: 2, permissions: grant(["read", "create", "update"]) };
});

async function openDialog() {
  const user = userEvent.setup({ applyAccept: false });
  renderApp(<MediaLibrary />);
  await screen.findByRole("button", { name: "Open hero-bg.png" });
  await user.click(screen.getByRole("button", { name: "Upload files" }));
  const dialog = await screen.findByRole("dialog", { name: "Upload files" });
  return { user, dialog, input: within(dialog).getByTestId("media-upload-input") as HTMLInputElement };
}

describe("Media upload dialog (FR-MEDIA-01/02/12)", () => {
  useMockApi();

  it("is offered only with media.library:create", async () => {
    me.current = { id: 6, roleID: 2, permissions: grant(["read", "update"]) };
    renderApp(<MediaLibrary />);
    await screen.findByRole("button", { name: "Open hero-bg.png" });
    expect(screen.queryByRole("button", { name: "Upload files" })).not.toBeInTheDocument();
  });

  it("SVG is accepted only with media.library:update (accept list and the file row)", async () => {
    me.current = { id: 6, roleID: 2, permissions: grant(["read", "create"]) };
    const { user, dialog, input } = await openDialog();
    expect(input.accept).not.toContain("svg");
    expect(within(dialog).queryByText(/SVG files can be up to 1 MB/)).not.toBeInTheDocument();
    await user.upload(input, new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }));
    const row = await within(dialog).findByRole("listitem");
    expect(within(row).getByText("You are not allowed to upload SVG files.")).toBeInTheDocument();
    // not retryable, nothing was sent
    expect(within(row).queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
    expect(getMockDb().assets).toHaveLength(24);
  });

  it("uploads several files, announces the result, and the library lists them after closing", async () => {
    const { user, dialog, input } = await openDialog();
    await user.upload(input, [png("fresh-a.png", 1), png("fresh-b.png", 2)]);
    expect(await within(dialog).findByText("All 2 files are done.")).toBeInTheDocument();
    expect(within(dialog).getByRole("status")).toHaveTextContent("All 2 files are done.");
    expect(within(dialog).getAllByText(/Done$/)).toHaveLength(2);
    expect(getMockDb().assets.map((a) => a.original_filename)).toEqual(expect.arrayContaining(["fresh-a.png", "fresh-b.png"]));
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("button", { name: "Open fresh-a.png" })).toBeInTheDocument();
    expect(screen.getByText("26 in total")).toBeInTheDocument();
  });

  it("sends the folder being browsed as folder_id", async () => {
    nav.search = "folder_id=2";
    let folder: string | null = null;
    server.use(
      http.post(`${API}/media/uploads`, async ({ request }) => {
        folder = new TextDecoder().decode(new Uint8Array(await request.arrayBuffer())).match(/name="folder_id"\r\n\r\n(\d+)/)?.[1] ?? null;
        return HttpResponse.json({ success: false, code: "INTERNAL_ERROR" }, { status: 500 });
      })
    );
    renderApp(<MediaLibrary />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Upload files" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Saved in: Our Path/)).toBeInTheDocument();
    await user.upload(within(dialog).getByTestId("media-upload-input"), png("x.png", 9));
    await waitFor(() => expect(folder).toBe("2"));
  });

  it("a rejected file (415) fails alone: the others still upload, and it has no Retry", async () => {
    const { user, dialog, input } = await openDialog();
    const fake = new File(["not an image"], "fake.png", { type: "image/png" });
    await user.upload(input, [fake, png("good.png", 3)]);
    expect(await within(dialog).findByText("1 of 2 done, 1 failed")).toBeInTheDocument();
    const rows = within(dialog).getAllByRole("listitem");
    expect(within(rows[0]).getByText("This file type is not allowed.")).toBeInTheDocument();
    expect(within(rows[0]).queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
    expect(rows[1]).toHaveAttribute("data-status", "done");
  });

  it("a failed file can be retried by hand and then succeeds", async () => {
    let calls = 0;
    server.use(
      http.post(`${API}/media/uploads`, () => {
        calls += 1;
        if (calls <= 1) return HttpResponse.json({ success: false, code: "INTERNAL_ERROR" }, { status: 500 });
        // fall through to the mock handler
        return undefined as never;
      })
    );
    const { user, dialog, input } = await openDialog();
    await user.upload(input, png("flaky.png", 4));
    const row = await within(dialog).findByRole("listitem");
    await waitFor(() => expect(row).toHaveAttribute("data-status", "failed"));
    expect(within(row).getByText("The upload failed.")).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Retry flaky.png" }));
    await waitFor(() => expect(row).toHaveAttribute("data-status", "done"));
  });

  it("a duplicate offers 'Use the existing file' (nothing uploaded) or 'Upload anyway'", async () => {
    const { user, dialog, input } = await openDialog();
    await user.upload(input, [png("orig.png", 5)]);
    await within(dialog).findByText("All 1 files are done.");
    await user.click(within(dialog).getByRole("button", { name: "Clear finished files" }));

    await user.upload(input, [png("same-bytes.png", 5), png("same-again.png", 5)]);
    const rows = await within(dialog).findAllByText(/is already in the library as orig.png/, undefined, { timeout: 3000 });
    expect(rows).toHaveLength(2);
    const assetsBefore = getMockDb().assets.length;

    const list = within(dialog).getAllByRole("listitem");
    await user.click(within(list[0]).getByRole("button", { name: "Use the existing file" }));
    expect(list[0]).toHaveAttribute("data-status", "done");
    expect(within(list[0]).getByText(/Using the existing file/)).toBeInTheDocument();
    expect(getMockDb().assets).toHaveLength(assetsBefore);

    await user.click(within(list[1]).getByRole("button", { name: "Upload anyway" }));
    await waitFor(() => expect(list[1]).toHaveAttribute("data-status", "done"));
    expect(getMockDb().assets).toHaveLength(assetsBefore + 1);
  });

  it("keeps at most 50 files per batch and says so", async () => {
    server.use(http.post(`${API}/media/uploads`, () => new Promise(() => undefined)));
    const { user, dialog, input } = await openDialog();
    await user.upload(input, Array.from({ length: 52 }, (_, i) => png(`m${i}.png`, i)));
    expect(await within(dialog).findByText(/2 files were not added: the limit is 50 files at a time/)).toBeInTheDocument();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(50);
  });

  it("503 (file service down) is retried automatically, then waits for the user", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let calls = 0;
      server.use(
        http.post(`${API}/media/uploads`, () => {
          calls += 1;
          return HttpResponse.json({ success: false, code: "SERVICE_UNAVAILABLE" }, { status: 503 });
        })
      );
      const { user, dialog, input } = await openDialog();
      await user.upload(input, png("down.png", 6));
      const row = await within(dialog).findByRole("listitem");
      await vi.advanceTimersByTimeAsync(10_000);
      await waitFor(() => expect(row).toHaveAttribute("data-status", "failed"));
      expect(calls).toBe(3);
      expect(within(row).getByText("The file service is not available. Try again later.")).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: "Retry down.png" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
