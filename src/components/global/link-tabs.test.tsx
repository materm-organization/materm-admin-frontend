import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LinkTabs } from "@/components/global/link-tabs";

describe("LinkTabs", () => {
  it("renders plain links, marks the active one with aria-current and keeps the others out of it", () => {
    render(
      <LinkTabs
        label="Groups"
        tabs={[
          { href: "/admin/settings/brand", label: "Brand", active: true },
          { href: "/admin/settings/contact", label: "Contact", active: false },
        ]}
      />
    );
    const nav = screen.getByRole("navigation", { name: "Groups" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Brand" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Brand" })).toHaveAttribute("href", "/admin/settings/brand");
    expect(screen.getByRole("link", { name: "Contact" })).not.toHaveAttribute("aria-current");
  });
});
