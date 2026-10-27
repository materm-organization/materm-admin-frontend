import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { NavMain, isNavActive } from "@/components/navbar/nav-main";
import { SidebarProvider } from "@/components/ui/sidebar";
import { NAV_MAIN_CONFIG } from "@/lib/nav-main-items";

import en from "../../../i18n/en.json";

const path = vi.hoisted(() => ({ current: "/admin" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));

function ui() {
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Vientiane">
      <SidebarProvider>
        <NavMain items={NAV_MAIN_CONFIG} />
      </SidebarProvider>
    </NextIntlClientProvider>
  );
}

describe("isNavActive", () => {
  it("matches the entry itself and every page below it on a whole-segment boundary", () => {
    expect(isNavActive("/admin/users", "/admin/users")).toBe(true);
    expect(isNavActive("/admin/users/5", "/admin/users")).toBe(true);
    expect(isNavActive("/admin/users-archive", "/admin/users")).toBe(false);
    expect(isNavActive("/admin/roles/3", "/admin/users")).toBe(false);
  });

  it("the dashboard matches only itself, a group parent ('#') never", () => {
    expect(isNavActive("/admin", "/admin")).toBe(true);
    expect(isNavActive("/admin/users", "/admin")).toBe(false);
    expect(isNavActive("/admin/profile", "/admin")).toBe(false);
    expect(isNavActive("/admin/users", "#")).toBe(false);
  });
});

describe("NavMain highlight (detail pages)", () => {
  it("a user detail page marks 'Users' and opens its group", () => {
    path.current = "/admin/users/5";
    render(ui());
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Roles" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
    // The other group stays closed.
    expect(screen.queryByRole("link", { name: "Audit log" })).not.toBeInTheDocument();
  });

  it("a role detail page marks 'Roles'", () => {
    path.current = "/admin/roles/3";
    render(ui());
    expect(screen.getByRole("link", { name: "Roles" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Users" })).not.toHaveAttribute("aria-current");
  });

  it("opens the group on a soft navigation from the dashboard into a detail page", () => {
    path.current = "/admin";
    const { rerender } = render(ui());
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();

    path.current = "/admin/users/5";
    rerender(ui());
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });
});
