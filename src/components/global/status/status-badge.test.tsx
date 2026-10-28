import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "@/components/global/status/status-badge";
import { TranslationBadges } from "@/components/global/status/translation-badges";
import { renderWithIntl } from "@/test/render";

describe("StatusBadge (doc/07 2.5.7)", () => {
  it.each([
    [{ status: "draft" as const }, "Draft only", "draft"],
    [{ status: "published" as const }, "Published", "published"],
    [{ status: "published" as const, hasUnpublishedChanges: true }, "Published, changes pending", "pending"],
    [{ status: "archived" as const }, "Archived", "archived"],
    [{ status: "in_review" as const }, "In review", "in_review"],
    [{ status: "scheduled" as const }, "Scheduled", "scheduled"],
    [{ status: "archived" as const, trashed: true }, "In the trash", "trashed"],
  ])("%j reads %s", (props, label, state) => {
    renderWithIntl(<StatusBadge {...props} />);
    const chip = screen.getByTestId("status-badge");
    expect(chip).toHaveTextContent(label);
    expect(chip).toHaveAttribute("data-state", state);
  });

  it("a pending flag on a draft says nothing more than Draft only", () => {
    renderWithIntl(<StatusBadge status="draft" hasUnpublishedChanges />);
    expect(screen.getByTestId("status-badge")).toHaveTextContent("Draft only");
  });
});

describe("TranslationBadges", () => {
  it("a language shows a check when complete, the number of missing texts when not, and 'off' when switched off", () => {
    renderWithIntl(
      <TranslationBadges
        status={{
          la: { enabled: true, title: true, seo_title: true, seo_description: true },
          en: { enabled: true, title: true, seo_title: false, seo_description: false },
          th: { enabled: false, title: true, seo_title: true, seo_description: true },
        }}
      />
    );
    expect(screen.getByLabelText("la: complete")).toBeInTheDocument();
    expect(screen.getByLabelText("en: 2 texts missing")).toHaveTextContent("2");
    expect(screen.getByLabelText("th: switched off for this page")).toBeInTheDocument();
  });

  it("renders nothing without languages", () => {
    const { container } = renderWithIntl(<TranslationBadges status={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
