import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DiffView, SnapshotView } from "@/components/global/revisions/diff-view";
import { useMockApi } from "@/mocks/test-setup";
import { renderApp } from "@/test/render-app";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

describe("DiffView / SnapshotView", () => {
  useMockApi();

  it("groups differences by language, names fields (never JSON pointers) and marks changed words in text", async () => {
    const before = { asset: { folder_id: 1 }, translations: [{ locale_code: "la", alt: "Two climbers on a glacier" }] };
    const after = { asset: { folder_id: null }, translations: [{ locale_code: "la", alt: "Two hikers on a glacier" }] };
    renderApp(<DiffView before={before} after={after} />);
    const lao = await screen.findByRole("region", { name: "Lao (la)" });
    expect(within(lao).getByText("Alt text")).toBeInTheDocument();
    // word level: climbers removed, hikers added
    expect(lao.querySelector("del")).toHaveTextContent("climbers");
    expect(lao.querySelector("ins")).toHaveTextContent("hikers");
    const general = screen.getByRole("region", { name: "General" });
    expect(within(general).getByText("Image › Folder")).toBeInTheDocument();
    // old -> new for a scalar
    expect(within(general).getByText("1")).toBeInTheDocument();
    expect(within(general).getByText("none")).toBeInTheDocument();
    expect(screen.queryByText(/\/translations/)).not.toBeInTheDocument();
    expect(screen.getByText("2 differences")).toBeInTheDocument();
    // "General" comes first
    const regions = screen.getAllByRole("region");
    expect(regions[0]).toBe(general);
  });

  it("shows added and removed rows with their kind, rows of an identity list as 'Row n'", async () => {
    const before = { items: [{ public_id: "u1", url: "/" }] };
    const after = { items: [{ public_id: "u1", url: "/" }, { public_id: "u2", url: "/blog" }] };
    renderApp(<DiffView before={before} after={after} />);
    const general = await screen.findByRole("region", { name: "General" });
    expect(within(general).getAllByText("added")).toHaveLength(2);
    expect(within(general).getByText("Items › Row 2 › Link")).toBeInTheDocument();
    expect(within(general).getByText("/blog")).toBeInTheDocument();
  });

  it("says when there is nothing to show", async () => {
    renderApp(<DiffView before={{ a: 1 }} after={{ a: 1 }} />);
    expect(await screen.findByText("No differences.")).toBeInTheDocument();
  });

  it("SnapshotView lists the fields with labels, booleans as Yes/No and empty text as (empty)", async () => {
    renderApp(<SnapshotView snapshot={{ asset: { is_decorative: true, focal_x: null }, translations: [{ locale_code: "en", alt: "" }] }} />);
    const general = await screen.findByRole("region", { name: "General" });
    expect(within(general).getByText("Image › Decorative image")).toBeInTheDocument();
    expect(within(general).getByText("Yes")).toBeInTheDocument();
    const en = await screen.findByRole("region", { name: "English (en)" });
    expect(within(en).getByText("(empty)")).toBeInTheDocument();
    expect(screen.queryByText(/locale_code/)).not.toBeInTheDocument();
  });
});
