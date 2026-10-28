import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { MediaPicker, type MediaPickerProps } from "@/components/protected/media/media-picker";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { renderApp } from "@/test/render-app";

const API = "*/api/v1";
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

function renderPicker(props: Partial<MediaPickerProps> = {}) {
  const onSelect = vi.fn();
  const onOpenChange = vi.fn();
  const utils = renderApp(<MediaPicker open onOpenChange={onOpenChange} onSelect={onSelect} {...props} />);
  return { onSelect, onOpenChange, ...utils };
}

describe("MediaPicker (SCR-36 picker)", () => {
  useMockApi();

  it("single mode: a click picks the image and closes the dialog", async () => {
    const user = userEvent.setup();
    const { onSelect, onOpenChange } = renderPicker();
    const dialog = await screen.findByRole("dialog", { name: "Choose an image" });
    await user.click(await within(dialog).findByRole("button", { name: "blog-card-2.jpg" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject([{ id: 6, filename: "blog-card-2.jpg", mime_type: "image/jpeg" }]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("marks the image already chosen (aria-pressed) and shows file-state badges", async () => {
    getMockDb().assets.find((a) => a.id === 7)!.status = "processing";
    renderPicker({ selectedIds: [3] });
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("button", { name: "our-path-photo-2.jpg" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByRole("button", { name: "hero-bg.png" })).toHaveAttribute("aria-pressed", "false");
    // hero-bg.png has no alt; blog-card-3.jpg is still processing
    expect(within(within(dialog).getByRole("button", { name: "hero-bg.png" })).getByText("No alt text")).toBeInTheDocument();
    expect(within(within(dialog).getByRole("button", { name: "blog-card-3.jpg" })).getByText("Not ready")).toBeInTheDocument();
  });

  it("multiple mode: toggle several, the footer counts, 'Add selected' returns them in the order chosen", async () => {
    const user = userEvent.setup();
    const { onSelect, onOpenChange } = renderPicker({ mode: "multiple" });
    const dialog = await screen.findByRole("dialog", { name: "Choose images" });
    await user.click(await within(dialog).findByRole("button", { name: "blog-card-2.jpg" }));
    await user.click(within(dialog).getByRole("button", { name: "hero-bg.png" }));
    expect(within(dialog).getByText("2 selected")).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "hero-bg.png" }));
    expect(within(dialog).getByText("1 selected")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "blog-card-1.jpg" }));
    await user.click(within(dialog).getByRole("button", { name: "Add selected" }));
    expect(onSelect.mock.calls[0][0].map((a: { id: number }) => a.id)).toEqual([6, 5]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("multiple mode: an image already chosen that is NOT on the first page is still returned by 'Add selected'", async () => {
    const user = userEvent.setup();
    // 24 seeded + 6 extra = 2 pages; extra-1 (id 101) sits on page 2
    getMockDb().assets.push(...Array.from({ length: 6 }, (_, i) => ({ ...getMockDb().assets[0], id: 100 + i, original_filename: `extra-${i}.jpg` })));
    const { onSelect } = renderPicker({ mode: "multiple", selectedIds: [101] });
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("1 selected")).toBeInTheDocument();
    // add one more from page 1, keep the one from page 2
    await user.click(await within(dialog).findByRole("button", { name: "blog-card-1.jpg" }));
    const add = within(dialog).getByRole("button", { name: "Add selected" });
    await waitFor(() => expect(add).toBeEnabled());
    await user.click(add);
    expect(onSelect.mock.calls[0][0].map((a: { id: number; filename: string }) => [a.id, a.filename])).toEqual([[101, "extra-1.jpg"], [5, "blog-card-1.jpg"]]);
  });

  it("'Add selected' waits until the images already chosen are loaded (they are fetched by id, alone)", async () => {
    const seen: URLSearchParams[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.use(
      http.get(`${API}/media/assets`, async ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen.push(params);
        if (params.has("ids")) await gate;
        return undefined;
      })
    );
    renderPicker({ mode: "multiple", selectedIds: [3, 4] });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Add selected" })).toBeDisabled();
    release();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Add selected" })).toBeEnabled());
    const byIds = seen.find((p) => p.has("ids"))!;
    expect(Object.fromEntries(byIds.entries())).toEqual({ ids: "3,4", page: "1", limit: "2" });
  });

  it("multiple mode: max stops further picks and says so; pre-selected ids count", async () => {
    const user = userEvent.setup();
    renderPicker({ mode: "multiple", max: 2, selectedIds: [1] });
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("1 of 2 selected")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "blog-card-1.jpg" }));
    await user.click(within(dialog).getByRole("button", { name: "blog-card-2.jpg" }));
    expect(within(dialog).getByText("2 of 2 selected")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "blog-card-2.jpg" })).toHaveAttribute("aria-pressed", "false");
  });

  it("is operable from the keyboard: Tab to a tile, arrows move between tiles, Enter / Space picks", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker({ mode: "multiple" });
    const dialog = await screen.findByRole("dialog");
    const first = await within(dialog).findByRole("button", { name: "hero-bg.png" });
    first.focus();
    await user.keyboard("{ArrowRight}");
    expect(within(dialog).getByRole("button", { name: "our-path-photo-1.jpg" })).toHaveFocus();
    await user.keyboard("{ArrowRight}{ArrowLeft}{End}");
    expect(within(dialog).getAllByRole("button", { name: /\.(jpg|png|svg)$/ }).at(-1)).toHaveFocus();
    await user.keyboard("{Home}");
    expect(first).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(first).toHaveAttribute("aria-pressed", "true");
    await user.keyboard(" ");
    expect(first).toHaveAttribute("aria-pressed", "false");
    await user.keyboard("{Enter}");
    await user.click(within(dialog).getByRole("button", { name: "Add selected" }));
    expect(onSelect.mock.calls[0][0].map((a: { id: number }) => a.id)).toEqual([1]);
  });

  it("search is debounced and sent as keyword; the empty result says so", async () => {
    const user = userEvent.setup();
    const seen: Array<string | null> = [];
    server.use(
      http.get(`${API}/media/assets`, ({ request }) => {
        seen.push(new URL(request.url).searchParams.get("keyword"));
        return HttpResponse.json({ success: true, data: [], meta: { total: 0, page: 1, limit: 24, total_page: 0 } });
      })
    );
    renderPicker();
    const dialog = await screen.findByRole("dialog");
    await user.type(await within(dialog).findByLabelText("Search by file name"), "forest");
    expect(await within(dialog).findByText("No images found.")).toBeInTheDocument();
    await waitFor(() => expect(seen).toContain("forest"));
    expect(seen.filter((k) => k !== null && k !== "forest" && k !== "")).toEqual([]);
  });

  it("filters by folder (with sub-folders), by type, and sends the mime filter of `accept`", async () => {
    const user = userEvent.setup();
    const seen: URLSearchParams[] = [];
    server.use(
      http.get(`${API}/media/assets`, ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json({ success: true, data: [], meta: { total: 0, page: 1, limit: 24, total_page: 0 } });
      })
    );
    renderPicker({ accept: "image/*" });
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: /Our Path/ }));
    await waitFor(() => expect(seen.at(-1)?.get("folder_id")).toBe("2"));
    expect(seen.at(-1)?.get("include_subfolders")).toBe("true");
    expect(seen.at(-1)?.get("mime")).toBe("image/*");
    await user.click(within(dialog).getByRole("button", { name: "Not in a folder" }));
    await waitFor(() => expect(seen.at(-1)?.get("folder_id")).toBe("root"));
    expect(seen.at(-1)?.get("include_subfolders")).toBeNull();
    await user.click(within(dialog).getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Brand logos" }));
    await waitFor(() => expect(seen.at(-1)?.get("kind")).toBe("brand"));
  });

  it("pages through the library (24 per page) and says how many files there are", async () => {
    const user = userEvent.setup();
    getMockDb().assets.push(...Array.from({ length: 6 }, (_, i) => ({ ...getMockDb().assets[0], id: 100 + i, original_filename: `extra-${i}.jpg` })));
    renderPicker();
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("30 files")).toBeInTheDocument();
    expect(within(dialog).getByText("Page 1 of 2")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Next page" }));
    expect(await within(dialog).findByRole("button", { name: "extra-5.jpg" })).toBeInTheDocument();
    expect(within(dialog).getByText("Page 2 of 2")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("without permission to read the library it says so (the field keeps showing the current image)", async () => {
    server.use(http.get(`${API}/media/assets`, () => HttpResponse.json({ success: false, code: "FORBIDDEN" }, { status: 403 })));
    renderPicker();
    expect(await screen.findByText("You do not have permission to browse the media library.")).toBeInTheDocument();
  });

  it("a load error offers a retry", async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.get(`${API}/media/assets`, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ success: false, code: "INTERNAL_ERROR" }, { status: 500 })
          : HttpResponse.json({ success: true, data: [], meta: { total: 0, page: 1, limit: 24, total_page: 0 } });
      })
    );
    renderPicker();
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No images found.")).toBeInTheDocument();
  });

  it("a row without a URL gets a placeholder tile but can still be picked", async () => {
    const user = userEvent.setup();
    getMockDb().assets.find((a) => a.id === 1)!.url = null;
    const { onSelect } = renderPicker();
    const tile = await screen.findByRole("button", { name: "hero-bg.png" });
    expect(within(tile).getByText("No preview (file address not configured)")).toBeInTheDocument();
    await user.click(tile);
    expect(onSelect).toHaveBeenCalled();
  });

  it("uses the crop ratio of the field for the tiles", async () => {
    renderPicker({ ratio: "430:562" });
    const tile = await screen.findByRole("button", { name: "hero-bg.png" });
    expect((tile.querySelector("span.relative") as HTMLElement).style.aspectRatio).toBe("430 / 562");
  });

  it("Cancel closes without choosing", async () => {
    const user = userEvent.setup();
    const { onSelect, onOpenChange } = renderPicker();
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
