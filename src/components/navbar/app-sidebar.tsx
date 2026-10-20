"use client";

import { useTranslations } from "next-intl";

import { NavMain } from "@/components/navbar/nav-main";
import { Icons } from "@/components/global/icons";
import { NavUser } from "@/components/navbar/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetchCurrentUser, useHasAccessToken } from "@/hooks/use-auth";
import { buildNavMainItemsForUser } from "@/lib/nav-main-items";

// Skeleton shown while the current-user fetch is loading — 3 rows + the
// literal "Menu" label.
function NavMainSkeleton() {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Menu</SidebarGroupLabel>
      <SidebarMenu>
        {[1, 2, 3].map((i) => (
          <SidebarMenuItem key={i}>
            <SidebarMenuButton className="pointer-events-none cursor-wait">
              <Skeleton className="size-[17px] shrink-0 rounded" />
              <Skeleton className="h-4 max-w-36 flex-1 rounded" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

// Shell: fetches the current user, computes permissionKeys, filters the nav
// config, renders NavMain + NavUser. NavUser
// self-fetches the current user (see nav-user.tsx), so it's always
// rendered — not conditionally withheld until `currentUser` exists.
export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const t = useTranslations("common");
  const hasToken = useHasAccessToken();
  const { data, isLoading } = useFetchCurrentUser();

  const currentUser = data?.data;
  const permissionKeys = currentUser
    ? currentUser.permissions.map((p) => p.permission_key)
    : [];
  const navItems = buildNavMainItemsForUser(permissionKeys);
  // `hasToken === null` = not known yet (pre-hydration) — keep this branch
  // in sync with server render the same way RoutePermissionGuard does.
  const showSkeleton = hasToken === null || isLoading;

  return (
    // `collapsible="icon"` keeps a narrow icon rail on desktop when toggled
    // (the shadcn default, `"offcanvas"`, slides the whole sidebar off-screen
    // instead). Header/nav/user content opts into the rail via the
    // `group-data-[collapsible=icon]` styles already in ui/sidebar.tsx;
    // nav-main swaps parent items with sub-items for a flyout menu since
    // SidebarMenuSub is hidden in the rail. Mobile still uses the sheet.
    // `variant="inset"` gives the main content area (SidebarInset) its
    // floating rounded-card look — flush sidebar, rounded+shadowed content
    // panel with a gap between them; it's inert without this prop (see
    // SidebarInset's `peer-data-[variant=inset]:*` classes in
    // ui/sidebar.tsx).
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="pointer-events-none">
              <Icons.logo className="size-8 rounded-lg" />
              <span className="truncate font-semibold">{t("appName")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>{showSkeleton ? <NavMainSkeleton /> : <NavMain items={navItems} />}</SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
